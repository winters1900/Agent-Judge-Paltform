from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.repositories.run_repository import RunRepository
from app.schemas.common import PageResponse
from app.schemas.run import EvaluationRunResponse, RunCancelResponse, RunCreate, RunSummaryResponse, SampleResultCreate, SampleResultResponse
from app.services.pagination_service import paginate
from app.services.run_service.run_manager import RunManager

router = APIRouter(prefix="/api/v1/evaluation-runs", tags=["evaluation-runs"])


def get_run_manager(db: Session = Depends(get_db)) -> RunManager:
    return RunManager(RunRepository(db))


@router.post("", response_model=EvaluationRunResponse)
def create_run(payload: RunCreate, manager: RunManager = Depends(get_run_manager)):
    return manager.create_run(payload)


@router.get("", response_model=PageResponse)
def list_runs(
    task_id: int | None = Query(default=None),
    status: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    manager: RunManager = Depends(get_run_manager),
):
    items = manager.list_runs(task_id=task_id, status=status)
    return paginate(items, page=page, page_size=page_size)


@router.get("/{run_id}", response_model=EvaluationRunResponse)
def get_run(run_id: int, manager: RunManager = Depends(get_run_manager)):
    run = manager.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


@router.put("/{run_id}", response_model=EvaluationRunResponse)
def update_run(run_id: int, payload: RunCreate, manager: RunManager = Depends(get_run_manager)):
    run = manager.update_run(run_id, payload)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


@router.delete("/{run_id}")
def delete_run(run_id: int, manager: RunManager = Depends(get_run_manager)):
    if not manager.delete_run(run_id):
        raise HTTPException(status_code=404, detail="Run not found")
    return {"message": "deleted"}


@router.post("/{run_id}/pause", response_model=RunCancelResponse)
def pause_run(run_id: int, manager: RunManager = Depends(get_run_manager)):
    run = manager.pause_run(run_id)
    if run is None:
        raise HTTPException(status_code=400, detail="Run cannot be paused")
    return RunCancelResponse(run_id=run.id, status=run.status, message="paused")


@router.post("/{run_id}/resume", response_model=RunCancelResponse)
def resume_run(run_id: int, manager: RunManager = Depends(get_run_manager)):
    run = manager.resume_run(run_id)
    if run is None:
        raise HTTPException(status_code=400, detail="Run cannot be resumed")
    return RunCancelResponse(run_id=run.id, status=run.status, message="resumed")


@router.post("/{run_id}/retry", response_model=RunCancelResponse)
def retry_run(run_id: int, manager: RunManager = Depends(get_run_manager)):
    run = manager.retry_run(run_id)
    if run is None:
        raise HTTPException(status_code=400, detail="Run cannot be retried")
    return RunCancelResponse(run_id=run.id, status=run.status, message="retried")


@router.post("/{run_id}/cancel", response_model=RunCancelResponse)
def cancel_run(run_id: int, manager: RunManager = Depends(get_run_manager)):
    run = manager.cancel_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return RunCancelResponse(run_id=run.id, status=run.status, message="cancelled")


@router.get("/{run_id}/summary", response_model=RunSummaryResponse)
def run_summary(run_id: int, manager: RunManager = Depends(get_run_manager)):
    run = manager.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return RunSummaryResponse(
        run_id=run.id,
        summary=run.summary,
        report_title=None,
        report_path=None,
        report_format=None,
    )


@router.get("/{run_id}/samples", response_model=list[SampleResultResponse])
def list_sample_results(run_id: int, manager: RunManager = Depends(get_run_manager)):
    return manager.list_sample_results(run_id)


@router.post("/{run_id}/samples", response_model=SampleResultResponse)
def create_sample_result(
    run_id: int,
    payload: SampleResultCreate,
    manager: RunManager = Depends(get_run_manager),
):
    if payload.run_id != run_id:
        raise HTTPException(status_code=400, detail="run_id mismatch")
    return manager.create_sample_result(payload)
