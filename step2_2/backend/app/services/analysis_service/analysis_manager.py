from __future__ import annotations

from statistics import mean
from uuid import uuid4

from sqlalchemy import select

from app.models.metric import MetricDefinition, MetricResult
from app.models.run import EvaluationRun
from app.repositories.analysis_repository import AnalysisRepository
from app.repositories.run_repository import RunRepository
from app.schemas.analysis import AnalysisCompareRequest

# 这些指标"越小越好"，对比时单独标注，避免误读为越大越好
_LOWER_IS_BETTER = {"response_time", "token_usage"}


class AnalysisManager:
    def __init__(self, analysis_repository: AnalysisRepository, run_repository: RunRepository) -> None:
        self.analysis_repository = analysis_repository
        self.run_repository = run_repository
        self.session = run_repository.session

    def list_analyses(self):
        return self.analysis_repository.list_all()

    def get_analysis(self, analysis_id: int):
        return self.analysis_repository.get_by_id(analysis_id)

    def compare(self, payload: AnalysisCompareRequest):
        """基于真实指标结果做多任务对比。

        策略：每个任务取其"最近一次已完成运行"，按样本聚合各指标均值，
        汇总成对比表 + 维度均值 + 每个指标的最优任务。
        """
        metric_code_by_id = self._metric_code_map()
        dimension_by_code = self._dimension_map()

        per_task: list[dict] = []
        for task_id in payload.task_ids:
            run = self._latest_completed_run(task_id)
            if run is None:
                per_task.append({"task_id": task_id, "run_id": None, "metrics": {}, "note": "无已完成运行"})
                continue
            metrics = self._aggregate_run_metrics(run.id, metric_code_by_id)
            if payload.metric_keys:
                metrics = {k: v for k, v in metrics.items() if k in payload.metric_keys}
            per_task.append(
                {
                    "task_id": task_id,
                    "run_id": run.id,
                    "run_code": run.run_code,
                    "metrics": metrics,
                    "dimension_avg": self._dimension_avg(metrics, dimension_by_code),
                }
            )

        all_metric_keys = payload.metric_keys or sorted(
            {k for t in per_task for k in t["metrics"].keys()}
        )
        best = self._best_by_metric(per_task, all_metric_keys)

        result_detail = {
            "comparison_mode": "multi_task",
            "metric_keys": all_metric_keys,
            "per_task": per_task,
            "best_by_metric": best,
            "lower_is_better": sorted(_LOWER_IS_BETTER & set(all_metric_keys)),
        }
        analysis = self.analysis_repository.create(
            _build_result(payload, result_detail, per_task)
        )
        return analysis

    # ── 内部 ──
    def _latest_completed_run(self, task_id: int) -> EvaluationRun | None:
        stmt = (
            select(EvaluationRun)
            .where(EvaluationRun.task_id == task_id, EvaluationRun.status == "completed")
            .order_by(EvaluationRun.id.desc())
        )
        run = self.session.scalars(stmt).first()
        if run is not None:
            return run
        # 退而求其次：取最近一次任意运行
        stmt2 = (
            select(EvaluationRun)
            .where(EvaluationRun.task_id == task_id)
            .order_by(EvaluationRun.id.desc())
        )
        return self.session.scalars(stmt2).first()

    def _aggregate_run_metrics(self, run_id: int, code_map: dict[int, str]) -> dict[str, float]:
        """按样本级 MetricResult 求各指标均值（忽略 None / 聚合行）。"""
        stmt = select(MetricResult).where(
            MetricResult.run_id == run_id, MetricResult.sample_id.isnot(None)
        )
        buckets: dict[str, list[float]] = {}
        for row in self.session.scalars(stmt).all():
            if row.metric_value is None:
                continue
            code = code_map.get(row.metric_id, str(row.metric_id))
            buckets.setdefault(code, []).append(float(row.metric_value))
        return {k: round(mean(v), 4) for k, v in buckets.items() if v}

    def _metric_code_map(self) -> dict[int, str]:
        return {m.id: m.metric_code for m in self.session.scalars(select(MetricDefinition)).all()}

    def _dimension_map(self) -> dict[str, str]:
        return {m.metric_code: m.dimension for m in self.session.scalars(select(MetricDefinition)).all()}

    @staticmethod
    def _dimension_avg(metrics: dict[str, float], dim_by_code: dict[str, str]) -> dict[str, float]:
        buckets: dict[str, list[float]] = {}
        for code, value in metrics.items():
            if code in _LOWER_IS_BETTER:
                continue  # 性能类不参与效果/安全维度均值
            dim = dim_by_code.get(code, "effect")
            buckets.setdefault(dim, []).append(value)
        return {k: round(mean(v), 4) for k, v in buckets.items() if v}

    @staticmethod
    def _best_by_metric(per_task: list[dict], metric_keys: list[str]) -> dict[str, dict]:
        best: dict[str, dict] = {}
        for key in metric_keys:
            candidates = [
                (t["task_id"], t["metrics"][key]) for t in per_task if key in t.get("metrics", {})
            ]
            if not candidates:
                continue
            lower_better = key in _LOWER_IS_BETTER
            winner = (min if lower_better else max)(candidates, key=lambda x: x[1])
            best[key] = {"task_id": winner[0], "value": winner[1], "lower_is_better": lower_better}
        return best


def _build_result(payload: AnalysisCompareRequest, detail: dict, per_task: list[dict]):
    from app.models.analysis import AnalysisResult

    completed = [t for t in per_task if t.get("run_id")]
    summary = (
        f"对比 {len(payload.task_ids)} 个任务（{len(completed)} 个有有效运行），"
        f"涉及指标 {len(detail['metric_keys'])} 个"
    )
    return AnalysisResult(
        analysis_code=f"analysis_{uuid4().hex[:8]}",
        title="多任务评测对比分析",
        task_ids=payload.task_ids,
        metric_keys=detail["metric_keys"],
        result_summary=summary,
        result_detail=detail,
    )
