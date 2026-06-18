from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any


class RunEventBus:
    """按 run_id 维度的进度事件总线（进程内）。

    - 引擎用 publish() 推送 run_progress / sample_completed / run_completed 等事件
    - WebSocket 端点用 subscribe() 拿到一个队列，实时转发给前端
    每个事件还会缓存到 history，便于晚加入的订阅者立即拉到最新状态。
    """

    def __init__(self) -> None:
        self._subscribers: dict[int, set[asyncio.Queue]] = defaultdict(set)
        self._history: dict[int, dict[str, Any]] = {}

    async def publish(self, run_id: int, event: dict[str, Any]) -> None:
        self._history[run_id] = event
        for queue in list(self._subscribers.get(run_id, ())):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                pass

    def latest(self, run_id: int) -> dict[str, Any] | None:
        return self._history.get(run_id)

    def subscribe(self, run_id: int) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=256)
        self._subscribers[run_id].add(queue)
        return queue

    def unsubscribe(self, run_id: int, queue: asyncio.Queue) -> None:
        subs = self._subscribers.get(run_id)
        if subs and queue in subs:
            subs.discard(queue)
            if not subs:
                self._subscribers.pop(run_id, None)


# 全局单例
run_event_bus = RunEventBus()
