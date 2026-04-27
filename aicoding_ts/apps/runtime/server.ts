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

type RequestContext = {
  path?: string;
  content?: string;
  nextName?: string;
  command?: string;
  prompt?: string;
  selectedFile?: string | null;
};

type WorkspaceFile = {
  path: string;
  content?: string;
};

type WorkspaceTreeResponse = {
  tree: unknown[];
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
const webRoot = join(process.cwd(), 'apps', 'web');
const webDistRoot = join(webRoot, 'dist');

const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function sendJson(res: ServerResponse, statusCode: number, data: unknown) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}

async function parseBody<T>(req: IncomingMessage): Promise<T> {
  let body = '';
  for await (const chunk of req) body += chunk;
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
const agentCore: AgentCore = createAgentCore(contextBuilder, toolGateway, llmClient, sessionStore);

await workspaceManager.loadFromDisk();
await sessionStore.getOrCreateCurrentSession();

// ── 静态文件 ──
async function tryReadStaticFile(pathname: string) {
  const candidates = [join(webDistRoot, pathname), join(webRoot, pathname)];
  for (const candidate of candidates) {
    try {
      return await readFile(candidate);
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
          .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name.startsWith(partial))
          .slice(0, 10)
          .map((e) => join(dir, e.name) + '/');
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
      const updated = (await agentCore.writeFile(parsed.path ?? '', parsed.content ?? '')) as FileUpdateResponse;
      sendJson(res, 200, { ok: true, file: updated.file, tree: updated.tree, action: updated.action });
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
        writeEvent({ type: 'error', message: error instanceof Error ? error.message : 'Unknown error' });
      }

      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // ── 静态文件 ──
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    const content = await tryReadStaticFile(pathname);

    if (content) {
      const type = mimeTypes[extname(pathname)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      res.end(content);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  });

  server.listen(port, () => {
    console.log(`AI Coding Agent Web MVP running at http://localhost:${port}`);
  });
}
