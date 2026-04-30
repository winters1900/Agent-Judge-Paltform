# 任务2 API 设计文档

## 1. 文档概述

### 1.1 文档名称
通用 Agent 评估平台 API 设计文档

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
本文档用于定义通用 Agent 评估平台的核心接口规范，为前端页面、后端服务、任务调度、评估执行、指标计算和结果分析提供统一的 API 约定。平台面向不同类型、不同接入方式、不同能力侧重的 Agent 评估，同时可通过示例场景展示具体能力，如 Coding 类 Agent 的项目生成、代码修改、命令执行、快照回滚与结果分析。平台中的“评测目标”是统一抽象，既可以是 HTTP Agent、CLI Agent、Workflow Agent，也可以是其它可适配的被测系统；Coding 场景仅作为示例场景之一。

### 1.4 设计原则
- 统一资源风格，采用 RESTful 风格设计
- 任务配置、执行、查询、分析分层处理
- 支持异步评测与状态轮询/推送
- 支持过程数据、指标数据与报告数据分离存储
- 支持扩展评估方法、自定义指标与插件式评估器
- 支持通用 Agent 评估场景与示例场景的数据表达与结果展示

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

#### 数据集样本类型
- `generic_qa`：通用问答
- `tool_use`：工具使用
- `workflow`：流程执行
- `multi_turn`：多轮交互
- `structured_output`：结构化输出
- `planning`：计划生成
- `task_decomposition`：任务拆解
- `project_scaffold`：项目骨架生成（示例场景）
- `code_edit`：代码修改（示例场景）
- `bug_fix`：错误修复（示例场景）
- `command_execution`：命令执行（示例场景）
- `snapshot_restore`：快照/回滚（示例场景）
- `multi_turn_revision`：多轮修正（示例场景）

---

## 3. 核心资源模型

### 3.1 评测目标 EvaluationTarget
用于描述被测 Agent 或被测系统的统一接入信息。
```json
{
  "id": 1,
  "target_code": "target_001",
  "target_type": "agent_http_api",
  "name": "通用对话 Agent v1",
  "description": "支持工具调用和多轮对话的 Agent",
  "version": "v1.0.0",
  "endpoint": "https://example.com/agent/invoke",
  "adapter_type": "openapi_http",
  "adapter_config": {
    "auth_type": "bearer",
    "timeout_ms": 30000,
    "headers": {}
  },
  "input_schema": {},
  "output_schema": {},
  "enabled": true,
  "created_at": "2026-04-17T10:00:00Z",
  "updated_at": "2026-04-17T10:00:00Z"
}
```

### 3.2 评测任务 EvaluationTask
```json
{
  "id": 1,
  "task_code": "task_001",
  "name": "通用 Agent 版本评测",
  "description": "评估 Agent 的结果输出、过程表现与交互能力",
  "target_id": 1,
  "target_type": "agent_http_api",
  "target_version": "v1.0.0",
  "dataset_id": 1,
  "evaluation_method_config": ["method_result", "method_process"],
  "metric_config": {
    "explicit_metrics": ["task_success_rate", "response_time", "tool_call_accuracy"],
    "fuzzy_metrics": ["reasoning_quality", "interaction_quality"]
  },
  "run_config": {
    "timeout_ms": 30000,
    "concurrency": 2,
    "retry_times": 1,
    "run_mode": "async"
  },
  "status": "draft",
  "created_at": "2026-04-17T10:00:00Z",
  "updated_at": "2026-04-17T10:00:00Z"
}
```

### 3.3 评测运行 EvaluationRun
```json
{
  "id": 1,
  "run_code": "run_001",
  "task_id": 1,
  "status": "running",
  "progress": 30.0,
  "current_sample_id": 3,
  "started_at": "2026-04-17T10:05:00Z",
  "ended_at": null,
  "summary": "当前执行 3/10",
  "trace_id": "eval_20260417_0001",
  "error_message": null,
  "retry_count": 0,
  "created_at": "2026-04-17T10:05:00Z",
  "updated_at": "2026-04-17T10:05:00Z"
}
```

