from __future__ import annotations

from pathlib import Path

from data.loader import load_dataset
from evaluator.runner import run, to_markdown
from metrics.tool_call_accuracy import ToolCallAccuracy
from metrics.tool_call_f1 import ToolCallF1
from metrics.task_completion import TaskCompletion
from metrics.plan_quality import PlanQuality


def main() -> None:
    dataset_path = Path(__file__).resolve().parents[1] / "data" / "eval_dataset.json"
    dataset = load_dataset(str(dataset_path))
    metrics = [
        ToolCallAccuracy(strict_order=True),
        ToolCallF1(),
        TaskCompletion(),
        PlanQuality(),
    ]

    result = run(dataset, metrics)
    report = to_markdown(result)

    reports_dir = Path(__file__).resolve().parents[1] / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    report_path = reports_dir / "eval_report.md"
    report_path.write_text(report, encoding="utf-8")

    print("Summary:", result.summary)
    print(f"Report saved to: {report_path}")


if __name__ == "__main__":
    main()

