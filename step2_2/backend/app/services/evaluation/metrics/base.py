from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from app.services.evaluation.llm_client import LlmClient
from app.services.evaluation.types import AgentResponse, MetricOutcome


@dataclass
class SampleContext:
    """供指标计算使用的样本上下文（从 DatasetSample + AgentResponse 解耦构造）。"""

    sample_id: int
    input_payload: dict[str, Any]
    expected_output: dict[str, Any] | None
    reference_context: dict[str, Any] | None
    ground_truth: dict[str, Any] | None
    response: AgentResponse
    config: dict[str, Any] = field(default_factory=dict)

    # ── 便捷取值 ──
    @property
    def question(self) -> str:
        p = self.input_payload
        return str(p.get("prompt") or p.get("question") or p.get("input") or "")

    @property
    def answer(self) -> str:
        return self.response.output_text

    @property
    def expected_answer(self) -> str:
        exp = self.expected_output or {}
        return str(exp.get("text") or exp.get("answer") or exp.get("output") or "")

    @property
    def expected_tool_calls(self) -> list[dict[str, Any]]:
        gt = self.ground_truth or {}
        calls = gt.get("tool_calls") or gt.get("expected_tool_calls") or []
        return calls if isinstance(calls, list) else []

    @property
    def contexts(self) -> list[str]:
        ref = self.reference_context or {}
        ctx = ref.get("contexts") or ref.get("documents") or []
        if isinstance(ctx, str):
            return [ctx]
        return [str(c) for c in ctx] if isinstance(ctx, list) else []


class Metric(ABC):
    """指标基类。一个实例对应一个 metric_code 的一种实现。"""

    #: 指标稳定标识（与 MetricDefinition.metric_code 对应）
    code: str = "base"
    #: effect / safety / performance
    dimension: str = "effect"
    #: explicit / llm_judge / ragas
    calc_mode: str = "explicit"

    def __init__(self, config: dict[str, Any] | None = None, llm: LlmClient | None = None) -> None:
        self.config = config or {}
        self.llm = llm

    @abstractmethod
    async def evaluate(self, ctx: SampleContext) -> MetricOutcome:
        raise NotImplementedError

    def _outcome(self, **kwargs: Any) -> MetricOutcome:
        kwargs.setdefault("metric_code", self.code)
        kwargs.setdefault("dimension", self.dimension)
        return MetricOutcome(**kwargs)
