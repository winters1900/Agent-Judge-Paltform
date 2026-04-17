# Backend Scaffold

## 目标
提供任务2评估平台的后端骨架，承载任务管理、运行调度、指标计算、轨迹记录与结果分析能力。

## 建议结构
- `app/main.py`：应用入口
- `app/core/`：配置、数据库、WebSocket 等基础能力
- `app/models/`：数据库模型
- `app/schemas/`：请求与响应结构
- `app/api/`：接口路由
- `app/services/`：业务服务
- `app/workers/`：Celery worker 与异步任务

## 技术约定
- 使用 FastAPI 构建 API
- 使用 SQLAlchemy 映射数据库
- 使用 Celery 执行异步评测任务
- 使用 Redis 承担队列与缓存职责
- 使用 MySQL 持久化核心业务数据
