# Step 2_2 项目基础框架

本目录用于实现迭代二任务二：Agent 应用评估平台。

## 项目定位
- 前后端分离 Web 项目
- 支持评测任务管理、评测执行、过程轨迹记录、结果分析与对比
- 支持接入 Ragas 及自定义评估指标

## 技术选型
- 前端：React + TypeScript + Ant Design + ECharts
- 后端：FastAPI + SQLAlchemy + Celery + Redis + MySQL
- 实时通信：WebSocket
- 评估能力：Ragas + 自定义评估组件

## 目录说明
- `backend/`：后端服务骨架
- `frontend/`：前端应用骨架
- `文档/`：需求、API、数据库与框架文档
- `任务/`：任务说明

## 当前状态
此目录仅搭建项目框架与占位文件，后续可继续补充具体实现。
