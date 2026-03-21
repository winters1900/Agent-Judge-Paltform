"""Shared fixtures for all tests."""
from __future__ import annotations

import sys
import os

# 将 src 目录加入 sys.path，使 metrics / data / evaluator / utils 可直接 import
sys.path.insert(0, os.path.join(os.path.dirname(__file__), os.pardir, "src"))