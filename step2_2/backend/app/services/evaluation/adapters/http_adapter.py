from __future__ import annotations

import json
import time
from typing import Any

import httpx

from app.services.evaluation.adapters.base import TargetAdapter
from app.services.evaluation.adapters.mapping import build_context, get_path, render_template
from app.services.evaluation.types import AgentResponse, ToolCall, TraceStep

# 响应映射默认值：尽量兼容常见 agent 的字段命名（含 aicoding_ts 的 chunk/tool/result）
_DEFAULT_SSE_MAPPING: dict[str, Any] = {
    "event_type_path": "type",
    "text": {"on_event": "chunk", "paths": ["chunk", "content", "delta", "text"]},
    "tool_call": {"on_event": "tool", "name_paths": ["tool", "name"],
                  "input_paths": ["input", "args", "summary"], "output_paths": ["output", "result", "detail"]},
    "final": {"on_event": ["result", "final"], "paths": ["result", "output", "text"]},
    "error": {"on_event": "error", "paths": ["message", "error"]},
    "tokens": {"prompt_path": "usage.prompt_tokens", "completion_path": "usage.completion_tokens",
               "total_path": "usage.total_tokens"},
}
_DEFAULT_JSON_MAPPING: dict[str, Any] = {
    "text_paths": ["choices.0.message.content", "output_text", "answer", "result", "output", "text", "data.answer"],
    "tokens": {"prompt_path": "usage.prompt_tokens", "completion_path": "usage.completion_tokens",
               "total_path": "usage.total_tokens"},
}


def _first(obj: Any, paths: list[str]) -> Any:
    for p in paths:
        v = get_path(obj, p)
        if v not in (None, ""):
            return v
    return None


class _BaseHttpAdapter(TargetAdapter):
    def _request_args(self, input_payload: dict[str, Any]) -> tuple[str, str, dict, Any]:
        cfg = self.config
        prompt = input_payload.get(cfg.get("prompt_field", "prompt"))
        if prompt is None:
            prompt = json.dumps(input_payload, ensure_ascii=False)
        ctx = build_context(input_payload, str(prompt), cfg.get("secrets"))
        method = cfg.get("method", "POST")
        headers = render_template(cfg.get("headers") or {}, ctx)
        body_template = cfg.get("body_template")
        body = render_template(body_template, ctx) if body_template is not None else {"prompt": str(prompt)}
        return method, self.endpoint or "", {k: str(v) for k, v in headers.items()}, body


class HttpJsonAdapter(_BaseHttpAdapter):
    """通用一问一答 REST agent：发请求拿单个 JSON 响应，按映射取正文/token。

    覆盖 Dify / FastGPT / LangServe / 自建 agent。adapter_config:
    - method / headers / body_template / prompt_field / secrets / timeout_seconds
    - response_mapping: {"text_paths": [...], "tokens": {...}, "tool_calls_path": "..."}
    """

    async def invoke(self, input_payload: dict[str, Any]) -> AgentResponse:
        started = time.perf_counter()
        if not self.endpoint:
            return AgentResponse(succeeded=False, error="缺少 endpoint", latency_ms=_ms(started))
        method, url, headers, body = self._request_args(input_payload)
        mapping = {**_DEFAULT_JSON_MAPPING, **(self.config.get("response_mapping") or {})}
        try:
            async with httpx.AsyncClient(
                timeout=float(self.config.get("timeout_seconds", 120)),
                trust_env=False,
            ) as client:
                resp = await client.request(method, url, headers=headers, json=body)
        except httpx.HTTPError as exc:
            return AgentResponse(succeeded=False, error=f"请求失败: {exc}", latency_ms=_ms(started))
        if resp.status_code >= 400:
            return AgentResponse(succeeded=False, error=f"HTTP {resp.status_code}: {resp.text[:300]}", latency_ms=_ms(started))

        try:
            data = resp.json()
        except json.JSONDecodeError:
            text = resp.text.strip()
            return AgentResponse(output_text=text, output={"text": text}, latency_ms=_ms(started))

        text = _first(data, mapping.get("text_paths", [])) or ""
        tokens = mapping.get("tokens") or {}
        prompt_t = int(get_path(data, tokens.get("prompt_path", ""), 0) or 0)
        comp_t = int(get_path(data, tokens.get("completion_path", ""), 0) or 0)
        total_t = int(get_path(data, tokens.get("total_path", ""), 0) or 0) or (prompt_t + comp_t)
        return AgentResponse(
            output_text=str(text).strip(),
            output={"text": str(text), "raw": data if self.config.get("keep_raw") else None},
            prompt_tokens=prompt_t, completion_tokens=comp_t, total_tokens=total_t,
            latency_ms=_ms(started), succeeded=True,
        )


