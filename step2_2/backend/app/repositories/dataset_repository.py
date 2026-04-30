from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.dataset import Dataset, DatasetSample
from app.repositories.base import BaseRepository


class DatasetRepository(BaseRepository):
    def __init__(self, session: Session) -> None:
        super().__init__(session)

    def create(self, dataset: Dataset) -> Dataset:
        self.session.add(dataset)
        self.session.commit()
        self.session.refresh(dataset)
        return dataset

    def list(self, name: str | None = None, status: str | None = None) -> list[Dataset]:
        stmt = select(Dataset)
        if name:
            stmt = stmt.where(Dataset.name.contains(name))
        if status:
            stmt = stmt.where(Dataset.status == status)
        return list(self.session.scalars(stmt.order_by(Dataset.id.desc())).all())

    def get_by_id(self, dataset_id: int) -> Dataset | None:
        return self.session.get(Dataset, dataset_id)

    def get_by_code(self, dataset_code: str) -> Dataset | None:
        stmt = select(Dataset).where(Dataset.dataset_code == dataset_code)
        return self.session.scalars(stmt).first()

    def update(self, dataset: Dataset) -> Dataset:
        self.session.add(dataset)
        self.session.commit()
        self.session.refresh(dataset)
        return dataset

    def delete(self, dataset: Dataset) -> None:
        self.session.delete(dataset)
        self.session.commit()

    def create_sample(self, sample: DatasetSample) -> DatasetSample:
        self.session.add(sample)
        self.session.commit()
        self.session.refresh(sample)
        return sample

    def update_sample(self, sample: DatasetSample) -> DatasetSample:
        self.session.add(sample)
        self.session.commit()
        self.session.refresh(sample)
        return sample

    def delete_sample(self, sample: DatasetSample) -> None:
        self.session.delete(sample)
        self.session.commit()

    def get_sample_by_id(self, dataset_id: int, sample_id: int) -> DatasetSample | None:
        stmt = select(DatasetSample).where(DatasetSample.id == sample_id, DatasetSample.dataset_id == dataset_id)
        return self.session.scalars(stmt).first()

    def list_samples(self, dataset_id: int) -> list[DatasetSample]:
        stmt = select(DatasetSample).where(DatasetSample.dataset_id == dataset_id)
        return list(self.session.scalars(stmt).all())
