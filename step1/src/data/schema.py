from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List


@dataclass
class ToolCall:
    name: str
    args: Dict[str, Any]


@dataclass
class Step:
    step: int
    thought: str
    tool_call: str
    input: Dict[str, Any]
    observation: str


@dataclass
class Sample:
    task_id: str
    user_query: str
    ground_truth: str
    steps: List[Step]
    expected_steps: List[Step]
    final_answer: str