### 3.4 数据集 Dataset
```json
{
  "id": 1,
  "dataset_code": "dataset_001",
  "name": "通用评测数据集",
  "description": "覆盖通用问答、工具调用、流程执行等场景",
  "source_type": "manual",
  "sample_count": 20,
  "version": "v1",
  "status": "draft",
  "created_by": 1,
  "created_at": "2026-04-17T10:00:00Z",
  "updated_at": "2026-04-17T10:00:00Z"
}
```

### 3.5 数据集样本 DatasetSample
```json
{
  "id": 1,
  "dataset_id": 1,
  "sample_code": "sample_001",
  "sample_type": "generic_qa",
  "input_payload": {
    "task": "解释如何生成评测报告"
  },
  "expected_output": {
    "answer": "通过导出接口生成报告"
  },
  "reference_context": {
    "domain": "agent_evaluation"
  },
  "ground_truth": {
    "label": "correct"
  },
  "metadata": {
    "difficulty": "easy"
  },
  "created_at": "2026-04-17T10:00:00Z",
  "updated_at": "2026-04-17T10:00:00Z"
}
```

### 3.6 评估方法 EvaluationMethod
```json
{
  "id": 1,
  "method_code": "method_result",
  "name": "面向结果评估",
  "category": "result",
  "description": "只关注输入输出与最终结果",
  "config_schema": {},
  "enabled": true,
  "created_at": "2026-04-17T10:00:00Z",
  "updated_at": "2026-04-17T10:00:00Z"
}
```

### 3.7 指标定义 MetricDefinition
```json
{
  "id": 1,
  "metric_code": "task_success_rate",
  "name": "任务成功率",
  "metric_type": "explicit",
  "dimension": "effect",
  "description": "评估任务是否成功完成",
  "calc_mode": "rule",
  "config_schema": {},
  "enabled": true,
  "created_at": "2026-04-17T10:00:00Z",
  "updated_at": "2026-04-17T10:00:00Z"
}
```

### 3.8 指标结果 MetricResult
```json
{
  "id": 1,
  "run_id": 1,
  "sample_id": null,
  "metric_id": 1,
  "metric_code": "task_success_rate",
  "metric_name": "任务成功率",
  "metric_type": "explicit",
  "metric_value": 0.86,
  "metric_text": null,
  "metric_detail": {
    "unit": "%",
    "description": "任务最终完成比例"
  },
  "created_at": "2026-04-17T10:10:00Z"
}
```

### 3.9 过程轨迹 TraceRecord
```json
{
  "id": 1,
  "run_id": 1,
  "sample_id": 1,
  "step_index": 3,
  "phase": "act",
  "decision": "调用工具完成下一步操作",
  "observation": "工具调用成功",
  "state_snapshot": {
    "current_sample_id": 1,
    "current_status": "running"
  },
  "tool_calls": [
    {
      "tool_name": "example_tool",
      "success": true,
      "duration_ms": 1200
    }
  ],
  "created_at": "2026-04-17T10:06:12Z"
}
```

### 3.10 工具调用日志 ToolCallLog
```json
{
  "id": 1,
  "run_id": 1,
  "sample_id": 1,
  "tool_name": "example_tool",
  "input_payload": {
    "param": "value"
  },
  "output_payload": {
    "success": true
  },
  "success": true,
  "error_type": null,
  "duration_ms": 1200,
  "created_at": "2026-04-17T10:06:12Z"
}
```

### 3.11 评测报告 EvaluationReport
```json
{
  "id": 1,
  "run_id": 1,
  "report_title": "通用 Agent 版本评测报告",
  "report_summary": "本次评测整体表现良好",
  "report_path": "/reports/run_001.pdf",
  "report_format": "pdf",
  "created_at": "2026-04-17T10:10:00Z",
  "updated_at": "2026-04-17T10:10:00Z"
}
```

---

## 4. 接口设计

## 4.1 评测目标管理

