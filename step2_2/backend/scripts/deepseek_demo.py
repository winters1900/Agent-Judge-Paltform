"""真实 LLM-Judge 端到端演示：用 .env 里的 DeepSeek 给被测回答打分。

用法（在 backend 目录，已配置好 .env）：
    .venv/bin/python scripts/deepseek_demo.py
"""
from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.config import settings  # noqa: E402
from app.core.database import SessionLocal, init_db  # noqa: E402
from app.models.dataset import Dataset, DatasetSample  # noqa: E402
from app.models.metric import MetricResult  # noqa: E402
from app.models.run import EvaluationRun, EvaluationSampleResult  # noqa: E402
from app.models.target import EvaluationTarget  # noqa: E402
from app.models.task import EvaluationTask  # noqa: E402
from app.services.evaluation.engine import EvaluationEngine  # noqa: E402
from app.services.evaluation.seed import seed_defaults  # noqa: E402

JUDGE_METRICS = ["task_success", "response_time", "token_usage",
                 "reasoning_quality", "answer_accuracy", "hallucination", "safety_harmlessness"]


def setup() -> int:
    init_db()
    s = SessionLocal()
    try:
        seed_defaults(s)
        # mock 适配器：fixed_output 让"被测 Agent"产出一个具体回答，交给 DeepSeek 评判
        good = EvaluationTarget(
            target_code="t_good", target_type="agent", name="GoodAgent", version="v1",
            adapter_type="mock",
            adapter_config={"fixed_output": "反转列表用切片 lst[::-1]，或 lst.reverse() 原地反转，或 reversed(lst) 返回迭代器。"},
            enabled=True,
        )
        s.add(good); s.commit(); s.refresh(good)

        ds = Dataset(dataset_code="ds_demo", name="QA演示", source_type="manual",
                     sample_count=1, version="v1", status="ready")
        s.add(ds); s.commit(); s.refresh(ds)
        s.add(DatasetSample(
            dataset_id=ds.id, sample_code="q1",
            input_payload={"prompt": "Python 里怎么反转一个列表？"},
            expected_output={"answer": "可以用 lst[::-1] 切片，或 lst.reverse()，或 reversed(lst)。"},
            reference_context={"contexts": ["Python 列表切片 lst[::-1] 返回反转的新列表；list.reverse() 原地反转。"]},
            sample_type="qa",
        ))
        s.commit()

        task = EvaluationTask(
            task_code="task_demo", name="DeepSeek评判演示", target_id=good.id,
            target_type="agent", target_version="v1", dataset_id=ds.id, status="ready",
            metric_config={"metric_codes": JUDGE_METRICS},
            evaluation_method_config=[], run_config={},
        )
        s.add(task); s.commit(); s.refresh(task)

        run = EvaluationRun(run_code="run_demo", task_id=task.id, status="queued", progress=0, retry_count=0)
        s.add(run); s.commit(); s.refresh(run)
        return run.id
    finally:
        s.close()


async def main() -> None:
    print(f"LLM: {settings.llm_model} @ {settings.llm_base_url}  key={'设置✓' if settings.llm_api_key else '未设置✗'}")
    run_id = setup()
    await EvaluationEngine(SessionLocal).run(run_id)

    s = SessionLocal()
    try:
        run = s.get(EvaluationRun, run_id)
        sr = s.query(EvaluationSampleResult).filter_by(run_id=run_id).first()
        print("\n=== 运行结果 ===")
        print("status:", run.status, "| progress:", run.progress)
        print("summary:", run.summary)
        print("\n=== 各指标得分（含 DeepSeek 判官理由）===")
        for mr in s.query(MetricResult).filter_by(run_id=run_id).all():
            if mr.sample_id is None:
                continue
            reason = (mr.metric_text or "")[:120]
            print(f"  {mr.metric_value!s:>8}  {reason}")
    finally:
        s.close()


if __name__ == "__main__":
    asyncio.run(main())
