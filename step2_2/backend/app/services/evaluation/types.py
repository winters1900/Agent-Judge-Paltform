from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class ToolCall:
    """被测 Agent 一次工具调用的记录（用于过程评估 / 工具调用正确率）。"""

    tool_name: str
    input: dict[str, Any] = field(default_factory=dict)
    output: dict[str, Any] | None = None
    success: bool = True
    error_type: str | None = None
    duration_ms: int = 0


@dataclass
class TraceStep:
    """被测 Agent 一个中间步骤（ReAct 的 think/act/observe 等）。"""

    step_index: int
    phase: str  # plan / think / action / observation / final ...
    decision: str | None = None
    observation: str | None = None
    state_snapshot: dict[str, Any] | None = None
    tool_calls: dict[str, Any] | None = None


@dataclass
class AgentResponse:
    """适配器调用被测 Agent 后的归一化结果。"""

    output_text: str = ""
    output: dict[str, Any] = field(default_factory=dict)
    tool_calls: list[ToolCall] = field(default_factory=list)
    trace_steps: list[TraceStep] = field(default_factory=list)
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    latency_ms: int = 0
    succeeded: bool = True
    error: str | None = None

    def as_snapshot(self) -> dict[str, Any]:
        return {
            "output_text": self.output_text,
            "output": self.output,
            "tool_calls": [tc.__dict__ for tc in self.tool_calls],
            "tokens": {
                "prompt": self.prompt_tokens,
                "completion": self.completion_tokens,
                "total": self.total_tokens,
            },
            "latency_ms": self.latency_ms,
            "succeeded": self.succeeded,
            "error": self.error,
        }


@dataclass
class MetricOutcome:
    """单个指标对单个样本的评估结果。"""

    metric_code: str
    dimension: str
    value: float | None = None
    text: str | None = None
    detail: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
