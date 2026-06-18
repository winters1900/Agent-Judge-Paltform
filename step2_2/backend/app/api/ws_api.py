from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.database import SessionLocal
from app.models.run import EvaluationRun
from app.services.ws_manager import run_event_bus

router = APIRouter(prefix="/api/v1/ws", tags=["websocket"])

_TERMINAL = {"completed", "failed", "cancelled"}


def _run_snapshot(run_id: int) -> dict | None:
    """从数据库读取一次 run 当前状态，作为订阅前的初始事件。"""
    session = SessionLocal()
    try:
        run = session.get(EvaluationRun, run_id)
        if run is None:
            return None
        return {
            "event": "run_snapshot",
            "run_id": run.id,
            "status": run.status,
            "progress": float(run.progress or 0),
            "current_step": None,
            "message": run.summary,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    finally:
        session.close()


@router.websocket("/evaluation-runs/{run_id}")
async def evaluation_run_ws(websocket: WebSocket, run_id: int):
    """实时推送某次运行的真实进度：先发当前快照，再订阅引擎事件总线。"""
    await websocket.accept()

    snapshot = _run_snapshot(run_id)
    if snapshot is None:
        await websocket.send_json({"event": "error", "run_id": run_id, "message": "运行不存在"})
        await websocket.close()
        return

    await websocket.send_json(snapshot)
    # 若运行已结束，直接收尾，无需订阅
    if snapshot["status"] in _TERMINAL:
        await websocket.close()
        return

    # 总线里若有更晚的最新事件，先补发
    latest = run_event_bus.latest(run_id)
    if latest is not None:
        await websocket.send_json(latest)

    queue = run_event_bus.subscribe(run_id)
    try:
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=30)
            except asyncio.TimeoutError:
                # 心跳，兼顾连接保活与对端断开探测
                await websocket.send_json({"event": "heartbeat", "run_id": run_id})
                continue
            await websocket.send_json(event)
            if event.get("status") in _TERMINAL or event.get("event") in {
                "run_completed",
                "run_failed",
                "run_cancelled",
            }:
                break
    except WebSocketDisconnect:
        return
    finally:
        run_event_bus.unsubscribe(run_id, queue)
