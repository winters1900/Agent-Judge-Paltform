# 任务2 API 设计文档

## 1. 文档概述

### 1.1 文档名称
Agent 应用评估平台 API 设计文档

### 1.2 技术选型
- **前端框架**：React + TypeScript + Ant Design
- **后端框架**：FastAPI
- **异步任务队列**：Celery
- **缓存与消息中间件**：Redis
- **主数据库**：MySQL 8.x
- **ORM 框架**：SQLAlchemy
- **实时通信**：WebSocket
- **图表展示**：ECharts
- **评估能力支持**：Ragas（用于部分自动化评估指标）

### 1.3 设计目标
本文档用于定义任务2评估平台的核心接口规范，为前端页面、后端服务、任务调度、评估执行和结果分析提供统一的 API 约定。

### 1.4 设计原则
- 统一资源风格，采用 RESTful 风格设计
- 任务创建、执行、查询、分析分层处理
- 支持异步评测与状态轮询/推送
- 支持过程数据、指标数据与报告数据分离存储
- 支持扩展评估方法与自定义指标

---

## 2. 总体约定

### 2.1 基础信息
- Base URL：`/api/v1`
- 数据格式：`application/json`
- 字符编码：`UTF-8`
- 时间格式：`ISO 8601`

### 2.2 通用响应格式
```json
{
  "code": 0,
  "message": "success",
  "data": {},
  "trace_id": "eval_20260417_0001"
}
```

### 2.3 通用分页格式
```json
{
  "items": [],
  "page": 1,
  "page_size": 20,
  "total": 100
}
```

### 2.4 通用状态枚举
#### 任务状态
- `draft`：草稿
- `pending`：待执行
- `running`：执行中
- `succeeded`：成功
- `failed`：失败
- `cancelled`：已取消
- `archived`：已归档

#### 运行状态
- `queued`：排队中
- `running`：运行中
- `paused`：已暂停
- `completed`：已完成
- `failed`：失败
- `cancelled`：已取消

---

## 3. 核心资源模型

### 3.1 评测任务 EvaluationTask
```json
{
  "id": "task_001",
  "name": "MyClaw Agent 版本评测",
  "description": "评估任务完成率与工具调用正确率",
  "agent_id": "agent_myclaw_v1",
  "dataset_id": 1,
  "evaluation_method_config": ["method_result", "method_process"],
  "metric_config": {
    "explicit_metrics": ["success_rate", "latency", "tool_accuracy"],
    "fuzzy_metrics": ["reasoning_quality"]
  },
  "run_config": {
    "timeout_ms": 30000,
    "concurrency": 2,
    "retry_times": 1
  },
  "status": "draft",
  "created_at": "2026-04-17T10:00:00Z",
  "updated_at": "2026-04-17T10:00:00Z"
}
```

### 3.2 评测运行 EvaluationRun
```json
{
  "id": "run_001",
  "run_code": "run_001",
  "task_id": 1,
  "status": "running",
  "progress": 30.0,
  "started_at": "2026-04-17T10:05:00Z",
  "ended_at": null,
  "summary": "当前执行 3/10",
  "trace_id": "eval_20260417_0001",
  "error_message": null,
  "created_at": "2026-04-17T10:05:00Z",
  "updated_at": "2026-04-17T10:05:00Z"
}
```

### 3.3 指标结果 MetricResult
```json
{
  "metric_id": 1,
  "metric_code": "success_rate",
  "metric_name": "任务成功率",
  "metric_type": "explicit",
  "metric_value": 0.86,
  "metric_text": null,
  "metric_detail": {
    "unit": "%",
    "description": "任务最终完成比例"
  }
}
```

### 3.4 过程轨迹 TraceRecord
```json
{
  "step_index": 3,
  "phase": "act",
  "decision": "调用搜索工具获取最新文档",
  "observation": "搜索结果包含 2 条相关记录",
  "state_snapshot": {
    "current_sample_id": 1,
    "current_status": "running"
  },
  "created_at": "2026-04-17T10:06:12Z"
}
```

---

## 4. 接口设计

## 4.1 评测任务管理

### 4.1.1 创建评测任务
- **Method**：`POST`
- **Path**：`/api/v1/evaluation-tasks`

**Request**
```json
{
  "name": "MyClaw Agent 版本评测",
  "description": "评估任务完成率与工具调用正确率",
  "agent_id": "agent_myclaw_v1",
  "dataset_id": 1,
  "evaluation_method_config": ["method_result", "method_process"],
  "metric_config": {
    "explicit_metrics": ["success_rate", "latency", "tool_accuracy"],
    "fuzzy_metrics": ["reasoning_quality"]
  },
  "run_config": {
    "timeout_ms": 30000,
    "concurrency": 2,
    "retry_times": 1
  }
}
```

