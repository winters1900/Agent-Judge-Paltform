from sqlalchemy import BigInteger, Boolean, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class EvaluationMethod(TimestampMixin, Base):
    __tablename__ = "evaluation_method"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    method_code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    config_schema: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class MetricDefinition(TimestampMixin, Base):
    __tablename__ = "metric_definition"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    metric_code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    metric_type: Mapped[str] = mapped_column(String(32), nullable=False)
    dimension: Mapped[str] = mapped_column(String(32), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    calc_mode: Mapped[str] = mapped_column(String(32), nullable=False)
    config_schema: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class MetricResult(TimestampMixin, Base):
    __tablename__ = "metric_result"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    run_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sample_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    metric_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    metric_value: Mapped[float | None] = mapped_column(nullable=True)
    metric_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    metric_detail: Mapped[dict | None] = mapped_column(JSON, nullable=True)