### 4.1.1 创建评测目标
- **Method**：`POST`
- **Path**：`/api/v1/evaluation-targets`

**Request**
```json
{
  "target_type": "agent_http_api",
  "name": "通用对话 Agent v1",
  "description": "支持工具调用和多轮对话的 Agent",
  "version": "v1.0.0",
  "endpoint": "https://example.com/agent/invoke",
  "adapter_type": "openapi_http",
  "adapter_config": {
    "auth_type": "bearer",
    "timeout_ms": 30000,
    "headers": {}
  },
  "input_schema": {},
  "output_schema": {}
}
```

**Response**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1,
    "target_code": "target_001"
  },
  "trace_id": "eval_20260417_0001"
}
```

### 4.1.2 查询评测目标列表
- **Method**：`GET`
- **Path**：`/api/v1/evaluation-targets`
- **Query**：`name`、`target_type`、`enabled`、`page`、`page_size`

### 4.1.3 查询评测目标详情
- **Method**：`GET`
- **Path**：`/api/v1/evaluation-targets/{target_id}`

### 4.1.4 修改评测目标
- **Method**：`PUT`
- **Path**：`/api/v1/evaluation-targets/{target_id}`

### 4.1.5 删除评测目标
- **Method**：`DELETE`
- **Path**：`/api/v1/evaluation-targets/{target_id}`

---

## 4.2 评测任务管理

### 4.2.1 创建评测任务
- **Method**：`POST`
- **Path**：`/api/v1/evaluation-tasks`

**Request**
```json
{
  "name": "通用 Agent 版本评测",
  "description": "评估 Agent 的结果输出、过程表现与交互能力",
  "target_id": 1,
  "dataset_id": 1,
  "evaluation_method_config": ["method_result", "method_process"],
  "metric_config": {
    "explicit_metrics": ["task_success_rate", "response_time", "tool_call_accuracy"],
    "fuzzy_metrics": ["reasoning_quality", "interaction_quality"]
  },
  "run_config": {
    "timeout_ms": 30000,
    "concurrency": 2,
    "retry_times": 1,
    "run_mode": "async"
  }
}
```

**Response**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1,
    "task_code": "task_001"
  },
  "trace_id": "eval_20260417_0001"
}
```

### 4.2.2 查询评测任务列表
- **Method**：`GET`
- **Path**：`/api/v1/evaluation-tasks`
- **Query**：`name`、`status`、`target_id`、`page`、`page_size`、`created_at_from`、`created_at_to`

### 4.2.3 查询评测任务详情
- **Method**：`GET`
- **Path**：`/api/v1/evaluation-tasks/{task_id}`

### 4.2.4 修改评测任务
- **Method**：`PUT`
- **Path**：`/api/v1/evaluation-tasks/{task_id}`

### 4.2.5 删除评测任务
- **Method**：`DELETE`
- **Path**：`/api/v1/evaluation-tasks/{task_id}`

### 4.2.6 启动评测任务
- **Method**：`POST`
- **Path**：`/api/v1/evaluation-tasks/{task_id}/runs`

**Request**
```json
{
  "run_mode": "async",
  "dataset_version": "v1"
}
```

