from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.target import EvaluationTarget
from app.repositories.base import BaseRepository


class TargetRepository(BaseRepository):
    def __init__(self, session: Session) -> None:
        super().__init__(session)

    def create(self, target: EvaluationTarget) -> EvaluationTarget:
        self.session.add(target)
        self.session.commit()
        self.session.refresh(target)
        return target

    def list(self, name: str | None = None, target_type: str | None = None, enabled: bool | None = None) -> list[EvaluationTarget]:
        stmt = select(EvaluationTarget)
        if name:
            stmt = stmt.where(EvaluationTarget.name.contains(name))
        if target_type:
            stmt = stmt.where(EvaluationTarget.target_type == target_type)
        if enabled is not None:
            stmt = stmt.where(EvaluationTarget.enabled == enabled)
        return list(self.session.scalars(stmt).all())

    def get_by_id(self, target_id: int) -> EvaluationTarget | None:
        return self.session.get(EvaluationTarget, target_id)

    def update(self, target: EvaluationTarget) -> EvaluationTarget:
        self.session.add(target)
        self.session.commit()
        self.session.refresh(target)
        return target

    def delete(self, target: EvaluationTarget) -> None:
        self.session.delete(target)
        self.session.commit()
