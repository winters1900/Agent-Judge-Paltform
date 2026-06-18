from __future__ import annotations

from app.models.target import EvaluationTarget
from app.services.evaluation.adapters.base import TargetAdapter
from app.services.evaluation.adapters.cli_adapter import CliAdapter
from app.services.evaluation.adapters.http_adapter import HttpJsonAdapter, HttpSseAdapter
from app.services.evaluation.adapters.mock_adapter import MockAdapter
from app.services.evaluation.adapters.openai_adapter import OpenAiAdapter


def build_adapter(target: EvaluationTarget) -> TargetAdapter:
    """按 target.adapter_type 构造适配器。未知类型回退 mock，保证流程不中断。"""
    adapter_type = (target.adapter_type or "mock").lower()
    config = target.adapter_config or {}
    endpoint = target.endpoint

    if adapter_type in {"cli", "command", "claude_code"}:
        return CliAdapter(endpoint=endpoint, config=config)
    if adapter_type in {"openai", "openai_chat", "llm"}:
        return OpenAiAdapter(endpoint=endpoint, config=config)
    if adapter_type in {"http_sse", "sse", "http"}:  # http 历史别名 → SSE
        return HttpSseAdapter(endpoint=endpoint, config=config)
    if adapter_type in {"http_json", "rest", "json"}:
        return HttpJsonAdapter(endpoint=endpoint, config=config)
    if adapter_type in {"mock", "echo"}:
        return MockAdapter(endpoint=endpoint, config=config)
    # 未知适配器类型：降级为 mock，避免整批评测因配置错误而失败
    return MockAdapter(endpoint=endpoint, config={**config, "_fallback_from": adapter_type})
