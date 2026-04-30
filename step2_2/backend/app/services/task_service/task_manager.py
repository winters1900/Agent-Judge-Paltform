from datetime import datetime, timezone
from uuid import uuid4

from app.models.task import EvaluationTask
from app.repositories.task_repository import TaskRepository
from app.schemas.task import EvaluationTaskCreate, EvaluationTaskUpdate


class TaskManager:
    def __init__(self, task_repository: TaskRepository) -> None:
        self.task_repository = task_repository

    def create_task(self, payload: EvaluationTaskCreate) -> EvaluationTask:
        task = EvaluationTask(
            task_code=f"task_{uuid4().hex[:8]}",
            name=payload.name,
            description=payload.description,
            target_id=payload.target_id,
            target_type=payload.target_type,
            target_version=payload.target_version,
            dataset_id=payload.dataset_id,
            status=payload.status,
            metric_config=payload.metric_config,
            evaluation_method_config=payload.evaluation_method_config,
            run_config=payload.run_config,
            input_schema=payload.input_schema,
            output_schema=payload.output_schema,
            created_by=payload.created_by,
            updated_by=payload.updated_by,
            deleted_at=None,
        )
        return self.task_repository.create(task)

    def list_tasks(self, name: str | None = None, status: str | None = None) -> list[EvaluationTask]:
        return self.task_repository.list(name=name, status=status)

    def get_task(self, task_id: int) -> EvaluationTask | None:
        return self.task_repository.get_by_id(task_id)

    def update_task(self, task_id: int, payload: EvaluationTaskUpdate) -> EvaluationTask | None:
        task = self.task_repository.get_by_id(task_id)
        if task is None:
            return None

        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(task, field, value)
        task.updated_at = datetime.now(timezone.utc)
        return self.task_repository.update(task)

    def delete_task(self, task_id: int) -> bool:
        task = self.task_repository.get_by_id(task_id)
        if task is None:
            return False
        self.task_repository.delete(task)
        return True
