from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.task import EvaluationTask
from app.repositories.base import BaseRepository


class TaskRepository(BaseRepository):
    def __init__(self, session: Session) -> None:
        super().__init__(session)

    def create(self, task: EvaluationTask) -> EvaluationTask:
        self.session.add(task)
        self.session.commit()
        self.session.refresh(task)
        return task

    def list(self, name: str | None = None, status: str | None = None) -> list[EvaluationTask]:
        stmt = select(EvaluationTask)
        if name:
            stmt = stmt.where(EvaluationTask.name.contains(name))
        if status:
            stmt = stmt.where(EvaluationTask.status == status)
        return list(self.session.scalars(stmt.order_by(EvaluationTask.id.desc())).all())

    def get_by_id(self, task_id: int) -> EvaluationTask | None:
        return self.session.get(EvaluationTask, task_id)

    def get_by_code(self, task_code: str) -> EvaluationTask | None:
        stmt = select(EvaluationTask).where(EvaluationTask.task_code == task_code)
        return self.session.scalars(stmt).first()

    def update(self, task: EvaluationTask) -> EvaluationTask:
        self.session.add(task)
        self.session.commit()
        self.session.refresh(task)
        return task

    def delete(self, task: EvaluationTask) -> None:
        self.session.delete(task)
        self.session.commit()
