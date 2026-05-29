import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { createAgentCore } from '../../packages/agent-core/index.ts';
import { createContextBuilder } from '../../packages/context-builder/index.ts';
import { createLlmClient } from '../../packages/llm-client/index.ts';
import { createToolGateway } from '../../packages/tool-gateway/index.ts';
import { createWorkspaceManager } from '../../packages/workspace-manager/index.ts';
import { createSessionStore } from '../../packages/session-store/index.ts';
import type { AgentEvent, PendingConfirm } from '../../packages/shared/types.ts';
import type { McpJsonRpcRequest } from '../../packages/mcp-server/index.ts';
import { createExternalMcpRegistry, type ExternalMcpServerConfig } from '../../packages/mcp-client/index.ts';

type RequestContext = {
  path?: string;
  content?: string;
  nextName?: string;
  command?: string;
  prompt?: string;
  selectedFile?: string | null;
  name?: string;
  description?: string;
  snapshotId?: string;
};

type WorkspaceFile = {
  path: string;
  content?: string;
};

type WorkspaceTreeResponse = {
  tree: unknown[];
};

type VersionListResponse = {
  versions: unknown[];
};

type FileUpdateResponse = {
  ok: true;
  file: WorkspaceFile;
  tree: unknown[];
  action: string;
};

type ChatPayload = {
  prompt?: string;
  selectedFile?: string | null;
  sessionId?: string;
};

type ConfirmPayload = {
  confirmId?: string;
  answer?: string;
};

type ToolGateway = ReturnType<typeof createToolGateway>;
type WorkspaceManager = ReturnType<typeof createWorkspaceManager>;
type AgentCore = ReturnType<typeof createAgentCore>;
type SessionStore = ReturnType<typeof createSessionStore>;

const CONFIRM_TIMEOUT_MS = 5 * 60 * 1000;

const port = Number(process.env.PORT || 3000);
const webRoot = join(process.cwd(), "apps", "web");
const webDistRoot = join(webRoot, "dist");

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function sendJson(res: ServerResponse, statusCode: number, data: unknown) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(data, null, 2));
}

async function parseBody<T>(req: IncomingMessage): Promise<T> {
  let body = '';
  await new Promise<void>((resolve, reject) => {
    req.on("data", (chunk) => {
      body += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });
    req.on("end", () => resolve());
    req.on("error", (error) => reject(error));
  });
  return (body ? JSON.parse(body) : {}) as T;
}

// ── 挂起确认表（内存）──
const pendingConfirms = new Map<string, PendingConfirm>();

function createConfirmHook(
  sessionId: string,
  taskId: string,
  onEvent: (event: AgentEvent) => void,
) {
  return async (question: string, options?: string[]): Promise<string> => {
    const confirmId = `confirm-${Date.now()}`;

    return new Promise<string>((resolve, reject) => {
      const pending: PendingConfirm = {
        confirmId,
        taskId,
        sessionId,
        question,
        options,
        createdAt: Date.now(),
        resolve,
        reject,
      };
      pendingConfirms.set(confirmId, pending);

      onEvent({ type: 'confirm_request', taskId, confirmId, question, options });

      setTimeout(() => {
        if (pendingConfirms.has(confirmId)) {
          pendingConfirms.delete(confirmId);
          reject(new Error(`确认请求超时：${confirmId}`));
        }
      }, CONFIRM_TIMEOUT_MS);
    });
  };
}

// ── 模块级初始化 ──
const workspaceManager: WorkspaceManager = createWorkspaceManager({
  rootDir: process.env.WORKSPACE_DIR,
});
const toolGateway: ToolGateway = createToolGateway(workspaceManager);
const contextBuilder = createContextBuilder(toolGateway);
const llmClient = createLlmClient();
const sessionStore: SessionStore = createSessionStore();
const externalMcpConfigs: ExternalMcpServerConfig[] = (() => {
  const raw = process.env.EXTERNAL_MCP_SERVERS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as ExternalMcpServerConfig[] : [];
  } catch {
    return [];
  }
})();
const externalMcpRegistry = createExternalMcpRegistry(externalMcpConfigs);
const agentCore: AgentCore = createAgentCore(contextBuilder, toolGateway, llmClient, sessionStore, externalMcpRegistry);

await workspaceManager.loadFromDisk();
await sessionStore.getOrCreateCurrentSession();

// ── 静态文件 ──
async function tryReadStaticFile(pathname: string) {
  const candidates = [join(webDistRoot, pathname), join(webRoot, pathname)];
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, 'utf8');
    } catch {
      continue;
    }
  }
  return null;
}

