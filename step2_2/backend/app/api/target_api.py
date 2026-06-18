from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.target import EvaluationTarget
from app.repositories.target_repository import TargetRepository
from app.schemas.target import (
    EvaluationTargetCreate,
    EvaluationTargetResponse,
    EvaluationTargetUpdate,
    TargetTestRequest,
    TargetTestResponse,
)
from app.services.evaluation.adapters import build_adapter
from app.services.evaluation.adapters.presets import ADAPTER_PRESETS
from app.services.target_service.target_manager import TargetManager

router = APIRouter(prefix="/api/v1/evaluation-targets", tags=["evaluation-targets"])


def get_target_manager(db: Session = Depends(get_db)) -> TargetManager:
    return TargetManager(TargetRepository(db))


@router.get("/presets")
def list_presets() -> list[dict]:
    """返回适配器配置预设，供前端「新建目标」一键填充。"""
    return ADAPTER_PRESETS


@router.post("/test", response_model=TargetTestResponse)
async def test_target(payload: TargetTestRequest):
    """连通性测试：用一条示例 prompt 真实调用一次被测对象（不落库）。"""
    transient = EvaluationTarget(
        target_code="__test__", target_type="test", name="__test__", version="0",
        endpoint=payload.endpoint, adapter_type=payload.adapter_type,
        adapter_config=payload.adapter_config or {},
    )
    adapter = build_adapter(transient)
    try:
        resp = await adapter.invoke({"prompt": payload.prompt})
    except Exception as exc:  # noqa: BLE001
        return TargetTestResponse(succeeded=False, error=f"调用异常: {exc}")
    return TargetTestResponse(
        succeeded=resp.succeeded,
        output_text=resp.output_text[:2000],
        error=resp.error,
        latency_ms=resp.latency_ms,
        total_tokens=resp.total_tokens,
        tool_calls=[{"tool_name": tc.tool_name, "input": tc.input} for tc in resp.tool_calls],
    )


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
