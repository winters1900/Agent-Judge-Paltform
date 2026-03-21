"""集中配置管理：优先 .env 文件，其次环境变量。

用法：
    from config import get_config, LLM_API_KEY, LLM_MODEL
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

# 尝试加载项目根目录的 .env 文件
try:
    from dotenv import load_dotenv

    _env_file = Path(__file__).resolve().parents[1] / ".env"
    load_dotenv(_env_file)
except ImportError:
    # python-dotenv 未安装时，仅依赖系统环境变量
    pass


def get_config(name: str, default: Optional[str] = None) -> Optional[str]:
    """读取配置项。

    优先读取课程项目自定义前缀 ``Software3_1_<name>``，
    其次读取通用名称 ``<name>``，最后返回 *default*。
    """
    return os.getenv(f"Software3_1_{name}") or os.getenv(name) or default


# ---- 常用配置（模块级别，import 即可用）----

LLM_API_KEY: Optional[str] = get_config("LLM_API_KEY")
LLM_BASE_URL: Optional[str] = get_config("LLM_BASE_URL")
LLM_MODEL: str = get_config("LLM_MODEL", "gpt-4.1")  # type: ignore[assignment]

EVAL_DATASET_PATH: Optional[str] = get_config("EVAL_DATASET_PATH")
REPORT_OUTPUT_DIR: Optional[str] = get_config("REPORT_OUTPUT_DIR")

DEBUG: bool = get_config("DEBUG", "0") == "1"
LOG_LEVEL: str = get_config("LOG_LEVEL", "INFO")  # type: ignore[assignment]
MAX_LOG_LINES: int = int(get_config("MAX_LOG_LINES", "2000") or "2000")
