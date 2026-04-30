import json
from pathlib import Path

from app.models.dataset import Dataset, DatasetSample
from app.repositories.dataset_repository import DatasetRepository
from app.schemas.dataset import DatasetCreate, DatasetSampleCreate, DatasetSampleImportRequest, DatasetSampleUpdate


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
        created = self.dataset_repository.create_sample(sample)
        dataset.sample_count = (dataset.sample_count or 0) + 1
        self.dataset_repository.update(dataset)
        return created

    def update_sample(self, dataset_id: int, sample_id: int, payload: DatasetSampleUpdate) -> DatasetSample | None:
        sample = self.dataset_repository.get_sample_by_id(dataset_id, sample_id)
        if sample is None:
            return None
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(sample, field, value)
        return self.dataset_repository.update_sample(sample)

    def delete_sample(self, dataset_id: int, sample_id: int) -> bool:
        sample = self.dataset_repository.get_sample_by_id(dataset_id, sample_id)
        if sample is None:
            return False
        self.dataset_repository.delete_sample(sample)
        dataset = self.dataset_repository.get_by_id(dataset_id)
        if dataset is not None:
            dataset.sample_count = max((dataset.sample_count or 0) - 1, 0)
            self.dataset_repository.update(dataset)
        return True

    def import_samples(self, dataset_id: int, payload: DatasetSampleImportRequest) -> list[DatasetSample]:
        created_samples = []
        for sample_payload in payload.samples:
            sample = DatasetSample(
                dataset_id=dataset_id,
                sample_code=sample_payload.sample_code,
                input_payload=sample_payload.input_payload,
                expected_output=sample_payload.expected_output,
                reference_context=sample_payload.reference_context,
                ground_truth=sample_payload.ground_truth,
                sample_type=sample_payload.sample_type,
                metadata=sample_payload.metadata,
            )
            created_samples.append(self.dataset_repository.create_sample(sample))
        dataset = self.dataset_repository.get_by_id(dataset_id)
        if dataset is not None:
            dataset.sample_count = (dataset.sample_count or 0) + len(created_samples)
            self.dataset_repository.update(dataset)
        return created_samples

    def export_samples(self, dataset_id: int) -> list[dict]:
        samples = self.dataset_repository.list_samples(dataset_id)
        return [
            {
                "sample_code": sample.sample_code,
                "sample_type": sample.sample_type,
                "input_payload": sample.input_payload,
                "expected_output": sample.expected_output,
                "reference_context": sample.reference_context,
                "ground_truth": sample.ground_truth,
                "metadata": sample.metadata,
            }
            for sample in samples
        ]

    def export_samples_json(self, dataset_id: int, output_path: str) -> str:
        data = self.export_samples(dataset_id)
        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return str(path)

    def list_samples(self, dataset_id: int):
        return self.dataset_repository.list_samples(dataset_id)
