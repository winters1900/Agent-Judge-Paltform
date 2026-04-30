from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.repositories.trace_repository import TraceRepository
from app.schemas.common import PageResponse
from app.schemas.trace import TraceCreate, TraceResponse, ToolCallLogCreate, ToolCallLogResponse
from app.services.pagination_service import paginate
from app.services.trace_service.trace_manager import TraceManager

router = APIRouter(prefix="/api/v1", tags=["traces"])


def get_trace_manager(db: Session = Depends(get_db)) -> TraceManager:
    return TraceManager(TraceRepository(db))


@router.get("/evaluation-runs/{run_id}/traces", response_model=PageResponse)
def list_traces(
    run_id: int,
    sample_id: int | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    manager: TraceManager = Depends(get_trace_manager),
):
    items = manager.list_traces(run_id=run_id, sample_id=sample_id)
    return paginate(items, page=page, page_size=page_size)


@router.get("/evaluation-traces/{trace_id}", response_model=TraceResponse)
def get_trace(trace_id: int, manager: TraceManager = Depends(get_trace_manager)):
    trace = manager.get_trace(trace_id)
    if trace is None:
        raise HTTPException(status_code=404, detail="Trace not found")
    return trace


@router.post("/evaluation-traces", response_model=TraceResponse)
def create_trace(payload: TraceCreate, manager: TraceManager = Depends(get_trace_manager)):
    return manager.create_trace(payload)


@router.get("/evaluation-runs/{run_id}/tool-calls", response_model=PageResponse)
def list_tool_calls(
    run_id: int,
    sample_id: int | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    manager: TraceManager = Depends(get_trace_manager),
):
    items = manager.list_tool_calls(run_id=run_id, sample_id=sample_id)
    return paginate(items, page=page, page_size=page_size)


@router.post("/evaluation-tool-calls", response_model=ToolCallLogResponse)
def create_tool_call(payload: ToolCallLogCreate, manager: TraceManager = Depends(get_trace_manager)):
    return manager.create_tool_call(payload)
