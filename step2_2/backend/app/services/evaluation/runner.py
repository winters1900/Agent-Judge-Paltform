from __future__ import annotations

import asyncio
import logging

from app.core.database import SessionLocal
from app.services.evaluation.engine import EvaluationEngine

logger = logging.getLogger("evaluation.runner")

# run_id → asyncio.Task，便于查询/防重复启动
_running: dict[int, asyncio.Task] = {}


def launch_run(run_id: int) -> bool:
    """以后台 asyncio 任务启动一次评测运行。已在运行则返回 False。"""
    if run_id in _running and not _running[run_id].done():
        return False

    engine = EvaluationEngine(SessionLocal)

    async def _runner() -> None:
        try:
            await engine.run(run_id)
        except Exception:  # noqa: BLE001
            logger.exception("评测运行 %s 异常退出", run_id)
        finally:
            _running.pop(run_id, None)

    task = asyncio.create_task(_runner())
    _running[run_id] = task
    return True


def is_running(run_id: int) -> bool:
    task = _running.get(run_id)
    return bool(task and not task.done())
