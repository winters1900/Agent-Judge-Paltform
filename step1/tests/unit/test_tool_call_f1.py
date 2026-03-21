"""ToolCallF1 指标单元测试."""
from __future__ import annotations

import pytest
from data.schema import Sample, Step
from metrics.tool_call_f1 import ToolCallF1


def _step(tool: str, inp: dict | None = None) -> Step:
    return Step(step=1, thought="", tool_call=tool, input=inp or {}, observation="")


def _sample(pred_steps: list[Step], ref_steps: list[Step]) -> Sample:
    return Sample(
        task_id="t1",
        user_query="q",
        ground_truth="g",
        steps=pred_steps,
        expected_steps=ref_steps,
        final_answer="a",
    )


class TestToolCallF1:
    """ToolCallF1 的基本场景."""

    def test_both_empty(self):
        metric = ToolCallF1()
        result = metric.score(_sample([], []))
        # tp=0, fp=0, fn=0 → precision=0, recall=0 → f1=0
        assert result.value == pytest.approx(0.0)

    def test_perfect_match(self):
        steps = [_step("search", {"q": "pizza"}), _step("order", {"id": "1"})]
        metric = ToolCallF1()
        result = metric.score(_sample(steps, steps))
        assert result.value == pytest.approx(1.0)

    def test_no_overlap(self):
        pred = [_step("pay", {"amount": "10"})]
        ref = [_step("search", {"q": "pizza"})]
        metric = ToolCallF1()
        result = metric.score(_sample(pred, ref))
        assert result.value == pytest.approx(0.0)
        assert result.traces["tp"] == 0
        assert result.traces["fp"] == 1
        assert result.traces["fn"] == 1

    def test_partial_overlap(self):
        common = _step("search", {"q": "pizza"})
        pred = [common, _step("pay")]
        ref = [common, _step("order")]
        metric = ToolCallF1()
        result = metric.score(_sample(pred, ref))
        # tp=1, fp=1, fn=1 → p=0.5, r=0.5 → f1=0.5
        assert result.value == pytest.approx(0.5)
        assert result.traces["tp"] == 1

    def test_pred_superset(self):
        """pred 包含 ref 全部 + 额外项 → recall=1, precision<1."""
        ref = [_step("search")]
        pred = [_step("search"), _step("order")]
        metric = ToolCallF1()
        result = metric.score(_sample(pred, ref))
        # tp=1, fp=1, fn=0 → p=0.5, r=1 → f1=2/3
        assert result.value == pytest.approx(2.0 / 3.0)

    def test_duplicate_steps(self):
        """重复 step 在集合中只算一次."""
        s = _step("search", {"q": "a"})
        metric = ToolCallF1()
        result = metric.score(_sample([s, s], [s]))
        assert result.value == pytest.approx(1.0)