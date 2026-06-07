# TODO

## 进行中

（无）

## 待做

- [ ] **工具链后续（可选）**：MCP 配置并入工具管理 Tab、外部工具禁用、工具日志持久化到磁盘

- [ ] **上下文管理优化**：将当前的"截断"改为真正的"压缩"
  - 现状：`truncateMessages(messages, 40)` 只是把旧消息从头切掉，信息直接丢失
  - 目标：新任务组装 `llmMessages` 时只传任务摘要（`taskSummaries`），不传原始历史消息；原始消息仅在任务内部 ReAct loop 中使用，任务结束后不再累积传递
  - 相关文件：`packages/agent-core/index.ts` `truncateMessages(session.messages)` 调用

## 已完成（迭代三 工具链 2026-06-04）

- [x] **工具链二期：patch/日志/降级/UI**（2026-06-04）
  - `patch-matcher.ts` fuzzy 匹配 + `@@ line N` 行号锚点
  - `tool-call-log.ts` + `GET /api/tools/:name/logs`
  - `tool-fallback.ts` 失败降级提示；executor 过滤已禁用工具
  - `tool-definitions.ts` 工具描述优化；UI 测试/日志、diff_file 对话内格式化

- [x] **工具链：run_command 安全确认 + 白名单**（2026-06-04）
  - `command-safety.ts` / `command-whitelist-store.ts` / `run-command.ts`
  - SSE `command_confirm_request` + `POST /api/agent/command-confirm`
  - 新增工具 `read_lints`、`diff_file`
  - Web：命令确认弹窗 + 白名单 CRUD 面板

## 已完成（新周期 2026-04-27）

- [x] **[合并自 upstream] MCP 协议封装 + search/patch 工具**（2026-04-27）
  - `packages/mcp-server/index.ts`：新建，JSON-RPC 2.0 MCP server，实现 `tools/call`、`resources/read`、`prompts/get` 等方法
  - `packages/tool-gateway/index.ts`：所有工具注册为 MCP tool/resource/prompt，暴露 `mcp` 属性；`read_file` handler 改为磁盘读取（保留路径安全校验）
  - `packages/workspace-manager/index.ts`：新增 `searchInWorkspace()`（正则全文搜索，返回行列片段）和 `patchFile()`（支持 unified diff / `before---after` / `before=>after` 格式）
  - `packages/agent-core/executor.ts`：新增 `search_in_workspace`、`patch_file` 工具；`patch_file` 写入也计入 `filesModified`
  - `packages/agent-core/index.ts`：system prompt 加入 patch_file 优先使用指引
  - `apps/runtime/server.ts`：新增 `GET/POST /mcp` 端点（MCP SSE ready + JSON-RPC handler）及 `/api/mcp/*` 辅助路由
  - 保留：`scanDir`/`switchRoot`/`loadFromDisk`、`session-store`、`runTask`、confirm 机制、所有 session/workspace API



- [x] **运行时切换工作区**：页面上自由加载本地目录（2026-04-27）
  - `packages/workspace-manager/index.ts`：`switchRoot()` + `getRootDir()`；`scanDir()` 深度限制（6层）、跳过大目录、不读文件内容
  - `apps/runtime/server.ts`：`POST /api/workspace/load` + `GET /api/fs/suggest?prefix=`（前缀过滤、最多10条）
  - `apps/web/`：路径输入框、防抖补全（点击后自动展开下层）、历史记录、错误红框、长路径横向滚动

- [x] **路径补全增强**（2026-04-27）
  - 输入部分名称（如 `/Users/I`）只返回匹配前缀的子目录，而非全部列出
  - 补全列表最多返回 10 条
  - Tab 键填入第一项并自动展开下一层子目录

- [x] **文件按需读取修复**（2026-04-27）
  - `scanDir` 去掉文件内容预加载后，修复点击文件无内容、Agent `read_file` 返回空的问题
  - `tool-gateway.readFile` 改为从磁盘按需读取，加路径安全校验（防路径穿越）
  - `/api/file/:path` 路由同步改为磁盘读取
  - `context-builder.buildForPrompt` 改为 async 适配

- [x] **键盘交互优化**（2026-04-27）
  - 聊天输入框：Enter 发送，Shift+Enter 换行
  - 路径输入框：Tab 填入补全第一项并展开下一层

- [x] **会话切换**（2026-04-27）
  - `session-store`：新增 `listSessions()`（扫描所有会话返回摘要）、`switchSession()`
  - `server.ts`：`GET /api/sessions` + `POST /api/session/switch`
  - 前端：会话徽章改为可点击按钮，下拉展示本工作区历史会话（ID/时间/最后消息预览/任务数），点击还原完整对话

- [x] **文案修正**（2026-04-27）
  - 新建会话弹窗描述修正：新会话从空白开始，不继承旧会话任何内容

## 已完成（新周期 2026-04-25）

- [x] **新周期 Step 1**：工作区磁盘扫描（loadFromDisk 真正扫描）（2026-04-25）
  - `packages/workspace-manager/index.ts`：新增 `scanDir()`，`loadFromDisk()` 改为递归扫描磁盘
- [x] **新周期 Step 2**：打开已有工作区（WORKSPACE_DIR 环境变量）（2026-04-25）
  - `apps/runtime/server.ts`：传入 `process.env.WORKSPACE_DIR`
  - `.env.example`：新增 `WORKSPACE_DIR` 说明
- [x] **新周期 Step 3**：messages 滑动窗口截断（2026-04-25）
  - `packages/agent-core/index.ts`：`truncateMessages(messages, maxCount=40)` + user 边界截断
- [x] **新周期 Step 4**：前端 Markdown 渲染 + 工具调用卡颜色优化（2026-04-25）
  - `apps/web/app.ts`：`renderMarkdown()`、`TOOL_COLORS`、工具卡彩色徽章、chunk 累积渲染
  - `apps/web/styles.css`：代码块、列表、加粗、工具徽章样式

- [x] **Step 5**：前端改造（2026-04-25）
  - `apps/web/index.html`：topbar 新增会话 ID 徽章、状态徽章、新建会话按钮
  - `apps/web/app.ts`：`streamChat()`、`initSession()`、`renderConfirmCard()`、`submitConfirm()`、`createNewSession()`、`setAgentStatus()`
  - `apps/web/styles.css`：confirm-card、session-badge、agent-status-badge 样式
  - `apps/web/tsconfig.build.json`：新建 build 专用 tsconfig（启用 emit）
  - `package.json`：`build:web` 改用 tsconfig.build.json

- [x] **Step 6**：E2E 确认流程验证（2026-04-25）
  - 触发 `ask_user` → 确认卡片出现、输入框禁用 → 用户点击选项 → loop 继续 → 任务完成
  - 刷新页面后会话 ID 和 taskSummaries 恢复（历史任务 5 条）
  - 修复 `write_file` 后工作区文件树不自动刷新的 bug

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
