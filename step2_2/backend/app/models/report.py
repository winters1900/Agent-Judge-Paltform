from sqlalchemy import BigInteger, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class EvaluationReport(TimestampMixin, Base):
    __tablename__ = "evaluation_report"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    run_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    report_title: Mapped[str] = mapped_column(String(128), nullable=False)
    report_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    report_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    report_format: Mapped[str] = mapped_column(String(32), nullable=False)
