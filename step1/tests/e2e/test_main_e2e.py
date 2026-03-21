"""End-to-end tests — run the full evaluation pipeline in memory.

These tests load the *real* dataset, execute all metrics, and verify the
complete output without writing any files to disk.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from data.loader import load_dataset
from evaluator.result import EvaluationResult
from evaluator.runner import run, to_markdown
from metrics.plan_quality import PlanQuality
from metrics.task_completion import TaskCompletion
from metrics.tool_call_accuracy import ToolCallAccuracy
from metrics.tool_call_f1 import ToolCallF1

DATASET_PATH = str(
    Path(__file__).resolve().parents[2] / "data" / "eval_dataset.json"
)

METRIC_NAMES = [
    "tool_call_accuracy",
    "tool_call_f1",
    "task_completion",
    "plan_quality",
]


@pytest.fixture(scope="module")
def dataset():
    """Load the real evaluation dataset once for all tests in this module."""
    return load_dataset(DATASET_PATH)


@pytest.fixture(scope="module")
def metrics():
    """Instantiate the full set of metrics used by main()."""
    return [
        ToolCallAccuracy(strict_order=True),
        ToolCallF1(),
        TaskCompletion(),
        PlanQuality(),
    ]


@pytest.fixture(scope="module")
def result(dataset, metrics):
    """Run the complete evaluation pipeline."""
    return run(dataset, metrics)


@pytest.fixture(scope="module")
def report(result):
    """Generate the Markdown report string."""
    return to_markdown(result)


# ---------- Tests ----------


class TestPipelineResult:
    """Verify the EvaluationResult returned by run()."""

    def test_returns_evaluation_result(self, result):
        assert isinstance(result, EvaluationResult)

    def test_summary_contains_all_metrics(self, result):
        for name in METRIC_NAMES:
            assert name in result.summary, f"metric '{name}' missing in summary"

    def test_summary_scores_in_valid_range(self, result):
        for name, value in result.summary.items():
            assert 0.0 <= value <= 1.0, (
                f"summary['{name}'] = {value} is out of [0, 1]"
            )

    def test_samples_count_matches_dataset(self, result, dataset):
        assert len(result.samples) == len(dataset)

    def test_each_sample_has_all_metric_scores(self, result):
        for idx, row in enumerate(result.samples):
            for name in METRIC_NAMES:
                assert name in row, (
                    f"sample #{idx} (task_id={row.get('task_id')}) "
                    f"missing metric '{name}'"
                )

    def test_each_sample_has_task_id(self, result):
        for idx, row in enumerate(result.samples):
            assert "task_id" in row, f"sample #{idx} missing 'task_id'"


class TestMarkdownReport:
    """Verify the Markdown report is well-formed."""

    def test_contains_summary_header(self, report):
        assert "# 评估结果汇总" in report

    def test_contains_overall_mean_section(self, report):
        assert "## 总体均值" in report

    def test_contains_sample_detail_section(self, report):
        assert "## 样本明细" in report

    def test_contains_table_separators(self, report):
        assert "| --- |" in report

    def test_contains_all_metric_names(self, report):
        for name in METRIC_NAMES:
            assert name in report, f"metric '{name}' not found in report"

    def test_report_line_count_reasonable(self, report, dataset):
        lines = report.strip().split("\n")
        # At minimum: header lines + summary table + detail table header + data rows
        min_expected = 5 + len(dataset)
        assert len(lines) >= min_expected, (
            f"report has {len(lines)} lines, expected at least {min_expected}"
        )