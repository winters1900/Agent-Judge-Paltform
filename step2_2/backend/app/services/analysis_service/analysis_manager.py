from statistics import mean

from app.models.analysis import AnalysisResult
from app.repositories.analysis_repository import AnalysisRepository
from app.repositories.run_repository import RunRepository
from app.schemas.analysis import AnalysisCompareRequest


class AnalysisManager:
    def __init__(self, analysis_repository: AnalysisRepository, run_repository: RunRepository) -> None:
        self.analysis_repository = analysis_repository
        self.run_repository = run_repository

    def list_analyses(self):
        return self.analysis_repository.list_all()

    def get_analysis(self, analysis_id: int):
        return self.analysis_repository.get_by_id(analysis_id)

    def compare(self, payload: AnalysisCompareRequest) -> AnalysisResult:
        task_ids = payload.task_ids
        runs = [run for run in self.run_repository.list() if run.task_id in task_ids]
        sample_results = []
        for run in runs:
            sample_results.extend(self.run_repository.list_sample_results(run.id))
        scores = []
        for sample in sample_results:
            if sample.score_summary and isinstance(sample.score_summary, dict):
                score = sample.score_summary.get("score")
                if isinstance(score, (int, float)):
                    scores.append(float(score))
        result_detail = {
            "task_ids": payload.task_ids,
            "metric_keys": payload.metric_keys,
            "comparison_mode": "multi_task",
            "dimension": ["effect", "safety", "performance"],
            "run_count": len(runs),
            "sample_count": len(sample_results),
            "average_score": mean(scores) if scores else None,
            "task_run_summary": [
                {
                    "task_id": task_id,
                    "run_count": len([run for run in runs if run.task_id == task_id]),
                }
                for task_id in task_ids
            ],
        }
        analysis = AnalysisResult(
            analysis_code=f"analysis_{len(payload.task_ids)}_{len(payload.metric_keys)}",
            title="通用多任务对比分析",
            task_ids=payload.task_ids,
            metric_keys=payload.metric_keys,
            result_summary="已完成多任务对比分析",
            result_detail=result_detail,
        )
        return self.analysis_repository.create(analysis)
