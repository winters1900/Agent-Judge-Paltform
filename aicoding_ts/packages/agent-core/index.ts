import { createSuccessResponse } from "../shared/index.ts";
import type { LlmClient } from "../llm-client/index.ts";
import { createPlanner } from "./planner.ts";
import { createExecutor } from "./executor.ts";
import { createReviewer } from "./reviewer.ts";
import { createSummarizer } from "./summarizer.ts";
import { createMcpClient } from "./mcp-client.ts";
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
  readFile: (path: string) => unknown;
  writeFile: (path: string, content: string) => unknown;
  runCommand: (command: string) => unknown;
  listWorkspace: () => unknown[];
  searchInWorkspace: (query: string, path?: string) => unknown;
  patchFile: (path: string, patch: string) => unknown;
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
    onConfirm: ConfirmHook,
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

    const loopResult = await executor.runReActLoop(llmClient, llmMessages, onEvent, onConfirm);

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
    async preview(
      prompt: string,
      selectedFile: string | null = null,
      onChunk: ((chunk: unknown) => void) | null = null,
    ) {
      const context = contextBuilder.buildForPrompt(prompt, selectedFile);
      const taskState = createTaskState(prompt, selectedFile, context);
      const plan = planner.plan(context);
      recordPhase(taskState, "planning", "构建上下文并分析需求");

      if (llmClient.model === "mock") {
        const fallback =
          "理解需求；构建上下文；生成/修改文件；执行命令验证；回显结果。";
        recordPhase(taskState, "execution", "mock 模式直接返回结果");
        const review = reviewer.review({ content: fallback, toolResults: [] });
        recordPhase(taskState, "review", review.summary);
        taskState.summary = summarizer.summarize({
          plan,
          execution: { content: fallback },
          review,
        });
        if (onChunk) onChunk(fallback);
        return createSuccessResponse({
          status: "mocked",
          output: fallback,
          context,
          taskState,
          plan,
        });
      }

      const messages = buildMessages(context, taskState.status, taskState);
      recordPhase(taskState, "execution", "开始请求模型并执行工具");
      const { result, content, toolCalls, toolResults } =
        (await executor.runModel(
          llmClient,
          messages,
          onChunk ?? undefined,
        )) as ExecutorResult;

      taskState.toolCalls.push(...toolCalls);
      taskState.toolResults.push(...toolResults);

      const review = reviewer.review({ content, toolResults });
      recordPhase(taskState, "review", review.summary);
      taskState.summary = summarizer.summarize({
        plan,
        execution: { content },
        review,
      });
      taskState.status = "done";

      const createdFiles = toolResults
        .filter((item) => item.name === "write_file" && item.result?.ok)
        .map((item) => item.result?.file);

      return createSuccessResponse({
        status: "ok",
        model: llmClient.model,
        output: content,
        toolCalls,
        toolResults,
        createdFiles,
        transcript: [{ role: "assistant", content, toolCalls }],
        raw: result,
        context,
        taskState,
        plan,
        review,
      });
    },

    /**
     * 生成项目骨架 - 使用模板创建新项目
     */
    async generateScaffold(
      projectParams: TemplateParams,
      onChunk?: (chunk: unknown) => void,
    ) {
      const taskState: TaskState = {
        status: "generating_scaffold",
        prompt: `生成 ${projectParams.templateId} 模板项目：${projectParams.projectName}`,
        selectedFile: null,
        phases: [],
        contextBudget: { includedFiles: [], maxChars: 0, maxFiles: 0 },
        toolCalls: [],
        toolResults: [],
        summary: "",
      };

      try {
        recordPhase(
          taskState,
          "scaffold_planning",
          `选择模板 ${projectParams.templateId}`,
        );

        // 生成项目文件
        const generated = templateGenerator.generateProject(
          projectParams.templateId,
          projectParams,
        );
        recordPhase(
          taskState,
          "scaffold_generation",
          `生成 ${generated.files.length} 个文件`,
        );

        // 写入所有文件到工作区
        const fileWriteResults = [];
        for (const file of generated.files) {
          const result = await toolGateway.mcp.callTool("write_file", {
            path: file.path,
            content: file.content,
          });
          fileWriteResults.push(result);
          taskState.toolResults.push({ name: "write_file", result });

          if (onChunk) {
            onChunk({
              type: "tool",
              tool: "write_file",
              summary: `创建文件: ${file.path}`,
            });
          }
        }

        recordPhase(taskState, "scaffold_complete", `项目骨架生成完成`);
        taskState.status = "done";
        taskState.summary = `已成功生成 ${generated.scaffoldInfo.templateName} 项目骨架，包含 ${generated.scaffoldInfo.fileCount} 个文件。项目名称：${generated.scaffoldInfo.projectName}`;

        return createSuccessResponse({
          status: "scaffold_ok",
          scaffoldInfo: generated.scaffoldInfo,
          files: generated.files.map((f) => ({ path: f.path })),
          output: generated.summary,
          taskState,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "未知错误";
        recordPhase(taskState, "scaffold_error", message);
        taskState.status = "failed";
        return createSuccessResponse({
          status: "scaffold_error",
          error: message,
          taskState,
        });
      }
    },

    /**
     * 获取可用的模板列表
     */
    getTemplates() {
      return templateGenerator.getTemplateList();
    },

    /**
     * 获取指定类别的模板
     */
    getTemplatesByCategory(category: string) {
      return templateGenerator.getTemplatesByCategory(category);
    },

    /**
     * 获取单个模板的详细信息
     */
    getTemplateDetail(templateId: string) {
      return templateGenerator.getTemplateDetail(templateId);
    },

    async writeFile(path: string, content: string) {
      return toolGateway.mcp.callTool("write_file", { path, content });
    },

    async runCommand(command: string) {
      return toolGateway.mcp.callTool("run_command", { command });
    },
  };
}
