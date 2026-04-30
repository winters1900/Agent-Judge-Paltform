from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.repositories.task_repository import TaskRepository
from app.schemas.common import PageResponse
from app.schemas.task import EvaluationTaskCreate, EvaluationTaskResponse, EvaluationTaskUpdate
from app.services.pagination_service import paginate
from app.services.task_service.task_manager import TaskManager

router = APIRouter(prefix="/api/v1/evaluation-tasks", tags=["evaluation-tasks"])


def get_task_manager(db: Session = Depends(get_db)) -> TaskManager:
    return TaskManager(TaskRepository(db))


@router.post("", response_model=EvaluationTaskResponse)
def create_task(payload: EvaluationTaskCreate, manager: TaskManager = Depends(get_task_manager)):
    task = manager.create_task(payload)
    return task


@router.get("", response_model=PageResponse)
def list_tasks(
    name: str | None = Query(default=None),
    status: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    manager: TaskManager = Depends(get_task_manager),
):
    items = manager.list_tasks(name=name, status=status)
    return paginate(items, page=page, page_size=page_size)


@router.get("/{task_id}", response_model=EvaluationTaskResponse)
def get_task(task_id: int, manager: TaskManager = Depends(get_task_manager)):
    task = manager.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.put("/{task_id}", response_model=EvaluationTaskResponse)
def update_task(
    task_id: int,
    payload: EvaluationTaskUpdate,
    manager: TaskManager = Depends(get_task_manager),
):
    task = manager.update_task(task_id, payload)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.delete("/{task_id}")
def delete_task(task_id: int, manager: TaskManager = Depends(get_task_manager)):
    if not manager.delete_task(task_id):
        raise HTTPException(status_code=404, detail="Task not found")
    return {"message": "deleted"}
