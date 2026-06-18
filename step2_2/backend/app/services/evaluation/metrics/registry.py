from __future__ import annotations

from typing import Any

from app.services.evaluation.llm_client import LlmClient
from app.services.evaluation.metrics.base import Metric
from app.services.evaluation.metrics.explicit import (
    ResponseTimeMetric,
    TaskSuccessMetric,
    TokenUsageMetric,
    ToolCallAccuracyMetric,
    ToolCallF1Metric,
)
from app.services.evaluation.metrics.llm_judge import JUDGE_RUBRICS, LlmJudgeMetric
from app.services.evaluation.metrics.ragas_adapter import RagasMetric

# 显式指标：code → 类
_EXPLICIT: dict[str, type[Metric]] = {
    ResponseTimeMetric.code: ResponseTimeMetric,
    TokenUsageMetric.code: TokenUsageMetric,
    TaskSuccessMetric.code: TaskSuccessMetric,
    ToolCallAccuracyMetric.code: ToolCallAccuracyMetric,
    ToolCallF1Metric.code: ToolCallF1Metric,
}

_RAGAS_CODES = {
    "ragas_faithfulness",
    "ragas_answer_relevancy",
    "ragas_context_precision",
    "ragas_answer_correctness",
}


def build_metric(
    metric_code: str,
    calc_mode: str | None = None,
    config: dict[str, Any] | None = None,
    llm: LlmClient | None = None,
) -> Metric | None:
    """按 code/calc_mode 构造指标实例。无法识别时返回 None。"""
    config = config or {}
    if metric_code in _EXPLICIT:
        return _EXPLICIT[metric_code](config=config, llm=llm)
    if metric_code in JUDGE_RUBRICS or calc_mode == "llm_judge":
        return LlmJudgeMetric(code=metric_code, config=config, llm=llm)
    if metric_code in _RAGAS_CODES or calc_mode == "ragas":
        return RagasMetric(code=metric_code, config=config, llm=llm)
    return None


def list_builtin_metrics() -> list[dict[str, Any]]:
    """返回内置指标定义，用于初始化 metric_definition 表（幂等 seed）。"""
    items: list[dict[str, Any]] = [
        {
            "metric_code": "response_time",
            "name": "响应时间",
            "metric_type": "explicit",
            "dimension": "performance",
            "calc_mode": "explicit",
            "description": "单样本端到端响应耗时（ms），越小越好",
        },
        {
            "metric_code": "token_usage",
            "name": "Token 消耗",
            "metric_type": "explicit",
            "dimension": "performance",
            "calc_mode": "explicit",
            "description": "单样本消耗的总 token 数，越小越好",
        },
        {
            "metric_code": "task_success",
            "name": "任务成功率",
            "metric_type": "explicit",
            "dimension": "effect",
            "calc_mode": "explicit",
            "description": "是否成功完成任务（基于期望答案 / 关键词匹配）",
        },
        {
            "metric_code": "tool_call_accuracy",
            "name": "工具调用正确率",
            "metric_type": "explicit",
            "dimension": "effect",
            "calc_mode": "explicit",
            "description": "实际工具调用与期望工具调用的命中比例",
        },
        {
            "metric_code": "tool_call_f1",
            "name": "工具调用 F1",
            "metric_type": "explicit",
            "dimension": "effect",
            "calc_mode": "explicit",
            "description": "工具调用序列的 multiset F1（保留重复）",
        },
    ]
    for code, rubric in JUDGE_RUBRICS.items():
        items.append(
            {
                "metric_code": code,
                "name": _JUDGE_NAMES.get(code, code),
                "metric_type": "fuzzy",
                "dimension": rubric["dimension"],
                "calc_mode": "llm_judge",
                "description": rubric["criteria"][:200],
            }
        )
    return items


_JUDGE_NAMES = {
    "reasoning_quality": "推理质量",
    "answer_accuracy": "答案准确性",
    "hallucination": "幻觉程度(可信度)",
    "interaction_experience": "交互体验",
    "safety_harmlessness": "安全无害性",
}
