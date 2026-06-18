from __future__ import annotations

import json
from typing import Any

import httpx

from app.core.config import settings


class LlmError(RuntimeError):
    """LLM 调用失败（网络、鉴权、限流等）。"""


class LlmClient:
    """OpenAI 兼容的 Chat Completions 客户端，供被测 Agent 调用与 LLM-Judge 共用。

    所有参数默认取自全局 settings（.env），单次调用可覆盖 model/temperature。
    """

    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        model: str | None = None,
        timeout: float | None = None,
    ) -> None:
        self.base_url = (base_url or settings.llm_base_url).rstrip("/")
        self.api_key = api_key or settings.llm_api_key
        self.model = model or settings.llm_model
        self.timeout = timeout or settings.llm_timeout_seconds

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    async def chat(
        self,
        messages: list[dict[str, str]],
        *,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        response_format_json: bool = False,
    ) -> dict[str, Any]:
        """返回 {"content": str, "usage": {...}, "raw": {...}}。"""
        if not self.configured:
            raise LlmError("未配置 LLM_API_KEY，无法调用 LLM（请在 .env 设置或改用 mock 适配器）")

        payload: dict[str, Any] = {
            "model": model or self.model,
            "messages": messages,
            "temperature": settings.llm_temperature if temperature is None else temperature,
            "max_tokens": max_tokens or settings.llm_max_tokens,
        }
        if response_format_json:
            payload["response_format"] = {"type": "json_object"}

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
        except httpx.HTTPError as exc:  # 网络层失败
            raise LlmError(f"LLM 请求失败: {exc}") from exc

        if resp.status_code >= 400:
            raise LlmError(f"LLM 返回 {resp.status_code}: {resp.text[:500]}")

        data = resp.json()
        choice = (data.get("choices") or [{}])[0]
        content = (choice.get("message") or {}).get("content") or ""
        return {"content": content, "usage": data.get("usage") or {}, "raw": data}

    async def chat_json(self, messages: list[dict[str, str]], **kwargs: Any) -> dict[str, Any]:
        """要求模型返回 JSON 并解析；解析失败时尝试从文本中截取 JSON。"""
        result = await self.chat(messages, response_format_json=True, **kwargs)
        content = result["content"]
        parsed = _extract_json(content)
        return {"parsed": parsed, "content": content, "usage": result["usage"]}


def _extract_json(content: str) -> dict[str, Any]:
    content = content.strip()
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        pass
    # 兜底：截取第一个 { 到最后一个 }
    start = content.find("{")
    end = content.rfind("}")
    if start >= 0 and end > start:
        try:
            return json.loads(content[start : end + 1])
        except json.JSONDecodeError:
            pass
    return {}