**Response**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": "task_001"
  },
  "trace_id": "eval_20260417_0001"
}
```

### 4.1.2 查询评测任务列表
- **Method**：`GET`
- **Path**：`/api/v1/evaluation-tasks`
- **Query**：`name`、`status`、`page`、`page_size`

### 4.1.2.1 评测任务对象
```json
{
  "id": 1,
  "task_code": "task_001",
  "name": "MyClaw Agent 版本评测",
  "description": "评估任务完成率与工具调用正确率",
  "agent_id": "agent_myclaw_v1",
  "dataset_id": 1,
  "status": "draft",
  "metric_config": {
    "explicit_metrics": ["success_rate", "latency", "tool_accuracy"],
    "fuzzy_metrics": ["reasoning_quality"]
  },
  "evaluation_method_config": ["method_result", "method_process"],
  "run_config": {
    "timeout_ms": 30000,
    "concurrency": 2,
    "retry_times": 1
  },
  "created_by": 1,
  "updated_by": 1,
  "created_at": "2026-04-17T10:00:00Z",
  "updated_at": "2026-04-17T10:00:00Z",
  "deleted_at": null
}
```

### 4.1.3 查询评测任务详情
- **Method**：`GET`
- **Path**：`/api/v1/evaluation-tasks/{task_id}`

### 4.1.4 修改评测任务
- **Method**：`PUT`
- **Path**：`/api/v1/evaluation-tasks/{task_id}`
- 仅允许修改 `draft` 或未运行完成的任务配置。

### 4.1.5 删除评测任务
- **Method**：`DELETE`
- **Path**：`/api/v1/evaluation-tasks/{task_id}`

---

## 4.2 评测执行管理

### 4.2.1 启动评测任务
- **Method**：`POST`
- **Path**：`/api/v1/evaluation-tasks/{task_id}/runs`

**Request**
```json
{
  "run_mode": "async"
}
```

**Response**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "run_id": "run_001",
    "status": "queued"
  },
  "trace_id": "eval_20260417_0001"
}
```

### 4.2.2 查询运行列表
- **Method**：`GET`
- **Path**：`/api/v1/evaluation-runs`
- **Query**：`task_id`、`status`、`page`、`page_size`

### 4.2.2.1 运行对象
```json
{
  "id": 1,
  "run_code": "run_001",
  "task_id": 1,
  "status": "running",
  "progress": 30.0,
  "started_at": "2026-04-17T10:05:00Z",
  "ended_at": null,
  "summary": "当前执行 3/10",
  "trace_id": "eval_20260417_0001",
  "error_message": null,
  "created_at": "2026-04-17T10:05:00Z",
  "updated_at": "2026-04-17T10:05:00Z"
}
```

### 4.2.3 查询运行详情
- **Method**：`GET`
- **Path**：`/api/v1/evaluation-runs/{run_id}`

### 4.2.4 取消运行
- **Method**：`POST`
- **Path**：`/api/v1/evaluation-runs/{run_id}/cancel`

### 4.2.5 重试运行
- **Method**：`POST`
- **Path**：`/api/v1/evaluation-runs/{run_id}/retry`

---

## 4.3 数据集管理

### 4.3.1 创建数据集
- **Method**：`POST`
- **Path**：`/api/v1/datasets`

**Request**
```json
{
  "dataset_code": "dataset_001",
  "name": "通用评测数据集",
  "description": "用于 Agent 版本评测的样本集合",
  "source_type": "import",
  "version": "v1",
  "status": "draft"
}
```

### 4.3.2 查询数据集列表
- **Method**：`GET`
- **Path**：`/api/v1/datasets`

### 4.3.2.1 数据集对象
```json
{
  "id": 1,
  "dataset_code": "dataset_001",
  "name": "通用评测数据集",
  "description": "用于 Agent 版本评测的样本集合",
  "source_type": "import",
  "sample_count": 100,
  "version": "v1",
  "status": "draft",
  "created_by": 1,
  "created_at": "2026-04-17T10:00:00Z",
  "updated_at": "2026-04-17T10:00:00Z",
  "deleted_at": null
}
```

### 4.3.3 查询数据集详情
- **Method**：`GET`
- **Path**：`/api/v1/datasets/{dataset_id}`

### 4.3.4 上传数据集样本
- **Method**：`POST`
- **Path**：`/api/v1/datasets/{dataset_id}/samples`

**Request**
```json
{
  "sample_code": "sample_001",
  "input_payload": {
    "question": "如何生成评测报告？"
  },
  "expected_output": {
    "answer": "通过导出接口生成 PDF 报告"
  },
  "reference_context": {
    "docs": ["API 文档", "数据库文档"]
  },
  "ground_truth": {
    "label": "correct"
  },
  "sample_type": "qa",
  "metadata": {
    "difficulty": "easy"
  }
}
```

### 4.3.5 删除数据集
- **Method**：`DELETE`
- **Path**：`/api/v1/datasets/{dataset_id}`

---

## 4.4 评估方法与指标

### 4.4.1 获取评估方法列表
- **Method**：`GET`
- **Path**：`/api/v1/evaluation-methods`

### 4.4.1.1 评估方法对象
```json
{
  "method_code": "method_result",
  "name": "面向结果评估",
  "category": "result",
  "description": "仅关注输入输出结果",
  "config_schema": {},
  "enabled": true
}
```

### 4.4.2 获取指标列表
- **Method**：`GET`
- **Path**：`/api/v1/metrics`

