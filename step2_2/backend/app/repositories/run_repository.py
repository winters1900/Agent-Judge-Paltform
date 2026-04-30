from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.run import EvaluationRun, EvaluationSampleResult
from app.repositories.base import BaseRepository


class RunRepository(BaseRepository):
    def __init__(self, session: Session) -> None:
        super().__init__(session)

    def create(self, run: EvaluationRun) -> EvaluationRun:
        self.session.add(run)
        self.session.commit()
        self.session.refresh(run)
        return run

    def list(self, task_id: int | None = None, status: str | None = None) -> list[EvaluationRun]:
        stmt = select(EvaluationRun)
        if task_id is not None:
            stmt = stmt.where(EvaluationRun.task_id == task_id)
        if status:
            stmt = stmt.where(EvaluationRun.status == status)
        return list(self.session.scalars(stmt.order_by(EvaluationRun.id.desc())).all())

    def get_by_id(self, run_id: int) -> EvaluationRun | None:
        return self.session.get(EvaluationRun, run_id)

    def update(self, run: EvaluationRun) -> EvaluationRun:
        self.session.add(run)
        self.session.commit()
        self.session.refresh(run)
        return run

    def delete(self, run: EvaluationRun) -> None:
        self.session.delete(run)
        self.session.commit()

    def create_sample_result(self, sample_result: EvaluationSampleResult) -> EvaluationSampleResult:
        self.session.add(sample_result)
        self.session.commit()
        self.session.refresh(sample_result)
        return sample_result

    def list_sample_results(self, run_id: int) -> list[EvaluationSampleResult]:
        stmt = select(EvaluationSampleResult).where(EvaluationSampleResult.run_id == run_id)
        return list(self.session.scalars(stmt).all())
