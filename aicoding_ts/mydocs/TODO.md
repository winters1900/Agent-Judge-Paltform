# TODO

## 进行中

（无）

## 待做

- [x] **Step 5**：前端改造（2026-04-25）
  - `apps/web/index.html`：topbar 新增会话 ID 徽章、状态徽章、新建会话按钮
  - `apps/web/app.ts`：`streamChat()`、`initSession()`、`renderConfirmCard()`、`submitConfirm()`、`createNewSession()`、`setAgentStatus()`
  - `apps/web/styles.css`：confirm-card、session-badge、agent-status-badge 样式
  - `apps/web/tsconfig.build.json`：新建 build 专用 tsconfig（启用 emit）
  - `package.json`：`build:web` 改用 tsconfig.build.json

- [ ] **Step 6**：E2E 确认流程验证
  - 触发 `ask_user` → 确认卡片出现 → 用户响应 → loop 继续 → 任务完成
  - 刷新页面后会话 ID 和 taskSummaries 恢复

## 已完成

- [x] **Step 4**：改造 `apps/runtime/server.ts` 新增 API（2026-04-25）
  - `GET /api/session` — 返回当前会话信息（messageCount + taskSummaries）
  - `POST /api/session` — 创建新会话
  - `POST /api/agent/chat` — 主要 agent 接口（SSE），调用 `runTask()`
  - `POST /api/agent/confirm` — 响应 agent 确认请求
  - `pendingConfirms` Map + `createConfirmHook()`
  - `GET /api/meta` 新增 `sessionId` 字段

- [x] **Step 3**：改造 `agent-core/index.ts`（2026-04-25）
  - 新增 `runTask(sessionId, prompt, selectedFile, onEvent, onConfirm)`
  - `createAgentCore()` 新增可选 `sessionStore` 参数
  - 构建 system prompt（含工作区快照 + project-memory + 近5条 taskSummaries）
  - 组装 llmMessages = system + 历史 + 当前用户消息
  - loop 结束后持久化消息和 TaskSummary 到 session
  - `preview()` 清理为纯向后兼容别名，走相同 ReAct loop

- [x] **Step 2**：ReAct Loop 改造（`packages/agent-core/executor.ts`）（2026-04-25）
  - `runModel()` → `runReActLoop()`，实现标准 ReAct 循环（最多 20 轮）
  - 工具结果以 `tool_result` 消息回传给模型
  - 新增 `ask_user` 工具定义，loop 暂停等待用户确认
  - `parallel_tool_calls` 改为 `false`
  - 导出 `LoopResult`、`ConfirmHook` 类型
  - 新建 `packages/shared/types.ts`（ChatMessage、Session、TaskSummary、AgentEvent、PendingConfirm）
  - 新建 `packages/session-store/index.ts`（createSession、loadSession、appendMessages 等7个方法）
  - `packages/shared/index.ts` 新增 re-export types.ts

- [x] LLM Client 抽象解耦（2026-04-22）
  - 新建 `packages/llm-client/types.ts`、`openai.ts`、`mock.ts`、`index.ts`
  - 支持 OpenAI-compat / 豆包 / Mock，通过 `.env` 配置
  - 向后兼容 `DOUBAO_*` 环境变量