### 4.4.2.1 指标对象
```json
{
  "metric_code": "success_rate",
  "name": "任务成功率",
  "metric_type": "explicit",
  "dimension": "effect",
  "description": "任务最终完成比例",
  "calc_mode": "rule",
  "config_schema": {},
  "enabled": true
}
```

### 4.4.3 创建自定义指标
- **Method**：`POST`
- **Path**：`/api/v1/metrics/custom`

### 4.4.4 查询指标配置详情
- **Method**：`GET`
- **Path**：`/api/v1/metrics/{metric_id}`

---

## 4.5 结果与分析

### 4.5.1 查询运行结果汇总
- **Method**：`GET`
- **Path**：`/api/v1/evaluation-runs/{run_id}/summary`

### 4.5.1.1 结果汇总对象
```json
{
  "run_id": 1,
  "summary": "本次评测整体表现良好",
  "report_title": "MyClaw Agent 版本评测报告",
  "report_path": "/reports/run_001.pdf",
  "report_format": "pdf"
}
```

### 4.5.2 查询运行指标明细
- **Method**：`GET`
- **Path**：`/api/v1/evaluation-runs/{run_id}/metrics`

### 4.5.2.1 指标结果对象
```json
{
  "metric_id": 1,
  "metric_code": "success_rate",
  "metric_name": "任务成功率",
  "metric_type": "explicit",
  "metric_value": 0.86,
  "metric_text": null,
  "metric_detail": {
    "unit": "%",
    "description": "任务最终完成比例"
  }
}
```

### 4.5.3 查询过程轨迹
- **Method**：`GET`
- **Path**：`/api/v1/evaluation-runs/{run_id}/traces`

### 4.5.3.1 轨迹对象
```json
{
  "step_index": 3,
  "phase": "act",
  "decision": "调用搜索工具获取最新文档",
  "observation": "搜索结果包含 2 条相关记录",
  "state_snapshot": {
    "current_sample_id": 1,
    "current_status": "running"
  },
  "created_at": "2026-04-17T10:06:12Z"
}
```

### 4.5.4 查询工具调用日志
- **Method**：`GET`
- **Path**：`/api/v1/evaluation-runs/{run_id}/tool-calls`

### 4.5.4.1 工具调用对象
```json
{
  "tool_name": "web_search",
  "input_payload": {
    "query": "最新文档"
  },
  "output_payload": {
    "result_count": 2
  },
  "success": true,
  "error_type": null,
  "duration_ms": 1200,
  "created_at": "2026-04-17T10:06:12Z"
}
```

### 4.5.5 导出评测报告
- **Method**：`POST`
- **Path**：`/api/v1/evaluation-runs/{run_id}/export`

**Response**
```json
{
  "report_title": "MyClaw Agent 版本评测报告",
  "report_summary": "本次评测整体表现良好",
  "report_path": "/reports/run_001.pdf",
  "report_format": "pdf",
  "created_at": "2026-04-17T10:10:00Z"
}
```

### 4.5.6 多任务对比分析
- **Method**：`POST`
- **Path**：`/api/v1/analysis/compare`

**Request**
```json
{
  "task_ids": ["task_001", "task_002"],
  "metric_keys": ["success_rate", "latency", "tool_accuracy"]
}
```

---

## 4.6 实时状态推送

### 4.6.1 WebSocket 连接
- **Path**：`/api/v1/ws/evaluation-runs/{run_id}`

### 4.6.2 推送内容示例
```json
{
  "event": "run_progress",
  "run_id": "run_001",
  "status": "running",
  "progress": 0.4,
  "current_step": 4,
  "message": "正在执行第 4 个样本",
  "updated_at": "2026-04-17T10:06:12Z"
}
```

---

## 5. 错误码设计

### 5.1 通用错误码
- `0`：成功
- `40001`：参数错误
- `40004`：资源不存在
- `40009`：资源冲突
- `50000`：系统内部错误

### 5.2 评测相关错误码
- `41001`：任务状态不允许修改
- `41002`：任务状态不允许启动
- `41003`：运行已结束，无法取消
- `41004`：数据集为空
- `41005`：指标配置非法
- `41006`：被测 Agent 调用失败

---

## 6. 权限与审计

### 6.1 权限控制
平台建议支持以下权限：
- 普通用户：创建、执行、查看评测任务
- 管理员：管理数据集、指标与系统配置

### 6.2 审计日志
系统应记录以下关键操作：
- 创建/修改/删除评测任务
- 启动/取消/重试评测运行
- 导入/删除数据集
- 指标配置变更
- 导出评测报告

---

## 7. 与任务1的对接说明

任务2平台面向任务1这类 Agent 应用时，建议任务1提供以下对接能力：
- 统一执行入口 API
- 输入输出结构化返回
- 中间步骤 trace 上报
- 工具调用日志上报
- 任务状态回调或轮询接口

这样任务2即可基于任务1的运行结果完成：
- 面向结果评估
- 面向过程评估
- 显式指标计算
- 模糊指标分析
- 多维度对比展示

---

## 8. 版本记录
- v1.0：初版 API 设计文档，覆盖任务、运行、数据集、指标、结果分析和 WebSocket 推送能力
