"""被测对象适配器预设：供前端「新建目标」一键填充配置模板。"""
from __future__ import annotations

from typing import Any

ADAPTER_PRESETS: list[dict[str, Any]] = [
    {
        "adapter_type": "openai",
        "label": "OpenAI 兼容模型 (OpenAI / DeepSeek / vLLM / Ollama)",
        "endpoint": "",
        "needs_endpoint": False,
        "config": {
            "base_url": "https://api.deepseek.com/v1",
            "api_key": "",
            "model": "deepseek-v4-pro",
            "system_prompt": "",
            "temperature": 0,
        },
        "hint": "留空 base_url/api_key/model 则用 .env 里的 LLM_* 配置。",
    },
    {
        "adapter_type": "http_sse",
        "label": "我们的网页 Agent (aicoding_ts SSE)",
        "endpoint": "http://localhost:3000/api/agent/chat",
        "needs_endpoint": True,
        "config": {
            "body_template": {"prompt": "{{prompt}}"},
            "response_mapping": {
                "event_type_path": "type",
                "text": {"on_event": "chunk", "paths": ["chunk"]},
                "tool_call": {"on_event": "tool", "name_paths": ["tool"],
                              "input_paths": ["summary"], "output_paths": ["detail"]},
                "final": {"on_event": "result", "paths": ["result"]},
                "error": {"on_event": "error", "paths": ["message"]},
            },
            "timeout_seconds": 180,
        },
        "hint": "已按 aicoding_ts 的 chunk/tool/result 事件预配映射。注意其 SSE 不返回 token 用量。",
    },
    {
        "adapter_type": "http_json",
        "label": "通用 REST Agent (Dify / FastGPT / 自建)",
        "endpoint": "https://your-agent/api/chat",
        "needs_endpoint": True,
        "config": {
            "method": "POST",
            "headers": {"Authorization": "Bearer {{secret.API_KEY}}"},
            "body_template": {"query": "{{prompt}}"},
            "response_mapping": {"text_paths": ["answer", "data.answer", "result"]},
            "secrets": {"API_KEY": ""},
        },
        "hint": "用 body_template 拼请求、response_mapping.text_paths 指明回答字段路径。",
    },
    {
        "adapter_type": "claude_code",
        "label": "Claude Code CLI",
        "endpoint": "",
        "needs_endpoint": False,
        "config": {
            "command": "claude",
            "output_format": "json",
            "prompt_via": "stdin",
            "timeout_seconds": 180,
        },
        "hint": "需本机装有 claude CLI。要它真正用工具改文件：output_format 改 stream-json 并加 extra_args。",
    },
    {
        "adapter_type": "mock",
        "label": "Mock（离线占位 / 自测）",
        "endpoint": "",
        "needs_endpoint": False,
        "config": {},
        "hint": "确定性回显，无需外部服务。",
    },
]
