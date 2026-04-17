from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.repositories.dataset_repository import DatasetRepository
from app.schemas.dataset import DatasetCreate, DatasetResponse, DatasetSampleCreate, DatasetSampleResponse
from app.services.dataset_service.dataset_manager import DatasetManager

router = APIRouter(prefix="/api/v1/datasets", tags=["datasets"])


def get_dataset_manager(db: Session = Depends(get_db)) -> DatasetManager:
    return DatasetManager(DatasetRepository(db))


@router.post("", response_model=DatasetResponse)
def create_dataset(payload: DatasetCreate, manager: DatasetManager = Depends(get_dataset_manager)):
    return manager.create_dataset(payload)


@router.get("", response_model=list[DatasetResponse])
def list_datasets(
    name: str | None = Query(default=None),
    status: str | None = Query(default=None),
    manager: DatasetManager = Depends(get_dataset_manager),
):
    return manager.list_datasets(name=name, status=status)


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


@router.get("/{dataset_id}/samples", response_model=list[DatasetSampleResponse])
def list_samples(dataset_id: int, manager: DatasetManager = Depends(get_dataset_manager)):
    return manager.list_samples(dataset_id)
