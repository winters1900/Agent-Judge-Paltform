from app.models.run import EvaluationRun
from app.repositories.run_repository import RunRepository
from app.schemas.run import RunCreate


class RunManager:
    def __init__(self, run_repository: RunRepository) -> None:
        self.run_repository = run_repository

    def create_run(self, payload: RunCreate) -> EvaluationRun:
        run = EvaluationRun(
            run_code=payload.run_code,
            task_id=payload.task_id,
            status=payload.status,
            progress=payload.progress,
            summary=payload.summary,
            trace_id=payload.trace_id,
            error_message=payload.error_message,
            started_at=payload.started_at,
            ended_at=payload.ended_at,
        )
        return self.run_repository.create(run)

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

    def cancel_run(self, run_id: int) -> EvaluationRun | None:
        run = self.run_repository.get_by_id(run_id)
        if run is None:
            return None
        run.status = "cancelled"
        return self.run_repository.update(run)

    def list_sample_results(self, run_id: int):
        return self.run_repository.list_sample_results(run_id)
