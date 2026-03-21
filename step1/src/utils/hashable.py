from __future__ import annotations

from typing import Any


def make_hashable(obj: Any):
    if isinstance(obj, dict):
        return frozenset((k, make_hashable(v)) for k, v in obj.items())
    if isinstance(obj, (list, tuple)):
        return tuple(make_hashable(i) for i in obj)
    if isinstance(obj, set):
        return frozenset(make_hashable(i) for i in obj)
    return obj

