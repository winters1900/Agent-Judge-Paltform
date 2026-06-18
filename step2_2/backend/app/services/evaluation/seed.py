from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.metric import EvaluationMethod, MetricDefinition
from app.services.evaluation.metrics import list_builtin_metrics

# 评测方法（对应需求的三种划分维度，仅作为可选项展示与配置参考）
_METHODS = [
    {"method_code": "result_oriented", "name": "面向结果", "category": "mode",
     "description": "只关注输入输出，不看中间过程"},
    {"method_code": "process_oriented", "name": "面向过程", "category": "mode",
     "description": "关注 Agent 响应的中间过程（轨迹、工具调用）"},
    {"method_code": "explicit", "name": "显式指标", "category": "approach",
     "description": "可明确计算，如 Token 消耗、工具调用正确率、任务成功率、响应时间"},
    {"method_code": "llm_judge", "name": "模糊指标(LLM-as-a-Judge)", "category": "approach",
     "description": "主观评价，由 LLM 打分，如推理质量、准确性、幻觉、交互体验"},
    {"method_code": "ragas", "name": "Ragas 框架指标", "category": "approach",
     "description": "基于 Ragas 的 faithfulness / answer_relevancy 等（可选依赖）"},
    {"method_code": "effect", "name": "效果维度", "category": "dimension",
     "description": "任务响应是否有效、准确、完整"},
    {"method_code": "safety", "name": "安全维度", "category": "dimension",
     "description": "反馈是否安全、不含有害内容"},
    {"method_code": "performance", "name": "性能维度", "category": "dimension",
     "description": "响应是否流畅、是否长时间停顿、交互体验"},
]


def seed_defaults(session: Session) -> dict[str, int]:
    """幂等地写入内置评测方法与指标定义。返回新增数量。"""
    added_methods = _seed_methods(session)
    added_metrics = _seed_metrics(session)
    session.commit()
    return {"methods": added_methods, "metrics": added_metrics}


def _seed_methods(session: Session) -> int:
    existing = {m.method_code for m in session.scalars(select(EvaluationMethod)).all()}
    added = 0
    for item in _METHODS:
        if item["method_code"] in existing:
            continue
        session.add(EvaluationMethod(**item, enabled=True))
        added += 1
    return added


def _seed_metrics(session: Session) -> int:
    existing = {m.metric_code for m in session.scalars(select(MetricDefinition)).all()}
    added = 0
    for item in list_builtin_metrics():
        if item["metric_code"] in existing:
            continue
        session.add(MetricDefinition(**item, enabled=True))
        added += 1
    # 追加 Ragas 指标定义（默认 disabled，安装 ragas 后启用）
    for code, name in _RAGAS_DEFS.items():
        if code in existing:
            continue
        session.add(
            MetricDefinition(
                metric_code=code,
                name=name,
                metric_type="fuzzy",
                dimension="effect",
                calc_mode="ragas",
                description="Ragas 框架指标（需 pip install ragas）",
                enabled=False,
            )
        )
        added += 1
    return added


_RAGAS_DEFS = {
    "ragas_faithfulness": "Ragas 忠实度",
    "ragas_answer_relevancy": "Ragas 答案相关性",
    "ragas_context_precision": "Ragas 上下文精确率",
    "ragas_answer_correctness": "Ragas 答案正确性",
}
