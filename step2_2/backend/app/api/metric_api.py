from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.repositories.metric_repository import MetricRepository
from app.schemas.common import PageResponse
from app.schemas.metric import EvaluationMethodResponse, MetricCreate, MetricDefinitionResponse, MetricResultResponse
from app.services.metric_service.metric_manager import MetricManager
from app.services.pagination_service import paginate

router = APIRouter(prefix="/api/v1", tags=["metrics"])


def get_metric_manager(db: Session = Depends(get_db)) -> MetricManager:
    return MetricManager(MetricRepository(db))


@router.get("/evaluation-methods", response_model=list[EvaluationMethodResponse])
def list_methods(manager: MetricManager = Depends(get_metric_manager)):
    return manager.list_methods()


@router.get("/metrics", response_model=PageResponse)
def list_metrics(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    manager: MetricManager = Depends(get_metric_manager),
):
    items = manager.list_metrics()
    return paginate(items, page=page, page_size=page_size)


@router.post("/metrics", response_model=MetricDefinitionResponse)
def create_metric(payload: MetricCreate, manager: MetricManager = Depends(get_metric_manager)):
    return manager.create_metric(payload)


@router.get("/metrics/{metric_id}", response_model=MetricDefinitionResponse)
def get_metric(metric_id: int, manager: MetricManager = Depends(get_metric_manager)):
    metric = manager.get_metric(metric_id)
    if metric is None:
        raise HTTPException(status_code=404, detail="Metric not found")
    return metric


@router.put("/metrics/{metric_id}", response_model=MetricDefinitionResponse)
def update_metric(metric_id: int, payload: MetricCreate, manager: MetricManager = Depends(get_metric_manager)):
    metric = manager.update_metric(metric_id, payload)
    if metric is None:
        raise HTTPException(status_code=404, detail="Metric not found")
    return metric


@router.get("/evaluation-runs/{run_id}/metrics", response_model=list[MetricResultResponse])
def list_results(
    run_id: int,
    sample_id: int | None = Query(default=None),
    manager: MetricManager = Depends(get_metric_manager),
):
    return manager.list_results(run_id=run_id, sample_id=sample_id)
