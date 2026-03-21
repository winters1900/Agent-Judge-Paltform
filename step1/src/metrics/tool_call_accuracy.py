from __future__ import annotations

from typing import Dict, List

from .base import Metric, MetricResult


class ToolCallAccuracy(Metric):
    name = "tool_call_accuracy"

    def __init__(self, strict_order: bool = True) -> None:
        self.strict_order = strict_order

    def _arg_score(self, preds: Dict, refs: Dict) -> float:
        if not refs and not preds:
            return 1.0
        if not refs:
            return 0.0
        matched = 0
        for k, v in refs.items():
            if k in preds and preds[k] == v:
                matched += 1
        return matched / len(refs)

    def _is_aligned(self, pred_seq: List[str], ref_seq: List[str]) -> bool:
        if self.strict_order:
            return pred_seq == ref_seq
        return sorted(pred_seq) == sorted(ref_seq)

    def score(self, sample) -> MetricResult:
        preds = sample.steps
        refs = sample.expected_steps

        if not preds and not refs:
            return MetricResult(1.0, reason="pred/ref 都为空")
        if not preds and refs:
            return MetricResult(0.0, reason="预测为空")
        if preds and not refs:
            return MetricResult(0.0, reason="参考为空")

        pred_seq = [s.tool_call for s in preds]
        ref_seq = [s.tool_call for s in refs]
        aligned = 1.0 if self._is_aligned(pred_seq, ref_seq) else 0.0

        compared = min(len(preds), len(refs))
        score_sum = 0.0
        for pred_step, ref_step in zip(preds, refs):
            if pred_step.tool_call == ref_step.tool_call:
                score_sum += self._arg_score(pred_step.input, ref_step.input)

        avg_arg_score = score_sum / max(len(refs), 1)
        coverage = compared / max(len(refs), 1)
        score = avg_arg_score * coverage * aligned

        return MetricResult(
            value=score,
            reason="工具调用准确度",
            traces={
                "aligned": aligned,
                "coverage": coverage,
                "avg_arg_score": avg_arg_score,
            },
        )