class HttpSseAdapter(_BaseHttpAdapter):
    """流式 SSE agent（如 aicoding_ts 的 /api/agent/chat）。

    逐条解析 `data: {...}` 事件，按 response_mapping 聚合 chunk/tool/result/error。
    不配 response_mapping 时用兼容多种命名的默认映射。
    """

    async def invoke(self, input_payload: dict[str, Any]) -> AgentResponse:
        started = time.perf_counter()
        response = AgentResponse()
        if not self.endpoint:
            response.succeeded = False
            response.error = "缺少 endpoint"
            return response

        method, url, headers, body = self._request_args(input_payload)
        headers.setdefault("Accept", "text/event-stream")
        mapping = {**_DEFAULT_SSE_MAPPING, **(self.config.get("response_mapping") or {})}
        chunks: list[str] = []
        tool_calls: list[ToolCall] = []
        trace: list[TraceStep] = []
        step = 0

        try:
            async with httpx.AsyncClient(
                timeout=float(self.config.get("timeout_seconds", 180)),
                trust_env=False,
            ) as client:
                async with client.stream(method, url, headers=headers, json=body) as resp:
                    if resp.status_code >= 400:
                        txt = (await resp.aread()).decode("utf-8", "replace")
                        response.succeeded = False
                        response.error = f"HTTP {resp.status_code}: {txt[:300]}"
                        response.latency_ms = _ms(started)
                        return response
                    async for line in resp.aiter_lines():
                        if not line or not line.startswith("data:"):
                            continue
                        payload = line[5:].strip()
                        if not payload or payload == "[DONE]":
                            continue
                        try:
                            event = json.loads(payload)
                        except json.JSONDecodeError:
                            continue
                        step = _consume(event, mapping, chunks, tool_calls, trace, step, response)
        except httpx.HTTPError as exc:
            response.succeeded = False
            response.error = f"请求失败: {exc}"
            response.latency_ms = _ms(started)
            return response

        response.output_text = "".join(chunks).strip()
        response.output = response.output or {"text": response.output_text}
        response.tool_calls = tool_calls
        trace.append(TraceStep(step_index=step, phase="final", decision="完成"))
        response.trace_steps = trace
        response.latency_ms = _ms(started)
        return response


def _matches(value: Any, on_event: Any) -> bool:
    if isinstance(on_event, list):
        return value in on_event
    return value == on_event


def _consume(event, mapping, chunks, tool_calls, trace, step, response: AgentResponse) -> int:
    etype = get_path(event, mapping.get("event_type_path", "type"))

    tmap = mapping.get("text") or {}
    if _matches(etype, tmap.get("on_event")):
        paths = tmap.get("paths") or ([tmap["path"]] if tmap.get("path") else [])
        chunks.append(str(_first(event, paths) or ""))
        return step

    cmap = mapping.get("tool_call") or {}
    if _matches(etype, cmap.get("on_event")):
        name = _first(event, cmap.get("name_paths") or ([cmap["name_path"]] if cmap.get("name_path") else [])) or "tool"
        tin = _first(event, cmap.get("input_paths") or ([cmap["input_path"]] if cmap.get("input_path") else []))
        tout = _first(event, cmap.get("output_paths") or ([cmap["output_path"]] if cmap.get("output_path") else []))
        tc = ToolCall(tool_name=str(name), input=tin if isinstance(tin, dict) else {"value": tin},
                      output=tout if isinstance(tout, dict) else ({"value": tout} if tout is not None else None))
        tool_calls.append(tc)
        trace.append(TraceStep(step_index=step, phase="action", decision=f"调用工具 {tc.tool_name}",
                               tool_calls={"name": tc.tool_name, "input": tc.input}))
        return step + 1

    fmap = mapping.get("final") or {}
    if _matches(etype, fmap.get("on_event")):
        paths = fmap.get("paths") or ([fmap["path"]] if fmap.get("path") else [])
        val = _first(event, paths)
        if isinstance(val, dict):
            response.output = val
            txt = val.get("text") or val.get("content")
            if txt:
                chunks.append(str(txt))
        elif val is not None:
            chunks.append(str(val))
        tkmap = mapping.get("tokens") or {}
        response.prompt_tokens = int(get_path(event, tkmap.get("prompt_path", ""), 0) or 0)
        response.completion_tokens = int(get_path(event, tkmap.get("completion_path", ""), 0) or 0)
        response.total_tokens = int(get_path(event, tkmap.get("total_path", ""), 0) or 0) or (
            response.prompt_tokens + response.completion_tokens)
        return step

    emap = mapping.get("error") or {}
    if _matches(etype, emap.get("on_event")):
        paths = emap.get("paths") or ([emap["path"]] if emap.get("path") else [])
        response.succeeded = False
        response.error = str(_first(event, paths) or "agent error")
    return step


def _ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)
