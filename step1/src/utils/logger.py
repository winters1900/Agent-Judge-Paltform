"""统一日志配置：控制台 + 文件双输出。

功能：
- 控制台 + 文件双输出
- 日志文件超过 MAX_LOG_LINES 行时自动清理老日志（保留最新 MAX_LOG_LINES 行）
- 提供 log_separator() 在不同级别的任务边界插入可视化分隔

用法：
    from utils.logger import get_logger, log_run_start, log_sample_start
    logger = get_logger(__name__)
    log_run_start()           # 每次评估运行开始
    log_sample_start(task_id) # 每个样本开始
"""
from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

_LOG_DIR = Path(__file__).resolve().parents[2] / "logs"
_LOG_FILE = _LOG_DIR / "eval.log"
_CONFIGURED = False


def _ensure_dir() -> None:
    _LOG_DIR.mkdir(parents=True, exist_ok=True)


def _trim_log_file(max_lines: int) -> None:
    """如果日志文件超过 max_lines 行，保留最新的 max_lines 行。"""
    if not _LOG_FILE.exists():
        return
    try:
        lines = _LOG_FILE.read_text(encoding="utf-8").splitlines(keepends=True)
        if len(lines) > max_lines:
            # 直接保留最新的 max_lines 行
            _LOG_FILE.write_text("".join(lines[-max_lines:]), encoding="utf-8")
    except OSError:
        pass


def get_logger(name: str = "eval") -> logging.Logger:
    """获取或创建 logger，首次调用时配置 root handler。"""
    global _CONFIGURED

    logger = logging.getLogger(name)

    if not _CONFIGURED:
        # 从环境变量 / config 读取配置
        try:
            from config import LOG_LEVEL, MAX_LOG_LINES
            level_str = LOG_LEVEL
            max_lines = MAX_LOG_LINES
        except ImportError:
            level_str = os.getenv("LOG_LEVEL", "INFO")
            max_lines = int(os.getenv("MAX_LOG_LINES", "2000"))

        level = getattr(logging, level_str.upper(), logging.INFO)

        # root logger
        root = logging.getLogger()
        root.setLevel(level)

        fmt = logging.Formatter(
            "[%(asctime)s] %(levelname)-5s %(name)s | %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )

        # 控制台 handler（输出到 stdout，避免 PyCharm 标红）
        console = logging.StreamHandler(sys.stdout)
        console.setLevel(level)
        console.setFormatter(fmt)
        root.addHandler(console)

        # 文件 handler
        try:
            _ensure_dir()
            _trim_log_file(max_lines)
            file_handler = logging.FileHandler(str(_LOG_FILE), encoding="utf-8")
            file_handler.setLevel(logging.DEBUG)  # 文件始终记录 DEBUG 级别
            file_handler.setFormatter(fmt)
            root.addHandler(file_handler)
        except OSError:
            # 无法写入文件时只用控制台
            pass

        _CONFIGURED = True

    return logger


# ========== 分隔符工具函数 ==========

def log_run_start(total: int = 0) -> None:
    """每次评估运行开始时调用，插入大分隔符（3 空行 + 粗横线）。"""
    logger = get_logger("eval.separator")
    logger.info("")
    logger.info("")
    logger.info("")
    logger.info("=" * 72)
    if total:
        logger.info("  新评估运行开始，共 %d 个样本", total)
    else:
        logger.info("  新评估运行开始")
    logger.info("=" * 72)
    logger.info("")


def log_sample_start(task_id: str, idx: int = 0, total: int = 0) -> None:
    """每个样本评估开始时调用，插入中分隔符（1 空行 + 细横线）。"""
    logger = get_logger("eval.separator")
    logger.info("")
    logger.info("-" * 48)
    if idx and total:
        logger.info("  样本 %d/%d  task_id=%s", idx, total, task_id)
    else:
        logger.info("  task_id=%s", task_id)
    logger.info("-" * 48)


def trim_if_needed() -> None:
    """检查日志文件行数，超限则裁剪。

    会关闭并重新打开 FileHandler，避免文件指针偏移导致裁剪失效。
    """
    try:
        from config import MAX_LOG_LINES
        max_lines = MAX_LOG_LINES
    except ImportError:
        max_lines = int(os.getenv("MAX_LOG_LINES", "2000"))

    if not _LOG_FILE.exists():
        return

    root = logging.getLogger()

    # 找到目标 FileHandler 并 flush
    log_file_str = str(_LOG_FILE)
    file_handler = None
    for h in root.handlers:
        if isinstance(h, logging.FileHandler) and os.path.abspath(h.baseFilename) == log_file_str:
            file_handler = h
            break

    if file_handler is None:
        return

    # flush + 关闭旧 handler
    file_handler.flush()
    file_handler.close()
    root.removeHandler(file_handler)

    # 裁剪文件
    _trim_log_file(max_lines)

    # 重新打开 handler（append 模式）
    new_handler = logging.FileHandler(str(_LOG_FILE), encoding="utf-8")
    new_handler.setLevel(file_handler.level)
    new_handler.setFormatter(file_handler.formatter)
    root.addHandler(new_handler)
