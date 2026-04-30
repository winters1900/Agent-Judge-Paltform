from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.repositories.target_repository import TargetRepository
from app.schemas.target import EvaluationTargetCreate, EvaluationTargetResponse, EvaluationTargetUpdate
from app.services.target_service.target_manager import TargetManager

router = APIRouter(prefix="/api/v1/evaluation-targets", tags=["evaluation-targets"])


def get_target_manager(db: Session = Depends(get_db)) -> TargetManager:
    return TargetManager(TargetRepository(db))


@router.post("", response_model=EvaluationTargetResponse)
def create_target(payload: EvaluationTargetCreate, manager: TargetManager = Depends(get_target_manager)):
    return manager.create_target(payload)


@router.get("", response_model=list[EvaluationTargetResponse])
def list_targets(
    name: str | None = Query(default=None),
    target_type: str | None = Query(default=None),
    enabled: bool | None = Query(default=None),
    manager: TargetManager = Depends(get_target_manager),
):
    return manager.list_targets(name=name, target_type=target_type, enabled=enabled)


@router.get("/{target_id}", response_model=EvaluationTargetResponse)
def get_target(target_id: int, manager: TargetManager = Depends(get_target_manager)):
    target = manager.get_target(target_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Target not found")
    return target


@router.put("/{target_id}", response_model=EvaluationTargetResponse)
def update_target(
    target_id: int,
    payload: EvaluationTargetUpdate,
    manager: TargetManager = Depends(get_target_manager),
):
    target = manager.update_target(target_id, payload)
    if target is None:
        raise HTTPException(status_code=404, detail="Target not found")
    return target


@router.delete("/{target_id}")
def delete_target(target_id: int, manager: TargetManager = Depends(get_target_manager)):
    if not manager.delete_target(target_id):
        raise HTTPException(status_code=404, detail="Target not found")
    return {"message": "deleted"}
