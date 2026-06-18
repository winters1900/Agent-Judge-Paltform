"""离线端到端冒烟测试：seed → 建 target/dataset/task → 跑引擎 → 校验结果。

用法：
    DATABASE_URL=sqlite:///./_e2e.db .venv/bin/python scripts/e2e_check.py
"""
from __future__ import annotations

import asyncio
import os
import sys

# 确保用 sqlite，且不连真实 LLM
os.environ.setdefault("DATABASE_URL", "sqlite:///./_e2e.db")
os.environ.setdefault("LLM_API_KEY", "")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import SessionLocal, init_db  # noqa: E402
from app.models.dataset import Dataset, DatasetSample  # noqa: E402
from app.models.metric import MetricResult  # noqa: E402
from app.models.run import EvaluationRun, EvaluationSampleResult  # noqa: E402
from app.models.target import EvaluationTarget  # noqa: E402
from app.models.task import EvaluationTask  # noqa: E402
from app.models.trace import ToolCallLog  # noqa: E402
from app.services.evaluation.engine import EvaluationEngine  # noqa: E402
from app.services.evaluation.seed import seed_defaults  # noqa: E402


def setup() -> int:
    init_db()
    s = SessionLocal()
    try:
        seeded = seed_defaults(s)
        print("seed:", seeded)

        target = EvaluationTarget(
            target_code="t_mock", target_type="agent", name="Mock Agent", version="v1",
            endpoint=None, adapter_type="mock", adapter_config={}, enabled=True,
        )
        s.add(target)
        s.commit()
        s.refresh(target)

        ds = Dataset(
            dataset_code="ds1", name="demo", source_type="manual", sample_count=2,
            version="v1", status="ready",
        )
        s.add(ds)
        s.commit()
        s.refresh(ds)

        s.add_all([
            DatasetSample(
                dataset_id=ds.id, sample_code="s1",
                input_payload={"prompt": "返回 hello world"},
                expected_output={"answer": "hello world"},
                ground_truth={"keywords": ["hello"], "tool_calls": [{"tool_name": "echo"}]},
                sample_type="qa",
            ),
            DatasetSample(
                dataset_id=ds.id, sample_code="s2",
                input_payload={"prompt": "说点别的"},
                expected_output={"answer": "完全不一样的内容"},
                ground_truth={"tool_calls": [{"tool_name": "echo"}]},
                sample_type="qa",
            ),
        ])
        s.commit()

        task = EvaluationTask(
            task_code="task1", name="冒烟任务", target_id=target.id, target_type="agent",
            target_version="v1", dataset_id=ds.id, status="ready",
            metric_config={"metric_codes": [
                "task_success", "tool_call_accuracy", "tool_call_f1",
                "response_time", "token_usage",
            ]},
            evaluation_method_config=[], run_config={},
        )
        s.add(task)
        s.commit()
        s.refresh(task)

        run = EvaluationRun(run_code="r1", task_id=task.id, status="queued", progress=0, retry_count=0)
        s.add(run)
        s.commit()
        s.refresh(run)
        return run.id
    finally:
        s.close()


async def main() -> None:
    run_id = setup()
    engine = EvaluationEngine(SessionLocal)
    await engine.run(run_id)

    s = SessionLocal()
    try:
        run = s.get(EvaluationRun, run_id)
        samples = s.query(EvaluationSampleResult).filter_by(run_id=run_id).all()
        metrics = s.query(MetricResult).filter_by(run_id=run_id).all()
        tools = s.query(ToolCallLog).filter_by(run_id=run_id).all()

        print("\n=== RESULT ===")
        print("run.status =", run.status, "progress =", run.progress)
        print("run.summary =", run.summary)
        print("sample_results =", len(samples))
        for sr in samples:
            print("  sample", sr.sample_id, sr.status, "scores:", sr.score_summary)
        print("metric_results =", len(metrics), "(含聚合行)")
        print("tool_call_logs =", len(tools))

        assert run.status == "completed", run.status
        assert len(samples) == 2
        # s1 含关键词 hello → task_success=1；s2 期望"完全不一样"但 mock 回显 prompt → 0
        by_sample = {sr.sample_id: sr.score_summary for sr in samples}
        succ = [v.get("task_success") for v in by_sample.values()]
        assert 1.0 in succ and 0.0 in succ, succ
        # tool_call_accuracy：mock 调用 echo，期望 echo → 1.0
        accs = [v.get("tool_call_accuracy") for v in by_sample.values()]
        assert all(a == 1.0 for a in accs), accs
        assert len(tools) == 2, len(tools)
        print("\nALL ASSERTIONS PASSED ✅")
    finally:
        s.close()


if __name__ == "__main__":
    asyncio.run(main())