function isWorkspaceFile(value: unknown): value is WorkspaceFile {
  if (!value || typeof value !== 'object') return false;
  return typeof (value as Partial<WorkspaceFile>).path === 'string';
}

function isAgentEvent(value: unknown): value is AgentEvent {
  if (!value || typeof value !== 'object') return false;
  return 'type' in value;
}

function sseHeaders() {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  };
}

export function startRuntimeServer() {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    if (url.pathname === '/api/external-mcp/tools' && req.method === 'GET') {
      try {
        sendJson(res, 200, { tools: await externalMcpRegistry.listTools() });
      } catch (error: unknown) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : 'Unknown error' });
      }
      return;
    }

    // ── MCP 端点 ──
    if (url.pathname === '/mcp' && req.method === 'GET') {
      res.writeHead(200, sseHeaders());
      res.write(`event: ready\n`);
      res.write(`data: ${JSON.stringify({ ok: true, serverInfo: { name: 'ai-coding-agent-mcp', version: '0.1.0' } })}\n\n`);
      return;
    }

    if (url.pathname === '/mcp' && req.method === 'POST') {
      const parsed = await parseBody<McpJsonRpcRequest>(req);
      const response = await toolGateway.mcp.jsonRpc(parsed);
      if (response === null) {
        res.writeHead(204);
        res.end();
        return;
      }
      sendJson(res, 200, response);
      return;
    }

    // ── GET /api/meta ──
    if (url.pathname === '/api/meta') {
      const session = await sessionStore.getOrCreateCurrentSession();
      sendJson(res, 200, {
        appName: 'AI Coding Agent Web MVP',
        llmEnabled: llmClient.model !== 'mock',
        provider: llmClient.model === 'mock' ? 'mock' : (process.env.LLM_PROVIDER || 'openai-compat'),
        sessionId: session.sessionId,
      });
      return;
    }

    // ── GET /api/session ──
    if (url.pathname === '/api/session' && req.method === 'GET') {
      const session = await sessionStore.getOrCreateCurrentSession();
      sendJson(res, 200, {
        sessionId: session.sessionId,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.messages.length,
        taskSummaries: session.taskSummaries,
        activeTaskId: session.activeTaskId,
      });
      return;
    }

    // ── POST /api/session（新建会话）──
    if (url.pathname === '/api/session' && req.method === 'POST') {
      const newSession = await sessionStore.createSession();
      sendJson(res, 200, {
        sessionId: newSession.sessionId,
        createdAt: newSession.createdAt,
        isNew: true,
      });
      return;
    }

    // ── GET /api/sessions（历史会话列表）──
    if (url.pathname === '/api/sessions' && req.method === 'GET') {
      const sessions = await sessionStore.listSessions();
      sendJson(res, 200, { sessions });
      return;
    }

    // ── POST /api/session/switch（切换会话）──
    if (url.pathname === '/api/session/switch' && req.method === 'POST') {
      const { sessionId } = await parseBody<{ sessionId?: string }>(req);
      if (!sessionId) { sendJson(res, 400, { error: 'sessionId is required' }); return; }
      try {
        const session = await sessionStore.switchSession(sessionId);
        sendJson(res, 200, {
          sessionId: session.sessionId,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          messages: session.messages,
          taskSummaries: session.taskSummaries,
        });
      } catch (err) {
        sendJson(res, 404, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    // ── DELETE /api/session/:id ──
    if (url.pathname.startsWith('/api/session/') && !url.pathname.includes('/export') && req.method === 'DELETE') {
      const sessionId = decodeURIComponent(url.pathname.replace('/api/session/', ''));
      const ok = await sessionStore.deleteSession(sessionId);
      sendJson(res, ok ? 200 : 404, ok ? { ok: true, sessionId } : { error: 'Session not found' });
      return;
    }

    // ── PATCH /api/session/:id ──
    if (url.pathname.startsWith('/api/session/') && !url.pathname.includes('/export') && req.method === 'PATCH') {
      const sessionId = decodeURIComponent(url.pathname.replace('/api/session/', ''));
      const meta = await parseBody<{ title?: string; archived?: boolean }>(req);
      try {
        const updated = await sessionStore.updateSessionMeta(sessionId, meta);
        sendJson(res, 200, updated);
      } catch (err) {
        sendJson(res, 404, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    // ── GET /api/session/:id/export ──
    if (url.pathname.startsWith('/api/session/') && url.pathname.endsWith('/export') && req.method === 'GET') {
      const sessionId = decodeURIComponent(url.pathname.replace('/api/session/', '').replace('/export', ''));
      try {
        const session = await sessionStore.exportSession(sessionId);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${sessionId}.json"`,
        });
        res.end(JSON.stringify(session, null, 2));
      } catch (err) {
        sendJson(res, 404, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    // ── GET /api/sessions/search ──
    if (url.pathname === '/api/sessions/search' && req.method === 'GET') {
      const query = url.searchParams.get('q') ?? '';
      const results = await sessionStore.searchSessions(query);
      sendJson(res, 200, { sessions: results });
      return;
    }

    // ── POST /api/workspace/load（切换工作区目录）──
    if (url.pathname === '/api/workspace/load' && req.method === 'POST') {
      const { path: dirPath } = await parseBody<{ path?: string }>(req);
      if (!dirPath) {
        sendJson(res, 400, { error: 'path is required' });
        return;
      }
      try {
        const tree = await workspaceManager.switchRoot(dirPath);
        const newSession = await sessionStore.createSession();
        sendJson(res, 200, {
          ok: true,
          rootDir: workspaceManager.getRootDir(),
          tree,
          sessionId: newSession.sessionId,
        });
      } catch (err) {
        sendJson(res, 400, { error: `无法加载路径：${err instanceof Error ? err.message : String(err)}` });
      }
      return;
    }

    // ── GET /api/fs/suggest（路径补全）──
    if (url.pathname === '/api/fs/suggest' && req.method === 'GET') {
      const prefix = url.searchParams.get('prefix') ?? '';
      try {
        const endsWithSep = prefix.endsWith('/');
        const dir = endsWithSep ? prefix : (dirname(prefix) || '/');
        const partial = endsWithSep ? '' : prefix.slice(dir.endsWith('/') ? dir.length : dir.length + 1);
        const entries = await readdir(dir, { withFileTypes: true });
        const suggestions = entries
          .filter((entry): entry is { name: string; isDirectory: () => boolean } => {
            return typeof entry !== 'string' && entry.isDirectory() && !entry.name.startsWith('.') && entry.name.startsWith(partial);
          })
          .slice(0, 10)
          .map((entry) => join(dir, entry.name) + '/');
        sendJson(res, 200, { suggestions });
      } catch {
        sendJson(res, 200, { suggestions: [] });
      }
      return;
    }

    // ── GET /api/workspace ──
    if (url.pathname === '/api/workspace') {
      const treeResponse: WorkspaceTreeResponse = { tree: workspaceManager.listTree() };
      sendJson(res, 200, treeResponse);
      return;
    }

    if (url.pathname === '/api/versions' && req.method === 'GET') {
      const versionsResponse: VersionListResponse = { versions: await workspaceManager.listVersions() };
      sendJson(res, 200, versionsResponse);
      return;
    }

    // ── MCP tool/resource/prompt 辅助路由 ──
    if (url.pathname === '/api/mcp/tools') {
      sendJson(res, 200, toolGateway.mcp.listTools());
      return;
    }

      if (url.pathname === "/api/mcp/resources") {
        sendJson(res, 200, toolGateway.mcp.listResources());
        return;
      }

      if (url.pathname === "/api/mcp/prompts") {
        sendJson(res, 200, toolGateway.mcp.listPrompts());
        return;
      }

      if (url.pathname.startsWith("/api/mcp/tool/") && req.method === "POST") {
        const name = decodeURIComponent(
          url.pathname.replace("/api/mcp/tool/", ""),
        );
        const parsed = await parseBody<RequestContext>(req);
        const result = await toolGateway.mcp.callTool(
          name,
          parsed as Record<string, unknown>,
        );
        sendJson(res, result.success ? 200 : 400, result);
        return;
      }

      if (
        url.pathname.startsWith("/api/mcp/resource/") &&
        req.method === "GET"
      ) {
        const name = decodeURIComponent(
          url.pathname.replace("/api/mcp/resource/", ""),
        );
        const result = await toolGateway.mcp.readResource(name);
        sendJson(res, result.success ? 200 : 404, result);
        return;
      }

      if (
        url.pathname.startsWith("/api/mcp/prompt/") &&
        req.method === "POST"
      ) {
        const name = decodeURIComponent(
          url.pathname.replace("/api/mcp/prompt/", ""),
        );
        const parsed = await parseBody<RequestContext>(req);
        const result = await toolGateway.mcp.getPrompt(
          name,
          parsed as Record<string, unknown>,
        );
        sendJson(res, result.success ? 200 : 400, result);
        return;
      }

    // ── GET /api/tools ──
    if (url.pathname === '/api/tools' && req.method === 'GET') {
      sendJson(res, 200, { tools: toolGateway.registry.getAllToolInfos() });
      return;
    }

    // ── POST /api/tools/:name/test ──
    if (url.pathname.startsWith('/api/tools/') && url.pathname.endsWith('/test') && req.method === 'POST') {
      const toolName = decodeURIComponent(url.pathname.replace('/api/tools/', '').replace('/test', ''));
      const args = await parseBody<Record<string, unknown>>(req);
      try {
        const result = await toolGateway.registry.testTool(toolName, args);
        sendJson(res, 200, { tool: toolName, result });
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    // ── PATCH /api/tools/:name ──
    if (url.pathname.startsWith('/api/tools/') && req.method === 'PATCH') {
      const toolName = decodeURIComponent(url.pathname.replace('/api/tools/', ''));
      const { enabled } = await parseBody<{ enabled?: boolean }>(req);
      if (typeof enabled !== 'boolean') { sendJson(res, 400, { error: 'enabled field required' }); return; }
      const ok = toolGateway.registry.setToolEnabled(toolName, enabled);
      sendJson(res, ok ? 200 : 404, ok ? { ok: true, name: toolName, enabled } : { error: 'Tool not found' });
      return;
    }

    // ── GET /api/file/:path ──
    if (url.pathname.startsWith('/api/file/') && req.method === 'GET') {
      const filePath = decodeURIComponent(url.pathname.replace('/api/file/', ''));
      const absPath = join(workspaceManager.getRootDir(), filePath);
      try {
        const content = await readFile(absPath, 'utf8');
        sendJson(res, 200, { path: filePath, content });
      } catch {
        sendJson(res, 404, { error: 'File not found' });
      }
      return;
    }

    // ── PUT /api/file ──
    if (url.pathname === '/api/file' && req.method === 'PUT') {
      const parsed = await parseBody<RequestContext>(req);
      const updated = await toolGateway.mcp.callTool('write_file', {
        path: parsed.path ?? '',
        content: parsed.content ?? '',
      });

        if (
          !updated.success ||
          !updated.data ||
          typeof updated.data !== "object"
        ) {
          sendJson(res, 400, updated);
          return;
        }

        sendJson(res, 200, {
          ok: true,
          ...(updated.data as Record<string, unknown>),
        });
        return;
      }

      if (url.pathname === "/api/folder" && req.method === "PUT") {
        const parsed = await parseBody<RequestContext>(req);
        const created = await workspaceManager.createFolder(parsed.path ?? "");
        sendJson(res, 200, created);
        return;
      }

    // ── PUT /api/folder ──
    if (url.pathname === '/api/folder' && req.method === 'PUT') {
      const parsed = await parseBody<RequestContext>(req);
      const created = await workspaceManager.createFolder(parsed.path ?? '');
      sendJson(res, 200, created);
      return;
    }

    // ── POST /api/item/rename ──
    if (url.pathname === '/api/item/rename' && req.method === 'POST') {
      const parsed = await parseBody<RequestContext>(req);
      const renamed = await workspaceManager.renameItem(parsed.path ?? '', parsed.nextName ?? '');
      sendJson(res, 200, renamed);
      return;
    }

    // ── POST /api/item/delete ──
    if (url.pathname === '/api/item/delete' && req.method === 'POST') {
      const parsed = await parseBody<RequestContext>(req);
      const deleted = await workspaceManager.deleteItem(parsed.path ?? '');
      sendJson(res, 200, deleted);
      return;
    }

    // ── POST /api/tool/run ──
    if (url.pathname === '/api/tool/run' && req.method === 'POST') {
      const parsed = await parseBody<RequestContext>(req);
      const result = await agentCore.runCommand(parsed.command ?? '');
      sendJson(res, 200, result);
      return;
    }

    if (url.pathname === '/api/version/snapshot' && req.method === 'POST') {
      const parsed = await parseBody<RequestContext>(req);
      try {
        const result = await workspaceManager.createSnapshot(parsed.name ?? '', parsed.description ?? '');
        sendJson(res, 200, result);
      } catch (error: unknown) {
        sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : 'Failed to create snapshot' });
      }
      return;
    }

    if (url.pathname === '/api/version/restore' && req.method === 'POST') {
      const parsed = await parseBody<RequestContext>(req);
      try {
        const result = await workspaceManager.restoreSnapshot(parsed.snapshotId ?? '');
        sendJson(res, 200, result);
      } catch (error: unknown) {
        sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : 'Failed to restore snapshot' });
      }
      return;
    }

    // ── POST /api/agent/chat（主要 agent 接口，SSE）──
    if (url.pathname === '/api/agent/chat' && req.method === 'POST') {
      const { prompt, selectedFile, sessionId: reqSessionId } = await parseBody<ChatPayload>(req);

      const session = reqSessionId
        ? (await sessionStore.loadSession(reqSessionId) ?? await sessionStore.getOrCreateCurrentSession())
        : await sessionStore.getOrCreateCurrentSession();

      res.writeHead(200, sseHeaders());

      const writeEvent = (event: AgentEvent) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      writeEvent({ type: 'session', sessionId: session.sessionId, isNew: false });

      const taskId = `task-${Date.now()}`;
      const confirmHook = createConfirmHook(session.sessionId, taskId, writeEvent);

      try {
        await agentCore.runTask(
          session.sessionId,
          prompt ?? '',
          selectedFile ?? null,
          writeEvent,
          confirmHook,
        );
      } catch (error: unknown) {
        writeEvent({ type: 'error', message: error instanceof Error ? error.message : 'Unknown error' });
      }

      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // ── POST /api/agent/confirm ──
    if (url.pathname === '/api/agent/confirm' && req.method === 'POST') {
      const { confirmId, answer } = await parseBody<ConfirmPayload>(req);
      if (!confirmId) {
        sendJson(res, 400, { error: 'confirmId is required' });
        return;
      }
      const pending = pendingConfirms.get(confirmId);
      if (!pending) {
        sendJson(res, 404, { error: 'Confirm request not found or expired' });
        return;
      }
      pendingConfirms.delete(confirmId);
      pending.resolve(answer ?? '');
      sendJson(res, 200, { ok: true });
      return;
    }

    // ── POST /api/agent/preview（向后兼容）──
    if (url.pathname === '/api/agent/preview' && req.method === 'POST') {
      const parsed = await parseBody<ChatPayload>(req);

      res.writeHead(200, sseHeaders());

      const writeEvent = (event: AgentEvent) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      try {
        const result = await agentCore.preview(parsed.prompt ?? '', parsed.selectedFile ?? null, (chunk) => {
          if (typeof chunk === 'string') {
            writeEvent({ type: 'chunk', chunk });
            return;
          }
          if (isAgentEvent(chunk)) writeEvent(chunk);
        });

        writeEvent({ type: 'result', result });
      } catch (error: unknown) {
        writeEvent({
          type: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // ── 项目模板列表 / 详情 ──
    if (url.pathname === '/api/templates' && req.method === 'GET') {
      const templates = agentCore.getTemplates();
      sendJson(res, 200, { templates });
      return;
    }

    if (
      url.pathname.startsWith('/api/templates/category/') &&
      req.method === 'GET'
    ) {
      const category = decodeURIComponent(
        url.pathname.replace('/api/templates/category/', ''),
      );
      const templates = agentCore.getTemplatesByCategory(category);
      sendJson(res, 200, { category, templates });
      return;
    }

    if (url.pathname.startsWith('/api/templates/') && req.method === 'GET') {
      const templateId = decodeURIComponent(
        url.pathname.replace('/api/templates/', ''),
      );
      const template = agentCore.getTemplateDetail(templateId);
      if (!template) {
        sendJson(res, 404, { error: '模板不存在' });
        return;
      }
      sendJson(res, 200, template);
      return;
    }

    // ── 按模板生成项目骨架（SSE）──
    if (url.pathname === '/api/scaffold/generate' && req.method === 'POST') {
      const parsed = await parseBody<{
        projectName?: string;
        templateId?: string;
        author?: string;
        description?: string;
      }>(req);

      res.writeHead(200, sseHeaders());

      const writeEvent = (event: unknown) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      try {
        const projectParams = {
          projectName: parsed.projectName ?? 'my-project',
          templateId: parsed.templateId ?? 'vite-react-ts',
          author: parsed.author,
          description: parsed.description,
        };
        const result = await agentCore.generateScaffold(projectParams, writeEvent);
        writeEvent({ type: 'result', result });
      } catch (error: unknown) {
        writeEvent({
          type: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const content = await tryReadStaticFile(pathname);

    if (content) {
      const type = mimeTypes[extname(pathname)] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": type });
      res.end(content);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  });

  server.listen(port, () => {
    console.log(`AI Coding Agent Web MVP running at http://localhost:${port}`);
  });
}
