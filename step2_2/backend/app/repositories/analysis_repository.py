from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.analysis import AnalysisResult
from app.repositories.base import BaseRepository


class AnalysisRepository(BaseRepository):
    def __init__(self, session: Session) -> None:
        super().__init__(session)

    def create(self, analysis: AnalysisResult) -> AnalysisResult:
        self.session.add(analysis)
        self.session.commit()
        self.session.refresh(analysis)
        return analysis

    def list_all(self) -> list[AnalysisResult]:
        stmt = select(AnalysisResult)
        return list(self.session.scalars(stmt.order_by(AnalysisResult.id.desc())).all())

    def get_by_id(self, analysis_id: int) -> AnalysisResult | None:
        return self.session.get(AnalysisResult, analysis_id)

    def get_by_code(self, analysis_code: str) -> AnalysisResult | None:
        stmt = select(AnalysisResult).where(AnalysisResult.analysis_code == analysis_code)
        return self.session.scalars(stmt).first()
