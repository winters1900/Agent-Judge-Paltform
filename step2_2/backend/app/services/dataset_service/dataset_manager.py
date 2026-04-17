from app.models.dataset import Dataset, DatasetSample
from app.repositories.dataset_repository import DatasetRepository
from app.schemas.dataset import DatasetCreate, DatasetSampleCreate


class DatasetManager:
    def __init__(self, dataset_repository: DatasetRepository) -> None:
        self.dataset_repository = dataset_repository

    def create_dataset(self, payload: DatasetCreate) -> Dataset:
        dataset = Dataset(
            dataset_code=payload.dataset_code,
            name=payload.name,
            description=payload.description,
            source_type=payload.source_type,
            version=payload.version,
            status=payload.status,
        )
        return self.dataset_repository.create(dataset)

    def list_datasets(self, name: str | None = None, status: str | None = None) -> list[Dataset]:
        return self.dataset_repository.list(name=name, status=status)

    def get_dataset(self, dataset_id: int) -> Dataset | None:
        return self.dataset_repository.get_by_id(dataset_id)

    def update_dataset(self, dataset_id: int, payload: DatasetCreate) -> Dataset | None:
        dataset = self.dataset_repository.get_by_id(dataset_id)
        if dataset is None:
            return None
        dataset.dataset_code = payload.dataset_code
        dataset.name = payload.name
        dataset.description = payload.description
        dataset.source_type = payload.source_type
        dataset.version = payload.version
        dataset.status = payload.status
        return self.dataset_repository.update(dataset)

    def delete_dataset(self, dataset_id: int) -> bool:
        dataset = self.dataset_repository.get_by_id(dataset_id)
        if dataset is None:
            return False
        self.dataset_repository.delete(dataset)
        return True

    def create_sample(self, dataset_id: int, payload: DatasetSampleCreate) -> DatasetSample | None:
        dataset = self.dataset_repository.get_by_id(dataset_id)
        if dataset is None:
            return None
        sample = DatasetSample(
            dataset_id=dataset_id,
            sample_code=payload.sample_code,
            input_payload=payload.input_payload,
            expected_output=payload.expected_output,
            reference_context=payload.reference_context,
            ground_truth=payload.ground_truth,
            sample_type=payload.sample_type,
            metadata=payload.metadata,
        )
        return self.dataset_repository.create_sample(sample)

    def list_samples(self, dataset_id: int):
        return self.dataset_repository.list_samples(dataset_id)
