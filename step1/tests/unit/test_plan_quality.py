"""PlanQuality 指标单元测试."""
from __future__ import annotations

import pytest
from data.schema import Sample, Step
from metrics.plan_quality import PlanQuality


def _step(tool: str) -> Step:
    return Step(step=1, thought="", tool_call=tool, input={}, observation="")


def _sample(pred_tools: list[str], ref_tools: list[str]) -> Sample:
    return Sample(
        task_id="t1",
        user_query="q",
        ground_truth="g",
        steps=[_step(t) for t in pred_tools],
        expected_steps=[_step(t) for t in ref_tools],
        final_answer="a",
    )


class TestPlanQuality:
    """PlanQuality 的基本场景."""

    def test_perfect_plan(self):
        metric = PlanQuality()
        result = metric.score(_sample(["search", "order"], ["search", "order"]))
        assert result.value == pytest.approx(1.0)

    def test_repeat_penalty(self):
        """同一工具调用超过 repeat_threshold 次 → 扣分."""
        metric = PlanQuality(repeat_threshold=2)
        # search 出现 3 次 → repeat_penalty=1 → -0.1
        result = metric.score(
            _sample(["search", "search", "search", "order"], ["search", "order"])
        )
        assert result.traces["repeat_penalty"] == 1
        assert result.value < 1.0

    def test_missing_tool(self):
        """缺少参考中的工具 → 扣分."""
        metric = PlanQuality()
        result = metric.score(_sample(["search"], ["search", "order", "pay"]))
        assert result.traces["missing"] == 2  # order, pay 缺失
        assert result.value < 1.0

    def test_length_gap(self):
        """步骤数差异 → 扣分."""
        metric = PlanQuality()
        result = metric.score(_sample(["search"], ["search", "order", "pay"]))
        assert result.traces["length_gap"] == 2

    def test_score_floor_zero(self):
        """扣分过多时分数不低于 0."""
        metric = PlanQuality(repeat_threshold=1)
        # 大量重复 + 缺失 → 扣分超过 1.0
        pred = ["a"] * 20
        ref = ["b", "c", "d", "e", "f", "g", "h", "i", "j", "k"]
        result = metric.score(_sample(pred, ref))
        assert result.value == pytest.approx(0.0)

    def test_both_empty(self):
        metric = PlanQuality()
        result = metric.score(_sample([], []))
        # no penalty → 1.0
        assert result.value == pytest.approx(1.0)