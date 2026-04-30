from sqlalchemy import BigInteger, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Dataset(TimestampMixin, Base):
    __tablename__ = "dataset"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    dataset_code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_type: Mapped[str] = mapped_column(String(32), nullable=False)
    sample_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    version: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    created_by: Mapped[int | None] = mapped_column(BigInteger, nullable=True)


class DatasetSample(TimestampMixin, Base):
    __tablename__ = "dataset_sample"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    dataset_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sample_code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    input_payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    expected_output: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    reference_context: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    ground_truth: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    sample_type: Mapped[str] = mapped_column(String(32), nullable=False)
    metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)
