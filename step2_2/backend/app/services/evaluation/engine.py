from __future__ import annotations

import asyncio
import statistics
from datetime import datetime, timezone
from typing import Any, Callable

from sqlalchemy.orm import Session

from app.models.metric import MetricDefinition, MetricResult
from app.models.run import EvaluationRun, EvaluationSampleResult
from app.models.trace import EvaluationTrace, ToolCallLog
from app.services.evaluation.adapters import build_adapter
from app.services.evaluation.llm_client import LlmClient
from app.services.evaluation.metrics import SampleContext, build_metric
from app.services.evaluation.types import AgentResponse, MetricOutcome
from app.services.ws_manager import run_event_bus

# run_config 默认值
_DEFAULT_SAMPLE_LIMIT = 0  # 0 = 全部
_TERMINAL = {"completed", "failed", "cancelled"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


class EvaluationEngine:
    """一次评测运行的执行器：调度被测 Agent、记录轨迹、计算指标、聚合结果、推送进度。

    每次 run() 独占一个 DB session（顺序处理样本，便于进度/暂停/取消语义清晰）。
    """

    def __init__(self, session_factory: Callable[[], Session]) -> None:
        self._session_factory = session_factory

    async def run(self, run_id: int) -> None:
        session = self._session_factory()
        try:
            await self._execute(session, run_id)
        except Exception as exc:  # noqa: BLE001 - 兜底，任何异常都要把 run 标记为 failed
            run = session.get(EvaluationRun, run_id)
            if run is not None and run.status not in _TERMINAL:
                run.status = "failed"
                run.error_message = f"引擎异常: {exc}"
                run.ended_at = _now()
                session.commit()
                await self._publish(run, event="run_failed", message=str(exc))
        finally:
            session.close()

    # ── 主流程 ──
    async def _execute(self, session: Session, run_id: int) -> None:
        run = session.get(EvaluationRun, run_id)
        if run is None:
            return
        from app.models.task import EvaluationTask

        task = session.get(EvaluationTask, run.task_id)
        if task is None:
            self._fail(session, run, "关联的评测任务不存在")
            await self._publish(run, event="run_failed", message=run.error_message)
            return

        target = self._load_target(session, task.target_id)
        if target is None:
            self._fail(session, run, "关联的被测对象不存在")
            await self._publish(run, event="run_failed", message=run.error_message)
            return

        samples = self._load_samples(session, task.dataset_id)
        run_config = task.run_config or {}
        limit = int(run_config.get("sample_limit", _DEFAULT_SAMPLE_LIMIT) or 0)
        if limit > 0:
            samples = samples[:limit]

        metric_defs = self._resolve_metrics(session, task.metric_config or {})
        adapter = build_adapter(target)
        llm = LlmClient(
            base_url=run_config.get("judge_base_url"),
            api_key=run_config.get("judge_api_key"),
            model=run_config.get("judge_model"),
        )

        run.status = "running"
        run.started_at = _now()
        run.progress = 0
        run.error_message = None
        run.summary = f"开始评测：{len(samples)} 个样本 × {len(metric_defs)} 个指标"
        session.commit()
        await self._publish(run, event="run_started", message=run.summary)

        if not samples:
            self._finalize(session, run, [])
            await self._publish(run, event="run_completed", message=run.summary)
            return

        all_outcomes: list[tuple[int, list[MetricOutcome]]] = []
        total = len(samples)
        for index, sample in enumerate(samples):
            # 暂停 / 取消检查（读取最新状态）
            state = self._fresh_status(run_id)
            if state == "cancelled":
                run.status = "cancelled"
                run.ended_at = _now()
                run.summary = f"已取消：完成 {index}/{total}"
                session.commit()
                await self._publish(run, event="run_cancelled", message=run.summary)
                return
            if state == "paused":
                if await self._wait_while_paused(run_id):  # True = 被取消
                    run.status = "cancelled"
                    run.ended_at = _now()
                    session.commit()
                    await self._publish(run, event="run_cancelled", message="暂停中取消")
                    return

            run.current_sample_id = sample.id
            outcomes = await self._evaluate_sample(session, run, sample, adapter, metric_defs, llm)
            all_outcomes.append((sample.id, outcomes))

            run.progress = round((index + 1) / total * 100, 2)
            session.commit()
            await self._publish(
                run,
                event="sample_completed",
                current_step=index + 1,
                message=f"完成样本 {index + 1}/{total}",
                extra={"sample_id": sample.id, "scores": _scores_brief(outcomes)},
            )

        self._finalize(session, run, all_outcomes)
        await self._publish(run, event="run_completed", message=run.summary)

    # ── 单样本评测 ──
    async def _evaluate_sample(
        self,
        session: Session,
        run: EvaluationRun,
        sample,
        adapter,
        metric_defs: list[MetricDefinition],
        llm: LlmClient,
    ) -> list[MetricOutcome]:
        started = _now()
        try:
            response = await adapter.invoke(sample.input_payload or {})
        except Exception as exc:  # noqa: BLE001 - 适配器自身异常也要捕获（自我修正）
            response = AgentResponse(succeeded=False, error=f"适配器异常: {exc}")

        self._persist_trace(session, run.id, sample.id, response)

        ctx = SampleContext(
            sample_id=sample.id,
            input_payload=sample.input_payload or {},
            expected_output=sample.expected_output,
            reference_context=sample.reference_context,
            ground_truth=sample.ground_truth,
            response=response,
        )

        metrics = [
            build_metric(md.metric_code, md.calc_mode, self._metric_config(md), llm)
            for md in metric_defs
        ]
        pairs = [(md, m) for md, m in zip(metric_defs, metrics) if m is not None]
        results = await asyncio.gather(
            *(m.evaluate(ctx) for _, m in pairs), return_exceptions=True
        )

        outcomes: list[MetricOutcome] = []
        score_summary: dict[str, Any] = {}
        for (md, _metric), res in zip(pairs, results):
            if isinstance(res, Exception):
                outcome = MetricOutcome(
                    metric_code=md.metric_code, dimension=md.dimension, error=str(res)
                )
            else:
                outcome = res
            outcomes.append(outcome)
            self._persist_metric_result(session, run.id, sample.id, md, outcome)
            score_summary[md.metric_code] = outcome.value

        status = "completed" if response.succeeded else "failed"
        session.add(
            EvaluationSampleResult(
                run_id=run.id,
                sample_id=sample.id,
                status=status,
                input_snapshot=sample.input_payload or {},
                output_snapshot=response.as_snapshot(),
                score_summary=score_summary,
                error_message=response.error,
                started_at=started,
                ended_at=_now(),
            )
        )
        session.commit()
        return outcomes

    # ── 持久化辅助 ──
    def _persist_trace(self, session: Session, run_id: int, sample_id: int, response: AgentResponse) -> None:
        for step in response.trace_steps:
            session.add(
                EvaluationTrace(
                    run_id=run_id,
                    sample_id=sample_id,
                    step_index=step.step_index,
                    phase=step.phase,
                    decision=step.decision,
                    observation=step.observation,
                    state_snapshot=step.state_snapshot,
                    tool_calls=step.tool_calls,
                )
            )
        for tc in response.tool_calls:
            session.add(
                ToolCallLog(
                    run_id=run_id,
                    sample_id=sample_id,
                    tool_name=tc.tool_name,
                    input_payload=tc.input or {},
                    output_payload=tc.output if isinstance(tc.output, dict) else {"value": tc.output},
                    success=tc.success,
                    error_type=tc.error_type,
                    duration_ms=tc.duration_ms,
                )
            )
        session.commit()

    def _persist_metric_result(
        self, session: Session, run_id: int, sample_id: int, md: MetricDefinition, outcome: MetricOutcome
    ) -> None:
        session.add(
            MetricResult(
                run_id=run_id,
                sample_id=sample_id,
                metric_id=md.id,
                metric_value=outcome.value,
                metric_text=outcome.text or outcome.error,
                metric_detail={**outcome.detail, **({"error": outcome.error} if outcome.error else {})},
            )
        )

    # ── 聚合与收尾 ──
    def _finalize(
        self, session: Session, run: EvaluationRun, all_outcomes: list[tuple[int, list[MetricOutcome]]]
    ) -> None:
        per_metric: dict[str, list[float]] = {}
        per_dimension: dict[str, list[float]] = {}
        for _sample_id, outcomes in all_outcomes:
            for o in outcomes:
                if o.value is None:
                    continue
                per_metric.setdefault(o.metric_code, []).append(float(o.value))
                per_dimension.setdefault(o.dimension, []).append(float(o.value))

        metric_avg = {k: round(statistics.mean(v), 4) for k, v in per_metric.items() if v}
        dimension_avg = {k: round(statistics.mean(v), 4) for k, v in per_dimension.items() if v}

        run.status = "completed"
        run.progress = 100
        run.ended_at = _now()
        run.summary = (
            f"完成 {len(all_outcomes)} 个样本；"
            f"指标均值: {metric_avg or '—'}"
        )
        # 把聚合结果存到 sample_result 之外：复用 run.error_message? 不合适。
        # 直接写一条 run 级 MetricResult（sample_id 为空）保存聚合，便于对比分析读取。
        for code, avg in metric_avg.items():
            md = self._find_metric_def(session, code)
            if md is not None:
                session.add(
                    MetricResult(
                        run_id=run.id,
                        sample_id=None,
                        metric_id=md.id,
                        metric_value=avg,
                        metric_text=f"run avg over {len(all_outcomes)} samples",
                        metric_detail={"aggregate": True, "dimension_avg": dimension_avg},
                    )
                )
        session.commit()

    def _fail(self, session: Session, run: EvaluationRun, message: str) -> None:
        run.status = "failed"
        run.error_message = message
        run.ended_at = _now()
        session.commit()

    # ── 状态轮询（暂停/取消）──
    def _fresh_status(self, run_id: int) -> str:
        s = self._session_factory()
        try:
            run = s.get(EvaluationRun, run_id)
            return run.status if run else "cancelled"
        finally:
            s.close()

    async def _wait_while_paused(self, run_id: int, poll_seconds: float = 1.0) -> bool:
        """阻塞直到 run 恢复 running 或被取消。返回 True 表示被取消。"""
        while True:
            await asyncio.sleep(poll_seconds)
            status = self._fresh_status(run_id)
            if status == "cancelled":
                return True
            if status != "paused":
                return False

    # ── 数据加载 ──
    def _load_target(self, session: Session, target_id: int):
        from app.models.target import EvaluationTarget

        return session.get(EvaluationTarget, target_id)

    def _load_samples(self, session: Session, dataset_id: int):
        from app.models.dataset import DatasetSample
        from sqlalchemy import select

        stmt = select(DatasetSample).where(DatasetSample.dataset_id == dataset_id).order_by(DatasetSample.id)
        return list(session.scalars(stmt).all())

    def _resolve_metrics(self, session: Session, metric_config: dict) -> list[MetricDefinition]:
        """metric_config 支持多种写法（兼容前端表单与脚本）：
        - {"metric_codes": ["task_success", ...]}
        - {"metrics": [{"metric_code": "...", "config": {...}}, ...]}
        - {"explicit_metrics": [...], "fuzzy_metrics": [...]}   ← 前端 TaskFormPage 的形状
        未指定时回退到该任务可用的全部已启用指标。
        """
        from sqlalchemy import select

        codes: list[str] = []
        if isinstance(metric_config.get("metric_codes"), list):
            codes = [str(c) for c in metric_config["metric_codes"]]
        elif isinstance(metric_config.get("metrics"), list):
            codes = [str(m.get("metric_code")) for m in metric_config["metrics"] if m.get("metric_code")]
        else:
            # 前端把显式/模糊指标分两个字段存
            for key in ("explicit_metrics", "fuzzy_metrics"):
                if isinstance(metric_config.get(key), list):
                    codes += [str(c) for c in metric_config[key]]

        stmt = select(MetricDefinition).where(MetricDefinition.enabled.is_(True))
        if codes:
            stmt = stmt.where(MetricDefinition.metric_code.in_(codes))
        defs = list(session.scalars(stmt).all())
        # 保持 codes 指定的顺序
        if codes:
            order = {c: i for i, c in enumerate(codes)}
            defs.sort(key=lambda d: order.get(d.metric_code, 999))
        self._metric_config_map = self._build_config_map(metric_config)
        return defs

    def _build_config_map(self, metric_config: dict) -> dict[str, dict]:
        result: dict[str, dict] = {}
        for m in metric_config.get("metrics", []) or []:
            if isinstance(m, dict) and m.get("metric_code"):
                result[m["metric_code"]] = m.get("config") or {}
        return result

    def _metric_config(self, md: MetricDefinition) -> dict:
        """指标运行配置 = 指标定义自带的 config_schema（如自定义 LLM-Judge 的 criteria/dimension）
        叠加任务级 metric_config 里该指标的 config（任务级覆盖定义级）。
        这样在「指标管理」页定义的自定义指标无需改代码即可生效。
        """
        base = dict(md.config_schema) if isinstance(md.config_schema, dict) else {}
        base.setdefault("dimension", md.dimension)  # 让自定义 LLM-Judge 指标继承定义里的维度
        override = getattr(self, "_metric_config_map", {}).get(md.metric_code, {})
        return {**base, **override}

    def _find_metric_def(self, session: Session, code: str) -> MetricDefinition | None:
        from sqlalchemy import select

        stmt = select(MetricDefinition).where(MetricDefinition.metric_code == code)
        return session.scalars(stmt).first()

    # ── 进度推送 ──
    async def _publish(
        self,
        run: EvaluationRun,
        *,
        event: str,
        current_step: int | None = None,
        message: str | None = None,
        extra: dict[str, Any] | None = None,
    ) -> None:
        payload = {
            "event": event,
            "run_id": run.id,
            "status": run.status,
            "progress": float(run.progress or 0),
            "current_step": current_step,
            "message": message,
            "updated_at": _now().isoformat(),
        }
        if extra:
            payload.update(extra)
        await run_event_bus.publish(run.id, payload)


def _scores_brief(outcomes: list[MetricOutcome]) -> dict[str, Any]:
    return {o.metric_code: o.value for o in outcomes if o.value is not None}
