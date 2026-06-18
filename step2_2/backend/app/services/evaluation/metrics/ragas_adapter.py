from __future__ import annotations

from typing import Any

from app.services.evaluation.metrics.base import Metric, SampleContext
from app.services.evaluation.types import MetricOutcome

# Ragas 指标 code → ragas 内置指标名映射
_RAGAS_METRICS = {
    "ragas_faithfulness": "faithfulness",
    "ragas_answer_relevancy": "answer_relevancy",
    "ragas_context_precision": "context_precision",
    "ragas_answer_correctness": "answer_correctness",
}


class RagasMetric(Metric):
    """可选的 Ragas 适配器。

    设计：默认不强依赖 ragas。未安装 ragas 时返回带说明的 error，不影响其它指标。
    安装 ragas 且配置好 LLM/embeddings 后即可启用。
    """

    calc_mode = "ragas"
    dimension = "effect"

    def __init__(self, code: str, config: dict[str, Any] | None = None, llm=None) -> None:
        super().__init__(config=config, llm=llm)
        self.code = code
        self.ragas_name = _RAGAS_METRICS.get(code, code.replace("ragas_", ""))

    async def evaluate(self, ctx: SampleContext) -> MetricOutcome:
        try:
            score = await self._run_ragas(ctx)
        except ImportError:
            return self._outcome(
                value=None,
                error="未安装 ragas（pip install ragas datasets），该指标已跳过",
            )
        except Exception as exc:  # noqa: BLE001 - ragas 内部异常种类多，统一兜底
            return self._outcome(value=None, error=f"Ragas 计算失败: {exc}")
        return self._outcome(value=round(float(score), 4), text=f"{self.ragas_name}={score:.3f}")

    async def _run_ragas(self, ctx: SampleContext) -> float:
        import asyncio

        from datasets import Dataset  # type: ignore
        from ragas import evaluate as ragas_evaluate  # type: ignore
        from ragas import metrics as ragas_metrics  # type: ignore

        metric_obj = getattr(ragas_metrics, self.ragas_name)
        row = {
            "question": [ctx.question],
            "answer": [ctx.answer],
            "contexts": [ctx.contexts or [""]],
            "ground_truth": [ctx.expected_answer or ""],
        }
        dataset = Dataset.from_dict(row)
        # ragas 为同步阻塞调用，放入线程池避免阻塞事件循环
        result = await asyncio.to_thread(ragas_evaluate, dataset, metrics=[metric_obj])
        scores = result.to_pandas()[self.ragas_name].tolist()
        return float(scores[0]) if scores else 0.0
