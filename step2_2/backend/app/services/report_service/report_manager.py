import json
from pathlib import Path

from app.models.report import EvaluationReport
from app.repositories.report_repository import ReportRepository
from app.repositories.run_repository import RunRepository
from app.schemas.report import ReportCreate


class ReportManager:
    def __init__(self, report_repository: ReportRepository, run_repository: RunRepository) -> None:
        self.report_repository = report_repository
        self.run_repository = run_repository

    def list_reports(self, run_id: int):
        return self.report_repository.list_by_run_id(run_id)

    def get_report(self, report_id: int):
        return self.report_repository.get_by_id(report_id)

    def create_report(self, payload: ReportCreate) -> EvaluationReport:
        report = EvaluationReport(
            run_id=payload.run_id,
            report_title=payload.report_title,
            report_summary=payload.report_summary,
            report_path=payload.report_path,
            report_format=payload.report_format,
        )
        return self.report_repository.create(report)

    def export_report(self, run_id: int, report_format: str = "pdf") -> EvaluationReport:
        run = self.run_repository.get_by_id(run_id)
        sample_results = self.run_repository.list_sample_results(run_id)
        report_payload = {
            "run_id": run_id,
            "run_code": getattr(run, "run_code", None),
            "task_id": getattr(run, "task_id", None),
            "status": getattr(run, "status", None),
            "progress": float(getattr(run, "progress", 0) or 0),
            "summary": getattr(run, "summary", None),
            "sample_count": len(sample_results),
            "samples": [
                {
                    "sample_id": item.sample_id,
                    "status": item.status,
                    "score_summary": item.score_summary,
                    "error_message": item.error_message,
                }
                for item in sample_results
            ],
        }
        output_dir = Path("/tmp")
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / f"run_{run_id}_report.{report_format}.json"
        output_path.write_text(json.dumps(report_payload, ensure_ascii=False, indent=2), encoding="utf-8")
        report = EvaluationReport(
            run_id=run_id,
            report_title="通用 Agent 评测报告",
            report_summary=f"共 {len(sample_results)} 条样本结果",
            report_path=str(output_path),
            report_format=report_format,
        )
        return self.report_repository.create(report)
