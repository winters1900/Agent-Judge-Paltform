from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.schemas.common import WebSocketEvent

router = APIRouter(prefix="/api/v1/ws", tags=["websocket"])


@router.websocket("/evaluation-runs/{run_id}")
async def evaluation_run_ws(websocket: WebSocket, run_id: int):
    await websocket.accept()
    try:
        for current_step in range(1, 4):
            event = WebSocketEvent(
                event="run_progress",
                run_id=run_id,
                status="running",
                progress=float(current_step) / 3 * 100,
                current_step=current_step,
                message=f"正在执行第 {current_step} 个步骤",
                updated_at=datetime.now(timezone.utc).isoformat(),
            )
            await websocket.send_json(event.model_dump())
            await asyncio.sleep(1)

        await websocket.send_json(
            WebSocketEvent(
                event="run_completed",
                run_id=run_id,
                status="completed",
                progress=100.0,
                current_step=3,
                message="运行已完成",
                updated_at=datetime.now(timezone.utc).isoformat(),
            ).model_dump()
        )
    except WebSocketDisconnect:
        return
