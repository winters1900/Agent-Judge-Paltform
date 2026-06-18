from __future__ import annotations

import json
import time
from typing import Any

import httpx

from app.core.config import settings
from app.services.evaluation.adapters.base import TargetAdapter
from app.services.evaluation.types import AgentResponse, ToolCall, TraceStep


class OpenAiAdapter(TargetAdapter):
    """通用 OpenAI 兼容 Chat Completions 适配器。

    覆盖：OpenAI / DeepSeek / vLLM / Ollama / 任何 /chat/completions 端点。
    把样本 prompt 作为 user message 发出，回复正文即被测输出；
    若模型返回 tool_calls（function calling），解析为工具调用轨迹（过程评估）。

    adapter_config（均可选，缺省回落到 .env 的 LLM_* 配置）：
    - base_url / api_key / model / temperature / max_tokens
    - system_prompt:  系统提示
    - prompt_field:   取样本输入哪个字段，默认 "prompt"
    - tools:          OpenAI function 定义数组，原样透传（用于工具调用评估）
    - timeout_seconds
    - extra_body:     合并进请求体的额外字段
    """

    async def invoke(self, input_payload: dict[str, Any]) -> AgentResponse:
        started = time.perf_counter()
        cfg = self.config
        base_url = (self.endpoint or cfg.get("base_url") or settings.llm_base_url).rstrip("/")
        api_key = cfg.get("api_key") or settings.llm_api_key
        model = cfg.get("model") or settings.llm_model

        prompt = input_payload.get(cfg.get("prompt_field", "prompt"))
        if prompt is None:
            prompt = json.dumps(input_payload, ensure_ascii=False)

        messages: list[dict[str, str]] = []
        if cfg.get("system_prompt"):
            messages.append({"role": "system", "content": str(cfg["system_prompt"])})
        messages.append({"role": "user", "content": str(prompt)})

        body: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": cfg.get("temperature", settings.llm_temperature),
            "max_tokens": cfg.get("max_tokens", settings.llm_max_tokens),
            **(cfg.get("extra_body") or {}),
        }
        if cfg.get("tools"):
            body["tools"] = cfg["tools"]

        if not api_key:
            return AgentResponse(succeeded=False, error="未配置 api_key（adapter_config 或 LLM_API_KEY）",
                                 latency_ms=_ms(started))

        try:
            async with httpx.AsyncClient(timeout=float(cfg.get("timeout_seconds", 120))) as client:
                resp = await client.post(
                    f"{base_url}/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                    json=body,
                )
        except httpx.HTTPError as exc:
            return AgentResponse(succeeded=False, error=f"请求失败: {exc}", latency_ms=_ms(started))

        if resp.status_code >= 400:
            return AgentResponse(succeeded=False, error=f"HTTP {resp.status_code}: {resp.text[:300]}",
                                 latency_ms=_ms(started))

        data = resp.json()
        choice = (data.get("choices") or [{}])[0]
        msg = choice.get("message") or {}
        text = msg.get("content") or ""
        usage = data.get("usage") or {}

        tool_calls = _parse_tool_calls(msg.get("tool_calls") or [])
        trace = [TraceStep(step_index=i, phase="action", decision=f"调用工具 {tc.tool_name}",
                           tool_calls={"name": tc.tool_name, "input": tc.input})
                 for i, tc in enumerate(tool_calls)]
        trace.append(TraceStep(step_index=len(tool_calls), phase="final", decision="完成"))

        return AgentResponse(
            output_text=str(text).strip(),
            output={"text": text, "finish_reason": choice.get("finish_reason")},
            tool_calls=tool_calls,
            trace_steps=trace,
            prompt_tokens=int(usage.get("prompt_tokens") or 0),
            completion_tokens=int(usage.get("completion_tokens") or 0),
            total_tokens=int(usage.get("total_tokens") or 0),
            latency_ms=_ms(started),
            succeeded=True,
        )


def _parse_tool_calls(raw: list[dict[str, Any]]) -> list[ToolCall]:
    calls: list[ToolCall] = []
    for item in raw:
        fn = item.get("function") or {}
        args = fn.get("arguments")
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except json.JSONDecodeError:
                args = {"_raw": args}
        calls.append(ToolCall(tool_name=fn.get("name") or "tool", input=args or {}))
    return calls


def _ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)
