"""通过 REST API 建一套「评测 aicoding_ts 网页 Agent」的完整链路并发起运行。

前提：
  1) 评估平台后端在 http://127.0.0.1:8000 运行
  2) aicoding_ts 在 http://localhost:3000 运行（cd aicoding_ts && npm run dev）
用法：.venv/bin/python scripts/setup_web_agent_eval.py
"""
from __future__ import annotations

import time

import httpx

BASE = "http://127.0.0.1:8000/api/v1"
AGENT_ENDPOINT = "http://localhost:3000/api/agent/chat"


def main() -> None:
    c = httpx.Client(base_url=BASE, timeout=30)

    # 0) 先用连通性测试确认能调通 aicoding_ts
    cfg = {
        "body_template": {"prompt": "{{prompt}}"},
        "response_mapping": {
            "event_type_path": "type",
            "text": {"on_event": "chunk", "paths": ["chunk"]},
            "tool_call": {"on_event": "tool", "name_paths": ["tool"],
                          "input_paths": ["summary"], "output_paths": ["detail"]},
            "final": {"on_event": "result", "paths": ["result"]},
            "error": {"on_event": "error", "paths": ["message"]},
        },
        "timeout_seconds": 180,
    }
    probe = c.post("/evaluation-targets/test", json={
        "adapter_type": "http_sse", "endpoint": AGENT_ENDPOINT,
        "adapter_config": cfg, "prompt": "用一句话介绍这个工作区",
    }).raise_for_status().json()
    print("连通性测试:", "OK" if probe["succeeded"] else "失败", "|", (probe.get("error") or probe["output_text"][:60]))
    if not probe["succeeded"]:
        print("→ 请先确认 aicoding_ts 已在 :3000 运行")
        return

    # 1) 被测对象：aicoding_ts（http_sse 适配器）
    target = c.post("/evaluation-targets", json={
        "target_type": "agent_web", "name": "AICoding 网页 Agent", "version": "v1",
        "adapter_type": "http_sse", "endpoint": AGENT_ENDPOINT,
        "adapter_config": cfg, "enabled": True,
    }).raise_for_status().json()
    print("target:", target["id"])

    # 2) 数据集 + 样本（面向编程 agent 的任务）
    ds = c.post("/datasets", json={
        "dataset_code": f"web_ds_{int(time.time())}", "name": "网页Agent编程评测集",
        "source_type": "manual", "version": "v1", "status": "ready",
    }).raise_for_status().json()
    samples = [
        {"sample_code": "list_files",
         "input_payload": {"prompt": "列出当前工作区的文件结构"},
         "ground_truth": {"keywords": []},
         "reference_context": {"contexts": ["这是一个 AI 编程助手工作区"]},
         "sample_type": "task"},
        {"sample_code": "explain_arch",
         "input_payload": {"prompt": "用三句话说明这个项目的整体架构"},
         "reference_context": {"contexts": ["前端原生 TS + 后端 node:http + packages 分层"]},
         "sample_type": "qa"},
    ]
    for sp in samples:
        c.post(f"/datasets/{ds['id']}/samples", json=sp).raise_for_status()
    print("dataset:", ds["id"], "samples:", len(samples))

    # 3) 评测任务（注意：aicoding_ts 的 SSE 不返 token，token_usage 会是 0）
    task = c.post("/evaluation-tasks", json={
        "name": "评测 AICoding 网页 Agent", "target_id": target["id"],
        "target_type": "agent_web", "target_version": "v1", "dataset_id": ds["id"], "status": "ready",
        "evaluation_method_config": ["process_oriented", "llm_judge"],
        "metric_config": {"metric_codes": [
            "response_time", "task_success",
            "reasoning_quality", "answer_accuracy", "hallucination",
        ]},
        "run_config": {},
    }).raise_for_status().json()
    print("task:", task["id"])

    # 4) 发起 + 轮询
    run = c.post(f"/evaluation-tasks/{task['id']}/run").raise_for_status().json()
    rid = run["id"]
    print(f"\n已发起 run_id={rid}（前端 /runs/{rid}）。轮询中...")
    while True:
        time.sleep(3)
        r = c.get(f"/evaluation-runs/{rid}").raise_for_status().json()
        print(f"  status={r['status']} progress={r['progress']}")
        if r["status"] in {"completed", "failed", "cancelled"}:
            break

    print("\n=== 指标明细（含判官理由）===")
    for m in c.get(f"/evaluation-runs/{rid}/metrics").raise_for_status().json():
        if m.get("sample_id") is None:
            continue
        print(f"  s{m['sample_id']} {str(m.get('metric_value')):>9}  {m.get('metric_code') or m['metric_id']}  {(m.get('metric_text') or '')[:70]}")
    print(f"\n完成。前端打开 http://localhost:5173 → /runs/{rid}")


if __name__ == "__main__":
    main()