**Response**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "run_id": 1,
    "run_code": "run_001",
    "status": "queued"
  },
  "trace_id": "eval_20260417_0001"
}
```

---

## 4.3 评测执行管理

### 4.3.1 查询运行列表
- **Method**：`GET`
- **Path**：`/api/v1/evaluation-runs`
- **Query**：`task_id`、`status`、`page`、`page_size`

### 4.3.2 查询运行详情
- **Method**：`GET`
- **Path**：`/api/v1/evaluation-runs/{run_id}`

### 4.3.3 取消运行
- **Method**：`POST`
- **Path**：`/api/v1/evaluation-runs/{run_id}/cancel`

### 4.3.4 暂停运行
- **Method**：`POST`
- **Path**：`/api/v1/evaluation-runs/{run_id}/pause`

### 4.3.5 恢复运行
- **Method**：`POST`
- **Path**：`/api/v1/evaluation-runs/{run_id}/resume`

### 4.3.6 重试运行
- **Method**：`POST`
- **Path**：`/api/v1/evaluation-runs/{run_id}/retry`

### 4.3.7 查询运行摘要
- **Method**：`GET`
- **Path**：`/api/v1/evaluation-runs/{run_id}/summary`

### 4.3.8 查询运行样本结果
- **Method**：`GET`
- **Path**：`/api/v1/evaluation-runs/{run_id}/samples`

### 4.3.9 查询运行指标明细
- **Method**：`GET`
- **Path**：`/api/v1/evaluation-runs/{run_id}/metrics`

---

## 4.4 数据集管理

### 4.4.1 创建数据集
- **Method**：`POST`
- **Path**：`/api/v1/datasets`

**Request**
```json
{
  "dataset_code": "dataset_001",
  "name": "通用评测数据集",
  "description": "覆盖通用问答、工具调用、流程执行等场景",
  "source_type": "manual",
  "version": "v1",
  "status": "draft"
}
```

### 4.4.2 查询数据集列表
- **Method**：`GET`
- **Path**：`/api/v1/datasets`

### 4.4.3 查询数据集详情
- **Method**：`GET`
- **Path**：`/api/v1/datasets/{dataset_id}`

### 4.4.4 上传数据集样本
- **Method**：`POST`
- **Path**：`/api/v1/datasets/{dataset_id}/samples`

**Request**
```json
{
  "sample_code": "sample_001",
  "sample_type": "generic_qa",
  "input_payload": {
    "task": "解释如何生成评测报告"
  },
  "expected_output": {
    "answer": "通过导出接口生成报告"
  },
  "reference_context": {
    "domain": "agent_evaluation"
  },
  "ground_truth": {
    "label": "correct"
  },
  "metadata": {
    "difficulty": "easy"
  }
}
```

### 4.4.5 删除数据集
- **Method**：`DELETE`
- **Path**：`/api/v1/datasets/{dataset_id}`

### 4.4.6 查询样本列表
- **Method**：`GET`
- **Path**：`/api/v1/datasets/{dataset_id}/samples`

---

## 4.5 评估方法与指标

### 4.5.1 获取评估方法列表
- **Method**：`GET`
- **Path**：`/api/v1/evaluation-methods`

### 4.5.1.1 评估方法对象
```json
{
  "method_code": "method_result",
  "name": "面向结果评估",
  "category": "result",
  "description": "仅关注输入输出与最终结果",
  "config_schema": {},
  "enabled": true
}
```

### 4.5.2 获取指标列表
- **Method**：`GET`
- **Path**：`/api/v1/metrics`

### 4.5.2.1 指标对象
```json
{
  "metric_code": "task_success_rate",
  "name": "任务成功率",
  "metric_type": "explicit",
  "dimension": "effect",
  "description": "评估任务是否成功完成",
  "calc_mode": "rule",
  "config_schema": {},
  "enabled": true
}
```

### 4.5.3 创建自定义指标
- **Method**：`POST`
- **Path**：`/api/v1/metrics`

### 4.5.4 查询指标配置详情
- **Method**：`GET`
- **Path**：`/api/v1/metrics/{metric_id}`

### 4.5.5 更新指标定义
- **Method**：`PUT`
- **Path**：`/api/v1/metrics/{metric_id}`

### 4.5.6 查询运行指标明细
- **Method**：`GET`
- **Path**：`/api/v1/evaluation-runs/{run_id}/metrics`

---

## 4.6 过程轨迹与工具调用

### 4.6.1 查询过程轨迹
- **Method**：`GET`
- **Path**：`/api/v1/evaluation-runs/{run_id}/traces`

### 4.6.1.1 轨迹对象
```json
{
  "step_index": 3,
  "phase": "act",
  "decision": "调用工具完成下一步操作",
  "observation": "工具调用成功",
  "state_snapshot": {
    "current_sample_id": 1,
    "current_status": "running"
  },
  "tool_calls": [
    {
      "tool_name": "example_tool",
      "success": true,
      "duration_ms": 1200
    }
  ],
  "created_at": "2026-04-17T10:06:12Z"
}
```

### 4.6.2 查询工具调用日志
- **Method**：`GET`
- **Path**：`/api/v1/evaluation-runs/{run_id}/tool-calls`

### 4.6.2.1 工具调用对象
```json
{
  "tool_name": "example_tool",
  "input_payload": {
    "param": "value"
  },
  "output_payload": {
    "success": true
  },
  "success": true,
  "error_type": null,
  "duration_ms": 1200,
  "created_at": "2026-04-17T10:06:12Z"
}
```

### 4.6.3 创建轨迹记录
- **Method**：`POST`
- **Path**：`/api/v1/evaluation-traces`

### 4.6.4 创建工具调用日志
- **Method**：`POST`
- **Path**：`/api/v1/evaluation-tool-calls`

---

## 4.7 报告与分析

### 4.7.1 查询评测报告列表
- **Method**：`GET`
- **Path**：`/api/v1/evaluation-runs/{run_id}/reports`

### 4.7.2 创建评测报告
- **Method**：`POST`
- **Path**：`/api/v1/evaluation-reports`

### 4.7.3 导出评测报告
- **Method**：`POST`
- **Path**：`/api/v1/evaluation-runs/{run_id}/export`

**Response**
```json
{
  "report_title": "通用 Agent 版本评测报告",
  "report_summary": "本次评测整体表现良好",
  "report_path": "/reports/run_001.pdf",
  "report_format": "pdf",
  "created_at": "2026-04-17T10:10:00Z"
}
```

### 4.7.4 多任务对比分析
- **Method**：`POST`
- **Path**：`/api/v1/analysis/compare`

**Request**
```json
{
  "task_ids": [1, 2],
  "metric_keys": ["task_success_rate", "response_time", "tool_call_accuracy"]
}
```

### 4.7.5 查询分析列表
- **Method**：`GET`
- **Path**：`/api/v1/analysis`

### 4.7.6 查询分析详情
- **Method**：`GET`
- **Path**：`/api/v1/analysis/{analysis_id}`

---

## 4.8 实时状态推送

### 4.8.1 WebSocket 连接
- **Path**：`/api/v1/ws/evaluation-runs/{run_id}`

### 4.8.2 推送内容示例
```json
{
  "event": "run_progress",
  "run_id": 1,
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
- `41006`：被测目标调用失败
- `41007`：适配器配置错误
- `41008`：运行暂停中，无法执行当前操作

---

## 6. 权限与审计

### 6.1 权限控制
平台建议支持以下权限：
- 普通用户：创建、执行、查看评测任务
- 管理员：管理数据集、指标、评测目标与系统配置

### 6.2 审计日志
系统应记录以下关键操作：
- 创建/修改/删除评测任务
- 创建/修改/删除评测目标
- 启动/取消/重试/暂停/恢复评测运行
- 导入/删除数据集
- 指标配置变更
- 导出评测报告

---

## 7. 与任务1的对接说明

任务2平台面向通用 Agent 评估，同时可选 AI Coding Agent 作为示例场景。任务1如果是任意类型的 Agent，可提供以下数据，以便任务2进行评估：
- 输入参数
- 最终输出
- 中间步骤轨迹
- 工具调用日志
- 执行耗时
- 成功/失败状态
- 可选参考上下文或检索结果
- 结构化响应或文件变更记录
- 外部工具执行结果
- 异常或失败原因

这样任务2即可同时支持：
- 结果型评估
- 过程型评估
- 显式指标评估
- 基于 Ragas 的指标评估
- 通用 Agent 评估与示例场景评估

---

## 8. 版本记录
- v1.0：初版 API 设计文档，覆盖任务、运行、数据集、指标、结果分析和 WebSocket 推送能力
- v1.1：统一为“通用平台 + 示例场景”的表述，并调整资源模型与接口命名
