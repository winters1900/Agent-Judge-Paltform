from __future__ import annotations

import json
from typing import Any, Dict, List

from .schema import Sample, Step


def _safe_json_loads(value: str) -> Dict[str, Any]:
    try:
        return json.loads(value)
    except Exception:
        return {}


def _parse_steps(raw_steps: List[Dict[str, Any]]) -> List[Step]:
    steps: List[Step] = []
    for item in raw_steps or []:
        steps.append(
            Step(
                step=int(item.get("step", 0)),
                thought=str(item.get("thought", "")),
                tool_call=str(item.get("tool_call", "")),
                input=_safe_json_loads(item.get("input", "{}")),
                observation=str(item.get("observation", "")),
            )
        )
    return steps


def load_dataset(path: str) -> List[Sample]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise ValueError("数据集应为 JSON 数组")

    samples: List[Sample] = []
    for item in data:
        samples.append(
            Sample(
                task_id=str(item.get("task_id", "")),
                user_query=str(item.get("user_query", "")),
                ground_truth=str(item.get("ground_truth", "")),
                steps=_parse_steps(item.get("steps", [])),
                expected_steps=_parse_steps(item.get("expected_steps", [])),
                final_answer=str(item.get("final_answer", "")),
            )
        )
    return samples


