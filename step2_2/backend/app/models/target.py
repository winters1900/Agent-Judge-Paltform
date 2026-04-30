from sqlalchemy import BigInteger, Boolean, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class EvaluationTarget(TimestampMixin, Base):
    __tablename__ = "evaluation_target"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    target_code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    target_type: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[str] = mapped_column(String(64), nullable=False)
    endpoint: Mapped[str | None] = mapped_column(String(255), nullable=True)
    adapter_type: Mapped[str] = mapped_column(String(64), nullable=False)
    adapter_config: Mapped[dict] = mapped_column(JSON, nullable=False)
    input_schema: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    output_schema: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
