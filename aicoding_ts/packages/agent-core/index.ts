import { createSuccessResponse } from "../shared/index.ts";
import type {
  AgentEvent,
  ChatMessage,
  Session,
  SystemMessage,
  TaskSummary,
  UserMessage,
} from "../shared/types.ts";
import type { LlmClient } from "../llm-client/index.ts";
import { createPlanner } from "./planner.ts";
import { createExecutor } from "./executor.ts";
import type { ConfirmHook, ExecutorHooks } from "./executor.ts";
import type { CommandConfirmHook } from "../tool-gateway/run-command.ts";
import { createReviewer } from "./reviewer.ts";
import { createSummarizer } from "./summarizer.ts";
import { createMcpClient } from "./mcp-client.ts";
import { createExternalMcpRegistry } from "../mcp-client/index.ts";
import { createTemplateGenerator } from "../template-generator/index.ts";
import type { TemplateParams } from "../template-generator/types.ts";

type Context = {
  prompt: string;
  selectedFile: string | null;
  selectedFileContent: unknown;
  workspaceSummary: string;
  contextBudget: {
    includedFiles: string[];
    maxChars: number;
    maxFiles: number;
  };
};

type ToolGateway = {
  readFile: (...args: any[]) => unknown;
  writeFile: (...args: any[]) => unknown;
  runCommand: (...args: any[]) => unknown;
  listWorkspace: (...args: any[]) => unknown;
  searchInWorkspace: (...args: any[]) => unknown;
  patchFile: (...args: any[]) => unknown;
  listVersions: (...args: any[]) => unknown;
  createSnapshot: (...args: any[]) => unknown;
  restoreSnapshot: (...args: any[]) => unknown;
};

type SessionStore = {
  loadSession: (id: string) => Promise<Session | null>;
  getOrCreateCurrentSession: () => Promise<Session>;
  appendMessages: (sessionId: string, messages: ChatMessage[]) => Promise<Session>;
  appendTaskSummary: (sessionId: string, summary: TaskSummary) => Promise<Session>;
  readProjectMemory: () => Promise<string>;
};

type ContextBuilder = {
  buildForPrompt: (prompt: string, selectedFile?: string | null) => Promise<Context>;
};

function truncateMessages(messages: ChatMessage[], maxCount = 40): ChatMessage[] {
  if (messages.length <= maxCount) return messages;
  const tail = messages.slice(-maxCount);
  const firstUser = tail.findIndex((m) => m.role === 'user');
  return firstUser > 0 ? tail.slice(firstUser) : tail;
}

function buildSystemPrompt(
  context: Context,
  projectMemory: string,
  taskSummaries: TaskSummary[],
): string {
  const parts = [
    '你是一个 AI Coding Agent，负责在工作区中执行编码任务。',
    '优先使用工具完成文件读取、写入和命令执行，不要编造工具执行结果。',
    '如果是修改已有文件，优先使用 patch_file 做局部修改；只有新建文件、整文件重写或 patch 失败时才使用 write_file。',
    '如需先定位目标，可先调用 search_in_workspace。',
    '如果存在外部 MCP 工具，可按工具名直接调用，它们通常以 mcp__服务名__工具名 的形式出现。',
    '当任务完成时，用简洁中文总结执行结果。',
    '如需用户确认某个破坏性操作或存在不确定的决策，调用 ask_user 工具提出问题。',
    'run_command 对非白名单命令会自动弹出确认；静态检查优先使用 read_lints；查看文件历史变更使用 diff_file。',
    '',
    `## 工作区概况`,
    context.workspaceSummary || '（工作区为空）',
  ];

  if (projectMemory.trim()) {
    parts.push('', '## 项目说明', projectMemory.trim());
  }

  const recentSummaries = taskSummaries.slice(-5);
  if (recentSummaries.length > 0) {
    parts.push('', '## 近期任务历史');
    for (const s of recentSummaries) {
      const date = s.startedAt.slice(0, 10);
      parts.push(`- [${date}] ${s.prompt}：${s.summary}`);
    }
  }

  return parts.join('\n');
}

