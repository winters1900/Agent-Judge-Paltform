from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional


@dataclass
class MetricResult:
    value: float
    reason: Optional[str] = None
    traces: Optional[Dict[str, Any]] = None


class Metric:
    name: str = "metric"

    def score(self, sample) -> MetricResult:
        raise NotImplementedError

    def explain(self, sample) -> Dict[str, Any]:
        return {}
