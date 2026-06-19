from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from app.core.database import SessionLocal
from app.services.evaluation.engine import EvaluationEngine

logger = logging.getLogger("evaluation.runner")

# run_id → asyncio.Task，便于查询/防重复启动
_running: dict[int, asyncio.Task] = {}

# 进程内未结束、但实际已无任务驱动的 run 状态
_NON_TERMINAL = ("queued", "running", "paused")


def reconcile_orphaned_runs() -> int:
    """启动时把残留在非终态的 run 标记为 failed。

    后台执行任务只存在于进程内的 _running 中。一旦后端进程重启/崩溃，
    这些任务即丢失，但 DB 里的 run 仍停留在 queued/running/paused，
    永远不会收尾（典型表现：进度卡住、ended_at 早于 started_at）。
    新进程启动时 _running 必为空，故此刻所有非终态 run 都是孤儿。
    """
    from sqlalchemy import select

    from app.models.run import EvaluationRun

    session = SessionLocal()
    try:
        stmt = select(EvaluationRun).where(EvaluationRun.status.in_(_NON_TERMINAL))
        orphans = list(session.scalars(stmt).all())
        for run in orphans:
            run.status = "failed"
            run.error_message = "运行被中断（服务重启导致执行任务丢失），已自动标记为失败，可重试。"
            run.ended_at = datetime.now(timezone.utc)
        if orphans:
            session.commit()
            logger.warning("已对账 %d 个孤儿运行为 failed: %s", len(orphans), [r.id for r in orphans])
        return len(orphans)
    finally:
        session.close()


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
