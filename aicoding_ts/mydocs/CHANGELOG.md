# CHANGELOG

## [Unreleased]

### 进行中
（无）

---

## 2026-04-27（三）— 合并自 upstream/master

### Added
- `packages/mcp-server/index.ts`：**[upstream]** JSON-RPC 2.0 MCP server 实现，支持 `tools/list`、`tools/call`、`resources/list`、`resources/read`、`prompts/list`、`prompts/get`、`initialize` 等方法；导出 `McpServer` 类型（补充）
- `packages/workspace-manager/index.ts`：**[upstream]** `searchInWorkspace(query, path?)` 全文搜索（返回行/列/片段）；`patchFile(path, patch)` 局部补丁应用（支持 unified diff / `before\n---\nafter` / `before => after`）
- `packages/agent-core/executor.ts`：**[upstream]** 新增 `search_in_workspace`、`patch_file` 工具定义及调用；`patch_file` 写入记入 `filesModified`
- `apps/runtime/server.ts`：**[upstream]** `GET /mcp` — SSE ready 事件；`POST /mcp` — JSON-RPC handler；`GET /api/mcp/tools`、`/api/mcp/resources`、`/api/mcp/prompts` 列表路由；`POST /api/mcp/tool/:name`、`/api/mcp/prompt/:name`、`GET /api/mcp/resource/:name` 单项调用路由

### Changed
- `packages/tool-gateway/index.ts`：**[upstream]** 所有工具注册为 MCP tool/resource/prompt，暴露 `mcp: McpServer` 属性；**[保留我方]** `read_file` handler 改为磁盘读取（保留路径安全校验）；`WorkspaceManager` 类型新增 `projectId` 和 `getRootDir`
- `packages/agent-core/index.ts`：**[我方调整]** system prompt 加入 `patch_file` 优先修改已有文件、`search_in_workspace` 先定位目标的使用指引
- `packages/agent-core/mcp-client.ts`：**[upstream]** 新建，`McpToolClient` 类型别名



### Added
- `apps/web/app.ts`：`promptInput` Enter 键直接发送消息，Shift+Enter 换行；路径输入框 Tab 键填入补全第一项并展开下一层子目录

### Fixed
- `packages/tool-gateway/index.ts`：`readFile` 改为从磁盘按需读取（修复 scanDir 去内容后点击文件无内容显示的问题）；新增路径安全校验（防止路径穿越）
- `apps/runtime/server.ts`：`/api/file/:path` 路由改为直接从磁盘读取文件内容
- `packages/context-builder/index.ts`：`buildForPrompt` 改为 async，适配异步 readFile
- `apps/web/app.ts`：修正新建会话弹窗描述（原文误称"历史摘要会保留"，实际新会话完全从空白开始）

## 2026-04-27

### Added
- `packages/workspace-manager/index.ts`：`switchRoot(newRootDir)` 运行时切换工作区根目录；`getRootDir()` 查询当前根目录
- `apps/runtime/server.ts`：`POST /api/workspace/load` — 切换工作区并新建会话；`GET /api/fs/suggest?prefix=` — 返回路径前缀匹配的子目录列表（最多10条）
- `apps/web/index.html`：顶部路径输入框（`#workspacePathInput`）、补全下拉（`#workspaceSuggestList`）、加载按钮（`#loadWorkspaceBtn`）
- `apps/web/app.ts`：工作区历史记录（localStorage，最多10条）；防抖补全（200ms）；点击补全项后自动加载下一层子目录；加载成功后更新会话/文件树/聊天提示
- `apps/web/styles.css`：路径输入框、补全下拉样式；补全列表改为 `width: max-content` + 横向滚动，完整显示长路径

### Changed
- `packages/workspace-manager/index.ts`：`scanDir()` 新增深度限制（6层）、跳过 `node_modules/.git/dist` 等大目录、**不再读取文件内容**（扫描只建结构，内容按需读取）
- `apps/runtime/server.ts`：`/api/fs/suggest` 补全逻辑改为对最后一段做前缀过滤，输入 `/Users/I` 只返回以 `I` 开头的子目录
- `apps/web/styles.css`：`.workspace-bar` 去掉 `max-width: 520px` 限制，输入框随 topbar 自由伸展

### Fixed
- `packages/workspace-manager/index.ts`：`switchRoot()` 改为先 `stat()` 验证路径存在且为目录，不存在时抛出错误而非静默返回空树

## 2026-04-25（新周期）

### Added
- `packages/workspace-manager/index.ts`：`scanDir()` 递归磁盘扫描，`loadFromDisk()` 改为真正扫描工作区目录
- `packages/agent-core/index.ts`：`truncateMessages(messages, maxCount=40)` 滑动窗口截断，在 user 消息边界截断避免孤立 tool_result
- `apps/web/app.ts`：`renderMarkdown()` XSS 安全 Markdown 渲染（无新依赖），`TOOL_COLORS` 按工具名着色，chunk 累积后整体渲染，工具调用卡彩色徽章
- `apps/web/styles.css`：`.message pre/code/ul/li/strong`、`.tool-call-badge` 样式

### Changed
- `apps/runtime/server.ts`：`createWorkspaceManager` 传入 `process.env.WORKSPACE_DIR`
- `.env.example`：新增 `WORKSPACE_DIR` 可选配置说明

### Fixed
- `apps/web/app.ts`：修复 `tool` 事件后续 `chunk` 覆盖工具卡结构的 bug——`updateAssistant` 检测 `.tool-call-body` 存在时写入 body 而非整体 innerHTML，工具徽章、折叠箭头结构不再被破坏

---

## 2026-04-25

### Fixed
- `apps/web/app.ts`：修复 `write_file` 调用后工作区文件树不自动刷新的问题（改为监听 `tool` 事件中的 `write_file` 而非依赖 result 的 toolResults 字段）


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
