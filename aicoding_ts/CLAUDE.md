# AI Coding Agent Web MVP

## 项目说明

这是一个基于 Web 的 AI 编程助手，通过聊天界面让 AI Agent 自主读写工作区文件、执行命令，实时流式输出执行过程。

- 运行时：Node.js 22+，TypeScript 通过 `--experimental-strip-types` 直接执行，无需编译
- 无外部框架依赖（HTTP 服务使用原生 `node:http`）
- LLM 支持所有 OpenAI-compatible 接口

## 快速开始

```bash
npm install
cp .env.example .env   # 填入 API Key
npm run dev            # 启动，访问 http://localhost:3000
```

## 项目结构

```
server.ts                        # 入口：加载 .env，启动服务
apps/
  runtime/server.ts              # HTTP 服务器 + API 路由
  web/                           # 前端（原生 TypeScript）
packages/
  agent-core/                    # Agent 流程编排
  llm-client/                    # LLM 客户端抽象层
  session-store/                 # 会话持久化层
  tool-gateway/                  # 工具调用（读写文件、执行命令）
  workspace-manager/             # 工作区文件树管理
  context-builder/               # 构建 LLM 上下文
  shared/                        # 公共类型和工具函数
workspaces/demo-project/
  workspace/                     # Agent 操作的工作区目录
  sessions/                      # 会话持久化文件
  project-memory.md              # 项目级说明（可手动编辑，agent 每次读取）
mydocs/                          # 项目内部文档
  TODO.md                        # 待办事项
  CHANGELOG.md                   # 变更记录
  agent-memory-and-orchestration-plan.md  # 记忆管理改造规划
```

## 文档维护规范

**每次完成代码变更后必须同步以下文档：**

- `mydocs/TODO.md`：将完成的项移入"已完成"，更新"进行中"和"待做"
- `mydocs/CHANGELOG.md`：在 `[Unreleased]` 或对应日期下记录 Added / Changed / Fixed

## 当前开发状态

见 `mydocs/TODO.md` 和 `mydocs/CHANGELOG.md`。

## 技术约束

- 不引入新的 npm 依赖（当前只有 `typescript` 和 `@types/node`）
- 持久化使用 JSON 文件，存放在 `workspaces/demo-project/` 下
- SSE 事件向后兼容原有 `chunk / tool / result / error` 类型
- 工作区文件树是内存树，agent 通过工具调用按需读取文件（不做磁盘扫描）

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `LLM_API_KEY` | 是 | API 密钥 |
| `LLM_MODEL` | 是 | 模型名称 |
| `LLM_BASE_URL` | 否 | API 地址，默认 `https://api.openai.com/v1` |
| `LLM_PROVIDER` | 否 | 目前仅 `doubao` 有特殊行为 |
| `LLM_TEMPERATURE` | 否 | 默认 `0.7` |
| `LLM_MAX_TOKENS` | 否 | 默认 `4096` |
| `PORT` | 否 | HTTP 端口，默认 `3000` |
