"""声明式 I/O 映射工具：请求模板渲染 + 响应字段按路径取值。

让 http_json / http_sse 适配器无需改代码即可适配不同 agent 的请求/响应结构。
纯标准库实现，不引第三方 JSONPath 依赖。
"""
from __future__ import annotations

import os
import re
from typing import Any

_PLACEHOLDER = re.compile(r"\{\{\s*([^}]+?)\s*\}\}")


def get_path(obj: Any, path: str, default: Any = None) -> Any:
    """按点路径取值，支持嵌套 dict 与列表下标，如 "choices.0.message.content"。"""
    if not path:
        return default
    cur = obj
    for seg in path.split("."):
        if cur is None:
            return default
        if isinstance(cur, dict):
            cur = cur.get(seg)
        elif isinstance(cur, (list, tuple)):
            try:
                cur = cur[int(seg)]
            except (ValueError, IndexError):
                return default
        else:
            return default
    return cur if cur is not None else default


def render_template(template: Any, context: dict[str, Any]) -> Any:
    """递归渲染模板中的 {{path}} 占位符。

    - 整个字符串恰好是单个 {{path}} 时，返回该路径的**原始值**（可为 dict/数字/bool）。
    - 字符串内含占位符时，逐个替换为 str(值)。
    - dict / list 递归处理。
    context 形如 {"input": {...}, "prompt": "...", "secret": {...}, "env": {...}}。
    """
    if isinstance(template, dict):
        return {k: render_template(v, context) for k, v in template.items()}
    if isinstance(template, list):
        return [render_template(v, context) for v in template]
    if isinstance(template, str):
        m = _PLACEHOLDER.fullmatch(template.strip())
        if m:  # 整串就是一个占位符 → 保留原始类型
            return get_path(context, m.group(1), default="")
        return _PLACEHOLDER.sub(lambda mm: str(get_path(context, mm.group(1), default="")), template)
    return template


def build_context(input_payload: dict[str, Any], prompt: str, secrets: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "input": input_payload,
        "prompt": prompt,
        "secret": secrets or {},
        "env": dict(os.environ),
    }
