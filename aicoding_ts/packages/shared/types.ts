// ── LLM 标准消息类型（与 OpenAI tool use API 对齐）──

export type SystemMessage = {
  role: 'system';
  content: string;
};

export type UserMessage = {
  role: 'user';
  content: string;
};

export type ToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

export type AssistantMessage = {
  role: 'assistant';
  content: string | null;
  tool_calls?: ToolCall[];
};

export type ToolResultMessage = {
  role: 'tool';
  tool_call_id: string;
  name: string;
  content: string;
};

export type ChatMessage = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage;

// ── 任务摘要（会话间记忆载体）──

export type TaskSummary = {
  taskId: string;
  prompt: string;
  startedAt: string;
  completedAt: string;
  status: 'completed' | 'aborted';
  summary: string;
  toolsUsed: string[];
  filesModified: string[];
};

// ── 会话对象 ──

export type Session = {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  taskSummaries: TaskSummary[];
  activeTaskId: string | null;
};

// ── SSE 事件类型（向后兼容原有 chunk/tool/result/error，新增以下类型）──

export type ChunkEvent = {
  type: 'chunk';
  chunk: string;
};

export type ToolEvent = {
  type: 'tool';
  tool: string;
  summary?: string;
  detail?: string;
};

export type ResultEvent = {
  type: 'result';
  result: unknown;
};

export type ErrorEvent = {
  type: 'error';
  message: string;
};

export type PlanEvent = {
  type: 'plan';
  taskId: string;
  steps: string[];
};

export type ConfirmRequestEvent = {
  type: 'confirm_request';
  taskId: string;
  confirmId: string;
  question: string;
  options?: string[];
};

export type ConfirmResolvedEvent = {
  type: 'confirm_resolved';
  confirmId: string;
  answer: string;
};

export type TaskStatusEvent = {
  type: 'task_status';
  taskId: string;
  status: 'planning' | 'executing' | 'waiting_confirm' | 'summarizing' | 'done' | 'error';
  note?: string;
};

export type SessionEvent = {
  type: 'session';
  sessionId: string;
  isNew: boolean;
};

export type AgentEvent =
  | ChunkEvent
  | ToolEvent
  | ResultEvent
  | ErrorEvent
  | PlanEvent
  | ConfirmRequestEvent
  | ConfirmResolvedEvent
  | TaskStatusEvent
  | SessionEvent;

// ── 挂起确认（服务端内存中维护）──

export type PendingConfirm = {
  confirmId: string;
  taskId: string;
  sessionId: string;
  question: string;
  options?: string[];
  createdAt: number;
  resolve: (answer: string) => void;
  reject: (reason: Error) => void;
};
