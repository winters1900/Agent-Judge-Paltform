# Backend · 通用 Agent 评估平台

FastAPI + SQLAlchemy 实现的 Agent 应用评估平台后端，支持评测任务管理、**真实评测执行**、过程轨迹记录、显式指标 / LLM-as-a-Judge / 可选 Ragas 指标计算，以及单次与多任务对比分析。

## 快速开始

```bash
cd step2_2/backend
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # 按需填写 LLM_API_KEY（不填则跳过 LLM-Judge 指标）
# 本地演示可用 sqlite：在 .env 设 DATABASE_URL=sqlite:///./eval_platform.db
uvicorn app.main:app --reload --port 8000
```

启动时会自动建表并幂等写入内置评测方法与指标定义（`EVAL_SEED_DEFAULTS=true`）。

## 评测执行架构

```
POST /evaluation-tasks/{id}/run         # 一键发起：建 run + 后台执行
  └─ runner.launch_run(run_id)          # asyncio 后台任务（无需 Celery/Redis）
       └─ EvaluationEngine.run(run_id)
            ├─ build_adapter(target)     # http(接 aicoding_ts SSE) / mock
            ├─ 逐样本: adapter.invoke()  # 调用被测 Agent，记录 trace + tool_call_log
            ├─ 并发计算各指标 (asyncio.gather)
            │    ├─ 显式: task_success / tool_call_accuracy / tool_call_f1 / response_time / token_usage
            │    ├─ LLM-Judge: reasoning_quality / answer_accuracy / hallucination / interaction_experience / safety_harmlessness
            │    └─ Ragas(可选): ragas_faithfulness / answer_relevancy / ...
            ├─ 写 metric_result + sample_result，更新 progress
            ├─ run_event_bus.publish()   # WebSocket 实时推送
            └─ 聚合 → run-level metric_result(sample_id=NULL) + summary
```

- **暂停/取消**：`pause`/`cancel` 改 DB 状态，引擎在样本间轮询并响应（`paused` 时阻塞等待，`cancelled` 时收尾退出）。
- **WebSocket**：`/api/v1/ws/evaluation-runs/{run_id}` 先发当前快照，再订阅引擎事件总线推送真实进度。
- **自我修正**：适配器/指标异常均被捕获，单样本失败不影响整批，引擎级异常将 run 标记为 failed。

## 指标说明（对应任务二三种划分）

| 维度 | 指标 | calc_mode |
|---|---|---|
| 效果 | 任务成功率、工具调用正确率、工具调用 F1、答案准确性、推理质量、幻觉(可信度) | explicit / llm_judge |
| 安全 | 安全无害性 | llm_judge |
| 性能 | 响应时间、Token 消耗、交互体验 | explicit / llm_judge |

- **面向结果 vs 面向过程**：显式指标里 `task_success` 面向结果，`tool_call_*` 面向过程（基于 trace/tool_call_log）。
- **自定义 / 组合策略**：`POST /metrics` 注册自定义指标定义；任务的 `metric_config` 用 `{"metric_codes": [...]}` 或 `{"metrics": [{"metric_code","config"}]}` 组合任意指标。

## 被测对象适配器

`EvaluationTarget.adapter_type` 决定调用方式：
- `http`：POST `endpoint`，按 SSE（`data: {...}`）解析 chunk/tool/result/error，可接 `aicoding_ts` 的 `/api/agent/chat`。`adapter_config` 支持 `prompt_field` / `extra_body` / `timeout_seconds`。
- `mock`：确定性回显，离线演示与测试用，无需外部服务。

## 冒烟测试

```bash
DATABASE_URL="sqlite:///./_e2e.db" LLM_API_KEY="" .venv/bin/python scripts/e2e_check.py
```

## 技术约定
- FastAPI（API）+ SQLAlchemy 2.0（ORM）+ Pydantic v2（schema）
- 评测执行用 asyncio 后台任务（默认）；如需分布式可改接 Celery + Redis（依赖已在 requirements 中保留）
- MySQL 持久化（本地可切 sqlite）；LLM 走 OpenAI 兼容接口（httpx）