export function createAgentCore(
  contextBuilder: ContextBuilder,
  toolGateway: ToolGateway,
  llmClient: LlmClient,
  sessionStore?: SessionStore,
  externalMcpRegistry?: ReturnType<typeof createExternalMcpRegistry>,
) {
  const executor = createExecutor(toolGateway, externalMcpRegistry);
  const reviewer = createReviewer();
  const summarizer = createSummarizer();
  const templateGenerator = createTemplateGenerator();

  // ── 主任务入口（有会话管理）──
  async function runTask(
    sessionId: string,
    userPrompt: string,
    selectedFile: string | null,
    onEvent: (event: AgentEvent) => void,
    hooks: ConfirmHook | ExecutorHooks,
  ): Promise<TaskSummary> {
    if (!sessionStore) throw new Error('sessionStore is required for runTask');

    const session = await sessionStore.loadSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const taskId = `task-${Date.now()}`;
    const startedAt = new Date().toISOString();

    onEvent({ type: 'task_status', taskId, status: 'planning' });

    const projectMemory = await sessionStore.readProjectMemory();
    const context = await contextBuilder.buildForPrompt(userPrompt, selectedFile);

    const systemMsg: SystemMessage = {
      role: 'system',
      content: buildSystemPrompt(context, projectMemory, session.taskSummaries),
    };

    const userMsg: UserMessage = { role: 'user', content: userPrompt };

    await sessionStore.appendMessages(sessionId, [userMsg]);

    const llmMessages: ChatMessage[] = [systemMsg, ...truncateMessages(session.messages), userMsg];

    onEvent({ type: 'task_status', taskId, status: 'executing' });

    const loopResult = await executor.runReActLoop(llmClient, llmMessages, onEvent, hooks);

    await sessionStore.appendMessages(sessionId, loopResult.messages);

    onEvent({ type: 'task_status', taskId, status: 'summarizing' });

    const toolResults = loopResult.messages
      .filter((m) => m.role === 'tool')
      .map((m) => ({ name: (m as { name: string }).name, result: { ok: true } }));

    const review = reviewer.review({ content: loopResult.finalContent, toolResults });
    const summaryText = summarizer.summarize({
      plan: { goal: userPrompt, selectedFile },
      execution: { content: loopResult.finalContent },
      review,
    });

    const taskSummary: TaskSummary = {
      taskId,
      prompt: userPrompt,
      startedAt,
      completedAt: new Date().toISOString(),
      status: 'completed',
      summary: summaryText,
      toolsUsed: loopResult.toolsUsed,
      filesModified: loopResult.filesModified,
    };

    await sessionStore.appendTaskSummary(sessionId, taskSummary);

    onEvent({ type: 'task_status', taskId, status: 'done' });
    onEvent({ type: 'result', result: taskSummary });

    return taskSummary;
  }

  // ── 向后兼容的 preview()（无会话管理）──
  async function preview(
    prompt: string,
    selectedFile: string | null = null,
    onChunk: ((chunk: unknown) => void) | null = null,
  ) {
    const context = await contextBuilder.buildForPrompt(prompt, selectedFile);

    if (llmClient.model === 'mock') {
      const fallback = '理解需求；构建上下文；生成/修改文件；执行命令验证；回显结果。';
      if (onChunk) onChunk(fallback);
      return createSuccessResponse({ status: 'mocked', output: fallback, context });
    }

    const systemMsg: SystemMessage = {
      role: 'system',
      content: buildSystemPrompt(context, '', []),
    };
    const userMsg: UserMessage = { role: 'user', content: prompt };
    const messages: ChatMessage[] = [systemMsg, userMsg];

    const onEvent = (event: AgentEvent) => { if (onChunk) onChunk(event); };

    const loopResult = await executor.runReActLoop(llmClient, messages, onEvent);

    const toolResults = loopResult.messages
      .filter((m) => m.role === 'tool')
      .map((m) => ({ name: (m as { name: string }).name, result: { ok: true } }));

    return createSuccessResponse({
      status: 'ok',
      model: llmClient.model,
      output: loopResult.finalContent,
      toolsUsed: loopResult.toolsUsed,
      filesModified: loopResult.filesModified,
      toolResults,
    });
  }

  return {
    runTask,
    preview,

    async generateScaffold(
      projectParams: TemplateParams,
      onChunk?: (chunk: unknown) => void,
    ) {
      const generated = templateGenerator.generateProject(
        projectParams.templateId,
        projectParams,
      );

      for (const file of generated.files) {
        await toolGateway.writeFile(file.path, file.content);
        if (onChunk) {
          onChunk({
            type: "tool",
            tool: "write_file",
            summary: `创建文件: ${file.path}`,
          });
        }
      }

      return createSuccessResponse({
        status: "scaffold_ok",
        scaffoldInfo: generated.scaffoldInfo,
        files: generated.files.map((file) => ({ path: file.path })),
        output: generated.summary,
      });
    },

    getTemplates() {
      return templateGenerator.getTemplateList();
    },

    getTemplatesByCategory(category: string) {
      return templateGenerator.getTemplatesByCategory(category);
    },

    getTemplateDetail(templateId: string) {
      return templateGenerator.getTemplateDetail(templateId);
    },

    async writeFile(path: string, content: string) {
      return toolGateway.writeFile(path, content);
    },

    async runCommand(command: string, ctx?: { onCommandConfirm?: CommandConfirmHook }) {
      return toolGateway.runCommand(command, ctx);
    },
  };
}
