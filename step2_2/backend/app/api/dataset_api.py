from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.repositories.dataset_repository import DatasetRepository
from app.schemas.common import PageResponse
from app.schemas.dataset import DatasetCreate, DatasetResponse, DatasetSampleCreate, DatasetSampleImportRequest, DatasetSampleResponse, DatasetSampleUpdate
from app.services.dataset_service.dataset_manager import DatasetManager
from app.services.pagination_service import paginate

router = APIRouter(prefix="/api/v1/datasets", tags=["datasets"])


def get_dataset_manager(db: Session = Depends(get_db)) -> DatasetManager:
    return DatasetManager(DatasetRepository(db))


@router.post("", response_model=DatasetResponse)
def create_dataset(payload: DatasetCreate, manager: DatasetManager = Depends(get_dataset_manager)):
    return manager.create_dataset(payload)


@router.get("", response_model=PageResponse)
def list_datasets(
    name: str | None = Query(default=None),
    status: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    manager: DatasetManager = Depends(get_dataset_manager),
):
    items = manager.list_datasets(name=name, status=status)
    return paginate(items, page=page, page_size=page_size)


@router.get("/{dataset_id}", response_model=DatasetResponse)
def get_dataset(dataset_id: int, manager: DatasetManager = Depends(get_dataset_manager)):
    dataset = manager.get_dataset(dataset_id)
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return dataset


@router.put("/{dataset_id}", response_model=DatasetResponse)
def update_dataset(
    dataset_id: int,
    payload: DatasetCreate,
    manager: DatasetManager = Depends(get_dataset_manager),
):
    dataset = manager.update_dataset(dataset_id, payload)
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return dataset


@router.delete("/{dataset_id}")
def delete_dataset(dataset_id: int, manager: DatasetManager = Depends(get_dataset_manager)):
    if not manager.delete_dataset(dataset_id):
        raise HTTPException(status_code=404, detail="Dataset not found")
    return {"message": "deleted"}


@router.post("/{dataset_id}/samples", response_model=DatasetSampleResponse)
def create_sample(
    dataset_id: int,
    payload: DatasetSampleCreate,
    manager: DatasetManager = Depends(get_dataset_manager),
):
    sample = manager.create_sample(dataset_id, payload)
    if sample is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return sample


@router.post("/{dataset_id}/samples/import", response_model=list[DatasetSampleResponse])
def import_samples(
    dataset_id: int,
    payload: DatasetSampleImportRequest,
    manager: DatasetManager = Depends(get_dataset_manager),
):
    samples = manager.import_samples(dataset_id, payload)
    if not samples:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return samples


@router.get("/{dataset_id}/samples", response_model=PageResponse)
def list_samples(
    dataset_id: int,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    manager: DatasetManager = Depends(get_dataset_manager),
):
    items = manager.list_samples(dataset_id)
    return paginate(items, page=page, page_size=page_size)


@router.put("/{dataset_id}/samples/{sample_id}", response_model=DatasetSampleResponse)
def update_sample(
    dataset_id: int,
    sample_id: int,
    payload: DatasetSampleUpdate,
    manager: DatasetManager = Depends(get_dataset_manager),
):
    sample = manager.update_sample(dataset_id, sample_id, payload)
    if sample is None:
        raise HTTPException(status_code=404, detail="Dataset sample not found")
    return sample


@router.get("/{dataset_id}/samples/export")
def export_samples(
    dataset_id: int,
    manager: DatasetManager = Depends(get_dataset_manager),
):
    dataset = manager.get_dataset(dataset_id)
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    output_path = manager.export_samples_json(dataset_id, f"/tmp/dataset_{dataset_id}_samples.json")
    return FileResponse(output_path, media_type="application/json", filename=f"dataset_{dataset_id}_samples.json")


@router.delete("/{dataset_id}/samples/{sample_id}")
def delete_sample(
    dataset_id: int,
    sample_id: int,
    manager: DatasetManager = Depends(get_dataset_manager),
):
    if not manager.delete_sample(dataset_id, sample_id):
        raise HTTPException(status_code=404, detail="Dataset sample not found")
    return {"message": "deleted"}
