from __future__ import annotations

from collections import Counter

from .base import Metric, MetricResult


class PlanQuality(Metric):
    name = "plan_quality"

    def __init__(self, repeat_threshold: int = 2) -> None:
        self.repeat_threshold = repeat_threshold

    def score(self, sample) -> MetricResult:
        tool_calls = [s.tool_call for s in sample.steps]
        expected_tools = [s.tool_call for s in sample.expected_steps]

        counter = Counter(tool_calls)
        repeat_penalty = sum(1 for _, c in counter.items() if c > self.repeat_threshold)

        missing = len([t for t in expected_tools if t not in tool_calls])

        length_gap = abs(len(tool_calls) - len(expected_tools))

        raw = 1.0
        raw -= 0.1 * repeat_penalty
        raw -= 0.1 * missing
        raw -= 0.05 * length_gap
        score = max(0.0, raw)

        return MetricResult(
            value=score,
            reason="规划合理性",
            traces={
                "repeat_penalty": repeat_penalty,
                "missing": missing,
                "length_gap": length_gap,
            },
        )
