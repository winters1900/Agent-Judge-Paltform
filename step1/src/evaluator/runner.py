from __future__ import annotations

from typing import Dict, List

from utils.logger import get_logger, log_run_start, log_sample_start, trim_if_needed
from .result import EvaluationResult

logger = get_logger("evaluator.runner")


def run(dataset, metrics) -> EvaluationResult:
    samples_out: List[Dict] = []
    metric_names = [m.name for m in metrics]
    totals = {name: 0.0 for name in metric_names}

    log_run_start(total=len(dataset))

    for idx, sample in enumerate(dataset, start=1):
        log_sample_start(sample.task_id, idx=idx, total=len(dataset))
        row = {"task_id": sample.task_id}
        for metric in metrics:
            result = metric.score(sample)
            row[metric.name] = result.value
            if getattr(result, "reason", None):
                row[f"{metric.name}_reason"] = result.reason
            if getattr(result, "traces", None):
                row[f"{metric.name}_traces"] = result.traces
            totals[metric.name] += result.value
        # 打印该样本各指标得分
        scores_str = ", ".join(f"{m.name}={row[m.name]:.4f}" for m in metrics)
        logger.info("task_id=%s | %s", sample.task_id, scores_str)
        samples_out.append(row)

    count = len(dataset) if dataset else 1
    summary = {name: totals[name] / count for name in metric_names}
    logger.info("评估完成，共 %d 个样本", count)
    for name, avg in summary.items():
        logger.info("总体均值: %s = %.4f", name, avg)

    # 运行结束后裁剪日志文件
    trim_if_needed()

    return EvaluationResult(samples=samples_out, summary=summary)


def to_markdown(result: EvaluationResult) -> str:
    lines = ["# 评估结果汇总", "", "## 总体均值", ""]
    lines.append("| 指标 | 均值 |")
    lines.append("| --- | --- |")
    for k, v in result.summary.items():
        lines.append(f"| {k} | {v:.4f} |")

    lines.append("")
    lines.append("## 样本明细")
    if not result.samples:
        lines.append("无样本")
        return "\n".join(lines)

    headers = ["task_id"] + [k for k in result.samples[0] if k != "task_id"]
    headers = sorted(headers[:1] + headers[1:])
    lines.append("| " + " | ".join(headers) + " |")
    lines.append("| " + " | ".join(["---"] * len(headers)) + " |")
    for row in result.samples:
        lines.append("| " + " | ".join(str(row.get(h, "")) for h in headers) + " |")

    return "\n".join(lines)
