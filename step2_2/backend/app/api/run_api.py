from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.repositories.run_repository import RunRepository
from app.schemas.run import EvaluationRunResponse, RunCancelResponse, RunCreate, RunSummaryResponse, SampleResultResponse
from app.services.run_service.run_manager import RunManager

router = APIRouter(prefix="/api/v1/evaluation-runs", tags=["evaluation-runs"])


def get_run_manager(db: Session = Depends(get_db)) -> RunManager:
    return RunManager(RunRepository(db))


@router.post("", response_model=EvaluationRunResponse)
def create_run(payload: RunCreate, manager: RunManager = Depends(get_run_manager)):
    return manager.create_run(payload)


@router.get("", response_model=list[EvaluationRunResponse])
def list_runs(
    task_id: int | None = Query(default=None),
    status: str | None = Query(default=None),
    manager: RunManager = Depends(get_run_manager),
):
    return manager.list_runs(task_id=task_id, status=status)


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
