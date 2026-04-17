from sqlalchemy.orm import Session

from app.repositories.base import BaseRepository


class AnalysisRepository(BaseRepository):
    def __init__(self, session: Session) -> None:
        super().__init__(session)
