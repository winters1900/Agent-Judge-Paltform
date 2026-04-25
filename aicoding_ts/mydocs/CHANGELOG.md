# CHANGELOG

## [Unreleased]

### 进行中
（无）

---

## 2026-04-25

### Added
- `apps/web/index.html`：topbar 新增会话 ID 徽章（`#sessionBadge`）、状态徽章（`#agentStatusBadge`）、新建会话按钮
- `apps/web/app.ts`：
  - `initSession()` — 页面加载时恢复会话 ID 和历史任务摘要
  - `streamChat()` — 替代 `streamPreview()`，调用 `/api/agent/chat`，携带 sessionId，处理新事件类型
  - `renderConfirmCard()` — 渲染 agent confirm 卡片（支持选项按钮 / 自由输入）
  - `submitConfirm()` — POST /api/agent/confirm，卡片变为已响应状态
  - `createNewSession()` — 弹确认框 → POST /api/session → 清空 chatLog
  - `setAgentStatus()` — 联动状态徽章和输入禁用
- `apps/web/styles.css`：confirm-card、session-badge、agent-status-badge、topbar-right 样式
- `apps/web/tsconfig.build.json`：build 专用 tsconfig（不含 `allowImportingTsExtensions`，启用 emit）

### Changed
- `package.json`：`build:web` / `dev:web` 改用 `tsconfig.build.json`


  - `GET /api/session` — 返回当前会话 sessionId、messageCount、taskSummaries
  - `POST /api/session` — 创建新会话，更新 current.json
  - `POST /api/agent/chat` — 主要 agent 接口（SSE），调用 `runTask()`，携带 sessionId
  - `POST /api/agent/confirm` — 响应 agent 确认请求，resolve 挂起的 Promise
  - `pendingConfirms: Map<string, PendingConfirm>` — 内存 confirm 挂起表（5 分钟超时）
  - `createConfirmHook()` — 为每次任务生成 confirm 钩子
  - `GET /api/meta` 新增 `sessionId` 字段

### Changed
- `apps/runtime/server.ts`：模块级初始化加入 `sessionStore`，`agentCore` 注入 sessionStore 参数


## 2026-04-25

### Added
- `packages/agent-core/index.ts`：`runTask()` 主任务入口
  - `createAgentCore()` 新增可选 `sessionStore` 参数
  - system prompt 动态构建（工作区快照 + project-memory + 近5条 taskSummaries）
  - 任务完成后自动写入 TaskSummary 到 session
  - 第二次任务自动携带历史消息（多任务记忆）

### Changed
- `packages/agent-core/index.ts`：`preview()` 清理为纯向后兼容别名，内部走相同 ReAct loop

---

## 2026-04-25

### Added
- `packages/agent-core/executor.ts`：`runReActLoop()` 标准 ReAct 循环
  - 工具结果以 `tool_result` 消息回传模型，支持多轮推理（最多 20 轮）
  - 新增 `ask_user` 工具，loop 遇到时暂停并触发 `onConfirm` 钩子，等用户响应后继续
  - 推送 `task_status(waiting_confirm)` 事件
  - 导出 `LoopResult`、`ConfirmHook` 类型
- `packages/agent-core/index.ts`：临时桥接 `runReActLoop()`（Step 3 完整重构）

### Added
- `packages/shared/types.ts`：新增所有核心类型定义
  - `ChatMessage`（SystemMessage / UserMessage / AssistantMessage / ToolResultMessage）
  - `Session`、`TaskSummary`
  - `AgentEvent` 联合类型（ChunkEvent / ToolEvent / ResultEvent / ErrorEvent / PlanEvent / ConfirmRequestEvent / ConfirmResolvedEvent / TaskStatusEvent / SessionEvent）
  - `PendingConfirm`
- `packages/session-store/index.ts`：会话持久化层
  - `createSession()`、`loadSession()`、`saveSession()`
  - `getOrCreateCurrentSession()`
  - `appendMessages()`、`appendTaskSummary()`
  - `readProjectMemory()`
- `mydocs/agent-memory-and-orchestration-plan.md`：记忆管理与流程编排完整改造规划

### Changed
- `packages/shared/index.ts`：新增 `export * from './types.ts'`

---

## 2026-04-22

### Added
- `packages/llm-client/types.ts`：`LlmClient` 接口、`ChatOptions` 类型
- `packages/llm-client/openai.ts`：OpenAI-compatible 实现（含豆包兼容模式）
- `packages/llm-client/mock.ts`：Mock 实现
- `packages/llm-client/index.ts`：`createLlmClient()` 工厂函数
- `mydocs/llm-provider-abstraction.md`：LLM 抽象层设计文档

### Changed
- `apps/runtime/server.ts`：替换原有硬编码 LLM 调用，改用 `createLlmClient()`
- `.env.example`：新增 `LLM_*` 系列环境变量说明

### Notes
- 向后兼容 `DOUBAO_API_KEY` / `DOUBAO_MODEL` / `DOUBAO_BASE_URL` 旧变量
- 豆包专有参数（`thinking`、`reasoning_effort`）通过 `LLM_PROVIDER=doubao` 自动注入
