from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from app.services.evaluation.types import AgentResponse


class TargetAdapter(ABC):
    """被测对象适配器：把数据集样本输入交给某个 Agent，返回归一化的 AgentResponse。"""

    def __init__(self, *, endpoint: str | None, config: dict[str, Any]) -> None:
        self.endpoint = endpoint
        self.config = config or {}

    @abstractmethod
    async def invoke(self, input_payload: dict[str, Any]) -> AgentResponse:
        """执行一次被测 Agent 调用。实现需自行计时并捕获异常，失败时返回 succeeded=False。"""
        raise NotImplementedError
