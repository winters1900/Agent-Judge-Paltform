from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List


@dataclass
class EvaluationResult:
    samples: List[Dict[str, Any]]
    summary: Dict[str, Any]

