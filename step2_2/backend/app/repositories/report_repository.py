from sqlalchemy.orm import Session

from app.repositories.base import BaseRepository


class ReportRepository(BaseRepository):
    def __init__(self, session: Session) -> None:
        super().__init__(session)
