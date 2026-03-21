"""评估调度器 (runner) 集成测试."""
from __future__ import annotations

import pytest
from data.schema import Sample, Step
from evaluator.runner import run, to_markdown
from metrics.tool_call_accuracy import ToolCallAccuracy
from metrics.plan_quality import PlanQuality


def _step(tool: str, inp: dict | None = None) -> Step:
    return Step(step=1, thought="", tool_call=tool, input=inp or {}, observation="")


def _sample(task_id: str, pred_tools: list[str], ref_tools: list[str]) -> Sample:
    return Sample(
        task_id=task_id,
        user_query="q",
        ground_truth="g",
        steps=[_step(t) for t in pred_tools],
        expected_steps=[_step(t) for t in ref_tools],
        final_answer="a",
    )


class TestRunner:
    """run() 集成测试."""

    def test_basic_run(self):
        dataset = [
            _sample("s1", ["search", "order"], ["search", "order"]),
            _sample("s2", ["search"], ["search", "order"]),
        ]
        metrics = [ToolCallAccuracy(strict_order=True), PlanQuality()]
        result = run(dataset, metrics)

        assert len(result.samples) == 2
        assert "tool_call_accuracy" in result.summary
        assert "plan_quality" in result.summary
        # s1 完美匹配 → accuracy=1.0; s2 不完美 → accuracy<1.0
        assert result.summary["tool_call_accuracy"] < 1.0

    def test_empty_dataset(self):
        result = run([], [ToolCallAccuracy()])
        assert result.samples == []
        assert result.summary["tool_call_accuracy"] == pytest.approx(0.0)

    def test_single_sample(self):
        dataset = [_sample("s1", ["search"], ["search"])]
        metrics = [PlanQuality()]
        result = run(dataset, metrics)
        assert len(result.samples) == 1
        assert result.summary["plan_quality"] == pytest.approx(1.0)

    def test_sample_rows_contain_traces(self):
        dataset = [_sample("s1", ["search"], ["search"])]
        metrics = [ToolCallAccuracy()]
        result = run(dataset, metrics)
        row = result.samples[0]
        assert "tool_call_accuracy_traces" in row


class TestToMarkdown:
    """to_markdown() 输出格式验证."""

    def test_markdown_contains_header(self):
        dataset = [_sample("s1", ["search"], ["search"])]
        metrics = [PlanQuality()]
        result = run(dataset, metrics)
        md = to_markdown(result)
        assert "# 评估结果汇总" in md
        assert "plan_quality" in md

    def test_empty_result(self):
        from evaluator.result import EvaluationResult
        result = EvaluationResult(samples=[], summary={"x": 0.5})
        md = to_markdown(result)
        assert "无样本" in md