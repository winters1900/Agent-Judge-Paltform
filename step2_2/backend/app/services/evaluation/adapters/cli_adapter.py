from __future__ import annotations

import asyncio
import json
import os
import tempfile
import time
from typing import Any

from app.services.evaluation.adapters.base import TargetAdapter
from app.services.evaluation.types import AgentResponse, ToolCall, TraceStep


class CliAdapter(TargetAdapter):
    """命令行 Agent 适配器：把样本 prompt 喂给一个 CLI（如 Claude Code `claude -p`），
    捕获其输出作为被测回答。

    adapter_config（均可选）：
    - command:        可执行程序名，默认 "claude"
    - args:           参数列表；含占位符 {prompt} 时按 arg 模式注入，否则走 stdin。
                      默认 ["-p", "--output-format", "json"]
    - prompt_via:     "stdin"（默认）| "arg"
    - output_format:  "json"（默认，解析 Claude Code 结果信封）| "stream-json"（含工具调用）| "text"
    - prompt_field:   取样本输入哪个字段，默认 "prompt"
    - model:          便捷项，追加 --model <model>
    - cwd:            CLI 工作目录，默认临时目录
    - timeout_seconds:默认 300
    - env:            追加的环境变量 dict
    - extra_args:     追加到末尾的参数（如 ["--dangerously-skip-permissions"] 以允许工具使用）
    """

    async def invoke(self, input_payload: dict[str, Any]) -> AgentResponse:
        started = time.perf_counter()
        cfg = self.config
        prompt = input_payload.get(cfg.get("prompt_field", "prompt"))
        if prompt is None:
            prompt = json.dumps(input_payload, ensure_ascii=False)
        prompt = str(prompt)

        command = cfg.get("command", "claude")
        output_format = cfg.get("output_format", "json")
        args: list[str] = list(cfg.get("args") or ["-p", "--output-format", output_format])
        if cfg.get("model"):
            args += ["--model", str(cfg["model"])]
        args += [str(a) for a in (cfg.get("extra_args") or [])]

        prompt_via = cfg.get("prompt_via", "stdin")
        stdin_data: bytes | None = None
        if prompt_via == "arg" or any("{prompt}" in a for a in args):
            args = [a.replace("{prompt}", prompt) for a in args]
        else:
            stdin_data = prompt.encode("utf-8")

        cwd = cfg.get("cwd") or tempfile.gettempdir()
        env = {**os.environ, **(cfg.get("env") or {})}
        timeout = float(cfg.get("timeout_seconds", 300))

        try:
            proc = await asyncio.create_subprocess_exec(
                command, *args,
                stdin=asyncio.subprocess.PIPE if stdin_data is not None else None,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=cwd,
                env=env,
            )
        except FileNotFoundError:
            return AgentResponse(succeeded=False, error=f"找不到可执行命令: {command}", latency_ms=_ms(started))

        try:
            stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(stdin_data), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            return AgentResponse(succeeded=False, error=f"CLI 执行超时（{timeout}s）", latency_ms=_ms(started))

        stdout = stdout_b.decode("utf-8", "replace").strip()
        stderr = stderr_b.decode("utf-8", "replace").strip()
        latency = _ms(started)

        if proc.returncode != 0 and not stdout:
            return AgentResponse(
                succeeded=False,
                error=f"CLI 退出码 {proc.returncode}: {stderr[:500]}",
                latency_ms=latency,
            )

        if output_format == "json":
            return _parse_json_envelope(stdout, latency)
        if output_format == "stream-json":
            return _parse_stream_json(stdout, latency)
        return AgentResponse(output_text=stdout, output={"text": stdout}, latency_ms=latency)


def _parse_json_envelope(stdout: str, latency_ms: int) -> AgentResponse:
    """解析 Claude Code `--output-format json` 的结果信封。"""
    try:
        data = json.loads(stdout)
    except json.JSONDecodeError:
        return AgentResponse(output_text=stdout, output={"text": stdout}, latency_ms=latency_ms)

    result_text = str(data.get("result") or "")
    usage = data.get("usage") or {}
    inp = int(usage.get("input_tokens") or 0)
    out = int(usage.get("output_tokens") or 0)
    is_error = bool(data.get("is_error"))
    resp = AgentResponse(
        output_text=result_text,
        output={
            "text": result_text,
            "num_turns": data.get("num_turns"),
            "total_cost_usd": data.get("total_cost_usd"),
            "session_id": data.get("session_id"),
            "permission_denials": data.get("permission_denials"),
        },
        prompt_tokens=inp,
        completion_tokens=out,
        total_tokens=inp + out,
        latency_ms=int(data.get("duration_ms") or latency_ms),
        succeeded=not is_error,
        error=(data.get("subtype") if is_error else None),
    )
    resp.trace_steps = [TraceStep(step_index=0, phase="final", decision=f"{data.get('num_turns', 0)} 轮完成")]
    return resp


def _parse_stream_json(stdout: str, latency_ms: int) -> AgentResponse:
    """解析 NDJSON 事件流，提取助手文本与 tool_use（用于过程评估）。"""
    resp = AgentResponse(latency_ms=latency_ms)
    texts: list[str] = []
    tool_calls: list[ToolCall] = []
    trace: list[TraceStep] = []
    step = 0

    for line in stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        etype = event.get("type")
        if etype == "assistant":
            for block in (event.get("message", {}).get("content") or []):
                if block.get("type") == "text":
                    texts.append(block.get("text", ""))
                elif block.get("type") == "tool_use":
                    tc = ToolCall(tool_name=block.get("name", "tool"), input=block.get("input") or {})
                    tool_calls.append(tc)
                    trace.append(TraceStep(step_index=step, phase="action",
                                           decision=f"调用工具 {tc.tool_name}",
                                           tool_calls={"name": tc.tool_name, "input": tc.input}))
                    step += 1
        elif etype == "result":
            usage = event.get("usage") or {}
            resp.prompt_tokens = int(usage.get("input_tokens") or 0)
            resp.completion_tokens = int(usage.get("output_tokens") or 0)
            resp.total_tokens = resp.prompt_tokens + resp.completion_tokens
            if event.get("result"):
                texts.append(str(event["result"]))
            resp.succeeded = not bool(event.get("is_error"))
            resp.latency_ms = int(event.get("duration_ms") or latency_ms)

    resp.output_text = "\n".join(t for t in texts if t).strip()
    resp.output = {"text": resp.output_text}
    resp.tool_calls = tool_calls
    trace.append(TraceStep(step_index=step, phase="final", decision="完成"))
    resp.trace_steps = trace
    return resp


def _ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)
