from __future__ import annotations

import time
from typing import Any

from app.services.evaluation.adapters.base import TargetAdapter
from app.services.evaluation.types import AgentResponse, ToolCall, TraceStep


class MockAdapter(TargetAdapter):
    """确定性假 Agent：无需外部服务即可跑通全链路（用于离线演示与单元测试）。

    行为：把样本期望输出（若有）原样回放，否则回显输入；并伪造一次工具调用与轨迹。
    adapter_config:
    - echo_field: 回显输入的哪个字段（默认 "prompt"）
    - fixed_output: 固定输出文本（优先级最高）
    """

    async def invoke(self, input_payload: dict[str, Any]) -> AgentResponse:
        started = time.perf_counter()
        echo_field = self.config.get("echo_field", "prompt")
        text = (
            self.config.get("fixed_output")
            or input_payload.get(echo_field)
            or input_payload.get("expected_answer")
            or str(input_payload)
        )
        text = str(text)
        tool = ToolCall(
            tool_name="echo",
            input={"payload": input_payload},
            output={"text": text},
            success=True,
            duration_ms=1,
        )
        trace = [
            TraceStep(step_index=0, phase="think", decision="mock 直接回显输入"),
            TraceStep(step_index=1, phase="action", decision="调用工具 echo", tool_calls={"name": "echo"}),
            TraceStep(step_index=2, phase="final", decision="完成"),
        ]
        latency = int((time.perf_counter() - started) * 1000)
        return AgentResponse(
            output_text=text,
            output={"text": text},
            tool_calls=[tool],
            trace_steps=trace,
            prompt_tokens=len(str(input_payload)) // 4,
            completion_tokens=len(text) // 4,
            total_tokens=(len(str(input_payload)) + len(text)) // 4,
            latency_ms=latency,
            succeeded=True,
        )
