from __future__ import annotations

from typing import Any, Tuple

from .base import Metric, MetricResult
from utils.hashable import make_hashable


def _to_hashable(step) -> Tuple[Any, ...]:
    return (step.tool_call, make_hashable(step.input))


class ToolCallF1(Metric):
    name = "tool_call_f1"

    def score(self, sample) -> MetricResult:
        pred_set = {_to_hashable(s) for s in sample.steps}
        ref_set = {_to_hashable(s) for s in sample.expected_steps}

        tp = len(pred_set & ref_set)
        fp = len(pred_set - ref_set)
        fn = len(ref_set - pred_set)

        precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0

        return MetricResult(
            value=f1,
            reason="工具调用 F1",
            traces={"tp": tp, "fp": fp, "fn": fn, "precision": precision, "recall": recall},
        )
