import { createSuccessResponse } from '../shared/index.ts';
import type { LlmClient } from '../llm-client/index.ts';
import { createPlanner } from './planner.ts';
import { createExecutor } from './executor.ts';
import { createReviewer } from './reviewer.ts';
import { createSummarizer } from './summarizer.ts';
import { createMcpClient } from './mcp-client.ts';

type Context = {
  prompt: string;
  selectedFile: string | null;
  selectedFileContent: unknown;
  workspaceSummary: string;
  contextBudget: { includedFiles: string[]; maxChars: number; maxFiles: number };
};

type TaskState = {
  status: string;
  prompt: string;
  selectedFile: string | null;
  phases: Array<{ phase: string; note: string; at: string }>;
  contextBudget: Context['contextBudget'];
  toolCalls: unknown[];
  toolResults: Array<{ name: string; result?: { ok?: boolean; file?: unknown } }>;
  summary: string;
};


type ExecutorResult = {
  result: unknown;
  content: string;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  toolResults: Array<{ name: string; args: unknown; result: { ok?: boolean; file?: unknown } }>;
};

function buildMessages(context: Context, phase: string, taskState: TaskState) {
  return [
    {
      role: 'system',
      content: [
        '你是一个 AI Coding Agent，负责在工作区中执行编码任务。',
        '你必须优先使用 tools 完成文件读取、写入和命令执行。',
        '不要编造工具执行结果。',
        '当任务需要操作文件或命令时，优先调用工具。',
        '如果是修改已有文件，优先使用 patch_file 做局部修改；只有新建文件、整文件重写或 patch 失败时才使用 write_file。',
        '如果需要先定位目标，可先调用 search_in_workspace。',
        '当任务完成时，用简洁中文总结。',
        `当前阶段：${phase}`,
        `上下文预算：最多包含 ${context.contextBudget?.includedFiles?.length ?? 0} 个文件，最大字符数 ${context.contextBudget?.maxChars ?? 0}。`,
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify(
        {
          prompt: context.prompt,
          selectedFile: context.selectedFile,
          selectedFileContent: context.selectedFileContent,
          workspaceSummary: context.workspaceSummary,
          contextBudget: context.contextBudget,
          phase,
          taskState,
        },
        null,
        2,
      ),
    },
  ];
}

function createTaskState(prompt: string, selectedFile: string | null, context: Context): TaskState {
  return {
    status: 'planning',
    prompt,
    selectedFile,
    phases: [],
    contextBudget: context.contextBudget,
    toolCalls: [],
    toolResults: [],
    summary: '',
  };
}

function recordPhase(taskState: TaskState, phase: string, note = '') {
  taskState.status = phase;
  taskState.phases.push({ phase, note, at: new Date().toISOString() });
}

export function createAgentCore(contextBuilder: { buildForPrompt: (prompt: string, selectedFile?: string | null) => Context }, toolGateway: { mcp: ReturnType<typeof createMcpClient> }, llmClient: LlmClient) {
  const planner = createPlanner();
  const executor = createExecutor(toolGateway);
  const reviewer = createReviewer();
  const summarizer = createSummarizer();

  return {
    async preview(prompt: string, selectedFile: string | null = null, onChunk: ((chunk: unknown) => void) | null = null) {
      const context = contextBuilder.buildForPrompt(prompt, selectedFile);
      const taskState = createTaskState(prompt, selectedFile, context);
      const plan = planner.plan(context);
      recordPhase(taskState, 'planning', '构建上下文并分析需求');

      if (llmClient.model === 'mock') {
        const fallback = '理解需求；构建上下文；生成/修改文件；执行命令验证；回显结果。';
        recordPhase(taskState, 'execution', 'mock 模式直接返回结果');
        const review = reviewer.review({ content: fallback, toolResults: [] });
        recordPhase(taskState, 'review', review.summary);
        taskState.summary = summarizer.summarize({ plan, execution: { content: fallback }, review });
        if (onChunk) onChunk(fallback);
        return createSuccessResponse({ status: 'mocked', output: fallback, context, taskState, plan });
      }

      const messages = buildMessages(context, taskState.status, taskState);
      recordPhase(taskState, 'execution', '开始请求模型并执行工具');
      const { result, content, toolCalls, toolResults } = (await executor.runModel(llmClient, messages, onChunk ?? undefined)) as ExecutorResult;

      taskState.toolCalls.push(...toolCalls);
      taskState.toolResults.push(...toolResults);

      const review = reviewer.review({ content, toolResults });
      recordPhase(taskState, 'review', review.summary);
      taskState.summary = summarizer.summarize({ plan, execution: { content }, review });
      taskState.status = 'done';

      const createdFiles = toolResults
        .filter((item) => item.name === 'write_file' && item.result?.ok)
        .map((item) => item.result?.file);

      return createSuccessResponse({
        status: 'ok',
        model: llmClient.model,
        output: content,
        toolCalls,
        toolResults,
        createdFiles,
        transcript: [{ role: 'assistant', content, toolCalls }],
        raw: result,
        context,
        taskState,
        plan,
        review,
      });
    },

    async writeFile(path: string, content: string) {
      return toolGateway.mcp.callTool('write_file', { path, content });
    },

    async runCommand(command: string) {
      return toolGateway.mcp.callTool('run_command', { command });
    },
  };
}
