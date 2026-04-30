from datetime import datetime, timezone

from app.models.dataset import DatasetSample
from app.models.run import EvaluationRun, EvaluationSampleResult
from app.repositories.run_repository import RunRepository
from app.schemas.run import RunCreate, SampleResultCreate


class RunManager:
    def __init__(self, run_repository: RunRepository) -> None:
        self.run_repository = run_repository

    def create_run(self, payload: RunCreate) -> EvaluationRun:
        run = EvaluationRun(
            run_code=payload.run_code,
            task_id=payload.task_id,
            status=payload.status,
            progress=payload.progress,
            current_sample_id=payload.current_sample_id,
            retry_count=payload.retry_count,
            summary=payload.summary,
            trace_id=payload.trace_id,
            error_message=payload.error_message,
            started_at=payload.started_at,
            ended_at=payload.ended_at,
        )
        return self.run_repository.create(run)

    def start_run(self, task_id: int, run_code: str, sample_ids: list[int]) -> EvaluationRun:
        run = EvaluationRun(
            run_code=run_code,
            task_id=task_id,
            status="running",
            progress=0,
            current_sample_id=sample_ids[0] if sample_ids else None,
            retry_count=0,
            summary="任务已启动",
            trace_id=f"run_{run_code}",
            started_at=datetime.now(timezone.utc),
        )
        created_run = self.run_repository.create(run)
        if sample_ids:
            for sample_id in sample_ids:
                self.run_repository.create_sample_result(
                    EvaluationSampleResult(
                        run_id=created_run.id,
                        sample_id=sample_id,
                        status="completed",
                        input_snapshot={"sample_id": sample_id},
                        output_snapshot={"result": "ok"},
                        score_summary={"score": 1.0},
                        started_at=datetime.now(timezone.utc),
                        ended_at=datetime.now(timezone.utc),
                    )
                )
            created_run.progress = 100
            created_run.status = "completed"
            created_run.ended_at = datetime.now(timezone.utc)
            created_run.summary = f"已完成 {len(sample_ids)} 个样本"
            self.run_repository.update(created_run)
        return created_run

    def list_runs(self, task_id: int | None = None, status: str | None = None) -> list[EvaluationRun]:
        return self.run_repository.list(task_id=task_id, status=status)

    def get_run(self, run_id: int) -> EvaluationRun | None:
        return self.run_repository.get_by_id(run_id)

    def update_run(self, run_id: int, payload: RunCreate) -> EvaluationRun | None:
        run = self.run_repository.get_by_id(run_id)
        if run is None:
            return None
        run.run_code = payload.run_code
        run.task_id = payload.task_id
        run.status = payload.status
        run.progress = payload.progress
        run.current_sample_id = payload.current_sample_id
        run.retry_count = payload.retry_count
        run.summary = payload.summary
        run.trace_id = payload.trace_id
        run.error_message = payload.error_message
        run.started_at = payload.started_at
        run.ended_at = payload.ended_at
        return self.run_repository.update(run)

    def delete_run(self, run_id: int) -> bool:
        run = self.run_repository.get_by_id(run_id)
        if run is None:
            return False
        self.run_repository.delete(run)
        return True

    def pause_run(self, run_id: int) -> EvaluationRun | None:
        run = self.run_repository.get_by_id(run_id)
        if run is None or run.status not in {"queued", "running"}:
            return None
        run.status = "paused"
        return self.run_repository.update(run)

    def resume_run(self, run_id: int) -> EvaluationRun | None:
        run = self.run_repository.get_by_id(run_id)
        if run is None or run.status != "paused":
            return None
        run.status = "running"
        return self.run_repository.update(run)

    def retry_run(self, run_id: int) -> EvaluationRun | None:
        run = self.run_repository.get_by_id(run_id)
        if run is None or run.status not in {"failed", "cancelled", "completed"}:
            return None
        run.retry_count = (run.retry_count or 0) + 1
        run.status = "queued"
        run.progress = 0
        run.error_message = None
        return self.run_repository.update(run)

    def cancel_run(self, run_id: int) -> EvaluationRun | None:
        run = self.run_repository.get_by_id(run_id)
        if run is None:
            return None
        run.status = "cancelled"
        return self.run_repository.update(run)

    def list_sample_results(self, run_id: int):
        return self.run_repository.list_sample_results(run_id)

    def create_sample_result(self, payload: SampleResultCreate) -> EvaluationSampleResult:
        sample_result = EvaluationSampleResult(
            run_id=payload.run_id,
            sample_id=payload.sample_id,
            status=payload.status,
            input_snapshot=payload.input_snapshot,
            output_snapshot=payload.output_snapshot,
            score_summary=payload.score_summary,
            error_message=payload.error_message,
            started_at=payload.started_at,
            ended_at=payload.ended_at,
        )
        return self.run_repository.create_sample_result(sample_result)
