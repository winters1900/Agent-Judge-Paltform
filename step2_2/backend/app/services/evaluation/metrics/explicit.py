from __future__ import annotations

import re
from typing import Any

from app.services.evaluation.metrics.base import Metric, SampleContext
from app.services.evaluation.types import MetricOutcome


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip().lower()


def _tool_signature(call: dict[str, Any]) -> tuple:
    name = call.get("tool_name") or call.get("name") or call.get("tool") or ""
    args = call.get("input") or call.get("args") or {}
    try:
        frozen = tuple(sorted((str(k), str(v)) for k, v in args.items()))
    except AttributeError:
        frozen = (str(args),)
    return (name, frozen)


class ResponseTimeMetric(Metric):
    """响应时间（性能维度，显式指标，单位 ms，越小越好）。"""

    code = "response_time"
    dimension = "performance"
    calc_mode = "explicit"

    async def evaluate(self, ctx: SampleContext) -> MetricOutcome:
        ms = float(ctx.response.latency_ms)
        threshold = float(self.config.get("threshold_ms", 0) or 0)
        detail = {"latency_ms": ms}
        if threshold:
            detail["within_threshold"] = ms <= threshold
        return self._outcome(value=ms, text=f"{ms:.0f}ms", detail=detail)


class TokenUsageMetric(Metric):
    """Token 消耗（性能维度，显式指标，越小越好）。"""

    code = "token_usage"
    dimension = "performance"
    calc_mode = "explicit"

    async def evaluate(self, ctx: SampleContext) -> MetricOutcome:
        r = ctx.response
        total = float(r.total_tokens or (r.prompt_tokens + r.completion_tokens))
        return self._outcome(
            value=total,
            text=f"{total:.0f} tokens",
            detail={"prompt": r.prompt_tokens, "completion": r.completion_tokens, "total": total},
        )


class TaskSuccessMetric(Metric):
    """任务成功率（效果维度，显式指标，0/1）。

    判定优先级：Agent 是否报错 → 期望答案精确/包含匹配 → 期望关键词全部命中。
    无任何参考答案时，仅以"是否产出非空且无错误"判定成功。
    """

    code = "task_success"
    dimension = "effect"
    calc_mode = "explicit"

    async def evaluate(self, ctx: SampleContext) -> MetricOutcome:
        if not ctx.response.succeeded:
            return self._outcome(value=0.0, text="failed", detail={"reason": ctx.response.error})

        answer = _normalize(ctx.answer)
        expected = _normalize(ctx.expected_answer)
        keywords = [str(k) for k in (ctx.ground_truth or {}).get("keywords", [])]

        if expected:
            match_mode = self.config.get("match", "contains")
            success = answer == expected if match_mode == "exact" else expected in answer
            # 期望答案命中即成功；未命中时不直接判 0，按 docstring 的优先级链
            # 继续尝试关键词匹配（期望答案多为简短范式句，难以成为自由文本回答的连续子串）。
            if success or not keywords:
                return self._outcome(
                    value=1.0 if success else 0.0,
                    text="success" if success else "mismatch",
                    detail={"match": match_mode, "expected": ctx.expected_answer[:200]},
                )
        if keywords:
            hit = [k for k in keywords if _normalize(k) in answer]
            success = len(hit) == len(keywords)
            return self._outcome(
                value=1.0 if success else 0.0,
                text=f"{len(hit)}/{len(keywords)} keywords",
                detail={"hit": hit, "missing": [k for k in keywords if k not in hit]},
            )
        success = bool(answer)
        return self._outcome(value=1.0 if success else 0.0, text="non-empty" if success else "empty")


class ToolCallAccuracyMetric(Metric):
    """工具调用正确率（过程评估 / 效果维度）。

    与 ground_truth.tool_calls 的工具名序列做匹配；有参数时连参数一起比对。
    返回命中比例（按期望工具数归一）。
    """

    code = "tool_call_accuracy"
    dimension = "effect"
    calc_mode = "explicit"

    async def evaluate(self, ctx: SampleContext) -> MetricOutcome:
        expected = ctx.expected_tool_calls
        actual = [tc.__dict__ for tc in ctx.response.tool_calls]
        if not expected:
            return self._outcome(
                value=None,
                text="no reference tool calls",
                detail={"actual_tools": [a["tool_name"] for a in actual]},
            )
        match_args = bool(self.config.get("match_args", False))
        if match_args:
            exp_set = {_tool_signature(e) for e in expected}
            act_set = {_tool_signature(a) for a in actual}
        else:
            exp_set = {(_tool_signature(e)[0],) for e in expected}
            act_set = {(_tool_signature(a)[0],) for a in actual}
        hit = exp_set & act_set
        acc = len(hit) / len(exp_set) if exp_set else 0.0
        return self._outcome(
            value=round(acc, 4),
            text=f"{len(hit)}/{len(exp_set)}",
            detail={"match_args": match_args, "expected": len(exp_set), "matched": len(hit)},
        )


class ToolCallF1Metric(Metric):
    """工具调用 F1（过程评估）。基于工具名+参数的 multiset 计算 P/R/F1（保留重复调用）。"""

    code = "tool_call_f1"
    dimension = "effect"
    calc_mode = "explicit"

    async def evaluate(self, ctx: SampleContext) -> MetricOutcome:
        from collections import Counter

        expected = ctx.expected_tool_calls
        actual = [tc.__dict__ for tc in ctx.response.tool_calls]
        if not expected:
            return self._outcome(value=None, text="no reference tool calls")

        match_args = bool(self.config.get("match_args", True))
        sig = (lambda c: _tool_signature(c)) if match_args else (lambda c: (_tool_signature(c)[0],))
        ref = Counter(sig(e) for e in expected)
        pred = Counter(sig(a) for a in actual)
        tp = sum((ref & pred).values())
        fp = sum((pred - ref).values())
        fn = sum((ref - pred).values())
        precision = tp / (tp + fp) if (tp + fp) else 0.0
        recall = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
        return self._outcome(
            value=round(f1, 4),
            text=f"F1={f1:.2f}",
            detail={"tp": tp, "fp": fp, "fn": fn, "precision": round(precision, 4), "recall": round(recall, 4)},
        )
