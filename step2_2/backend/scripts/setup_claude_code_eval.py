"""通过 REST API 建一套「评测 Claude Code CLI」的完整链路并发起运行。

前提：后端已在 http://127.0.0.1:8000 运行，且本机有 `claude` CLI。
用法：.venv/bin/python scripts/setup_claude_code_eval.py
"""
from __future__ import annotations

import time

import httpx

BASE = "http://127.0.0.1:8000/api/v1"


def main() -> None:
    c = httpx.Client(base_url=BASE, timeout=30)

    # 1) 被测对象：Claude Code CLI（claude_code 适配器）
    target = c.post("/evaluation-targets", json={
        "target_type": "cli_agent",
        "name": "Claude Code CLI",
        "version": "2.1",
        "adapter_type": "claude_code",
        "adapter_config": {
            "command": "claude",
            "output_format": "json",   # 解析 claude -p --output-format json 的结果信封
            "prompt_via": "stdin",
            "timeout_seconds": 180,
            # 如需让它真正改文件/用工具，可加：
            # "extra_args": ["--dangerously-skip-permissions"], "cwd": "/abs/work/dir"
        },
        "enabled": True,
    }).raise_for_status().json()
    print("target:", target["id"], target["name"])

    # 2) 数据集 + 样本（编程类问答）
    ds = c.post("/datasets", json={
        "dataset_code": f"cc_ds_{int(time.time())}", "name": "Claude Code 编程评测集",
        "source_type": "manual", "version": "v1", "status": "ready",
    }).raise_for_status().json()
    print("dataset:", ds["id"])

    samples = [
        {
            "sample_code": "py_reverse",
            "input_payload": {"prompt": "用一句话回答：Python 中如何就地反转一个列表？只给代码。"},
            "expected_output": {"answer": "list.reverse()"},
            "reference_context": {"contexts": ["list.reverse() 就地反转；list[::-1] 返回反转的新列表。"]},
            "ground_truth": {"keywords": ["reverse"]},
            "sample_type": "qa",
        },
        {
            "sample_code": "ts_debounce",
            "input_payload": {"prompt": "用 TypeScript 写一个 debounce 函数，只给代码，不要解释。"},
            "expected_output": {"answer": "function debounce(fn, delay){ let t; return (...a)=>{clearTimeout(t); t=setTimeout(()=>fn(...a),delay)} }"},
            "reference_context": {"contexts": ["debounce 用 setTimeout/clearTimeout 延迟执行，重复调用会重置计时器。"]},
            "ground_truth": {"keywords": ["setTimeout", "clearTimeout"]},
            "sample_type": "code",
        },
    ]
    for sp in samples:
        c.post(f"/datasets/{ds['id']}/samples", json=sp).raise_for_status()
    print("samples:", len(samples))

    # 3) 评测任务：显式指标 + DeepSeek LLM-Judge 模糊指标
    task = c.post("/evaluation-tasks", json={
        "name": "评测 Claude Code（编程问答）",
        "target_id": target["id"], "target_type": "cli_agent", "target_version": "2.1",
        "dataset_id": ds["id"], "status": "ready",
        "evaluation_method_config": ["explicit", "llm_judge"],
        "metric_config": {"metric_codes": [
            "task_success", "response_time", "token_usage",
            "reasoning_quality", "answer_accuracy", "hallucination",
        ]},
        "run_config": {},
    }).raise_for_status().json()
    print("task:", task["id"], task["name"])

    # 4) 发起评测（后台执行）
    run = c.post(f"/evaluation-tasks/{task['id']}/run").raise_for_status().json()
    run_id = run["id"]
    print(f"\n已发起运行 run_id={run_id}，前端可看：/runs/{run_id}\n轮询进度（claude 真实调用，较慢）...")

    # 5) 轮询直到结束
    while True:
        time.sleep(3)
        r = c.get(f"/evaluation-runs/{run_id}").raise_for_status().json()
        print(f"  status={r['status']} progress={r['progress']}")
        if r["status"] in {"completed", "failed", "cancelled"}:
            break

    print("\n=== 样本结果 ===")
    for s in c.get(f"/evaluation-runs/{run_id}/samples").raise_for_status().json():
        print(f"  sample {s['sample_id']} [{s['status']}] scores={s['score_summary']}")
    print("\n=== 指标明细（含判官理由）===")
    for m in c.get(f"/evaluation-runs/{run_id}/metrics").raise_for_status().json():
        if m.get("sample_id") is None:
            continue
        print(f"  {str(m.get('metric_value')):>10}  {m.get('metric_code') or m.get('metric_id')}  {(m.get('metric_text') or '')[:90]}")

    print(f"\n完成。前端打开 http://localhost:5173 → 运行详情 /runs/{run_id}")


if __name__ == "__main__":
    main()
