import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_PROJECT_ID } from '../shared/index.ts';
import type { Session, SessionMeta, TaskSummary, ChatMessage } from '../shared/types.ts';

export type { Session, TaskSummary, ChatMessage };

export function createSessionStore(options: { projectId?: string } = {}) {
  const projectId = options.projectId ?? DEFAULT_PROJECT_ID;
  const sessionsDir = join(process.cwd(), 'workspaces', projectId, 'sessions');
  const currentFile = join(sessionsDir, 'current.json');
  const memoryFile = join(process.cwd(), 'workspaces', projectId, 'project-memory.md');

  async function ensureDir() {
    await mkdir(sessionsDir, { recursive: true });
  }

  function sessionPath(sessionId: string) {
    return join(sessionsDir, `${sessionId}.json`);
  }

  async function getCurrentSessionId(): Promise<string | null> {
    try {
      const raw = await readFile(currentFile, 'utf8');
      const data = JSON.parse(raw) as { currentSessionId?: string };
      return data.currentSessionId ?? null;
    } catch {
      return null;
    }
  }

  async function setCurrentSessionId(sessionId: string) {
    await ensureDir();
    await writeFile(currentFile, JSON.stringify({ currentSessionId: sessionId }, null, 2), 'utf8');
  }

  async function loadSession(sessionId: string): Promise<Session | null> {
    try {
      const raw = await readFile(sessionPath(sessionId), 'utf8');
      return JSON.parse(raw) as Session;
    } catch {
      return null;
    }
  }

  async function saveSession(session: Session): Promise<Session> {
    await ensureDir();
    const updated: Session = { ...session, updatedAt: new Date().toISOString() };
    await writeFile(sessionPath(session.sessionId), JSON.stringify(updated, null, 2), 'utf8');
    return updated;
  }

  async function createSession(): Promise<Session> {
    const sessionId = `session-${Date.now()}`;
    const session: Session = {
      sessionId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
      taskSummaries: [],
      activeTaskId: null,
    };
    await saveSession(session);
    await setCurrentSessionId(sessionId);
    return session;
  }

  async function getOrCreateCurrentSession(): Promise<Session> {
    const currentId = await getCurrentSessionId();
    if (currentId) {
      const existing = await loadSession(currentId);
      if (existing) return existing;
    }
    return createSession();
  }

  async function appendMessages(sessionId: string, newMessages: ChatMessage[]): Promise<Session> {
    const session = await loadSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    const updated: Session = { ...session, messages: [...session.messages, ...newMessages] };
    if (!updated.title) {
      const firstUser = updated.messages.find((m) => m.role === 'user');
      if (firstUser && typeof firstUser.content === 'string') {
        const text = firstUser.content.trim();
        updated.title = text.length > 30 ? text.slice(0, 30) + '...' : text;
      }
    }
    return saveSession(updated);
  }

  async function appendTaskSummary(sessionId: string, summary: TaskSummary): Promise<Session> {
    const session = await loadSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    return saveSession({ ...session, taskSummaries: [...session.taskSummaries, summary] });
  }

  async function readProjectMemory(): Promise<string> {
    try {
      return await readFile(memoryFile, 'utf8');
    } catch {
      return '';
    }
  }

  async function listSessions(): Promise<Array<{
    sessionId: string;
    createdAt: string;
    updatedAt: string;
    taskCount: number;
    lastMessage: string;
  }>> {
    await ensureDir();
    let files: string[];
    try {
      files = await readdir(sessionsDir) as string[];
    } catch {
      return [];
    }
    const results = await Promise.all(
      files
        .filter((f) => f.endsWith('.json') && f !== 'current.json')
        .map(async (f) => {
          try {
            const raw = await readFile(join(sessionsDir, f), 'utf8');
            const s = JSON.parse(raw) as Session;
            const lastUser = [...s.messages].reverse().find((m) => m.role === 'user');
            const lastMsg = typeof lastUser?.content === 'string' ? lastUser.content : '';
            return {
              sessionId: s.sessionId,
              createdAt: s.createdAt,
              updatedAt: s.updatedAt,
              title: s.title ?? '',
              archived: s.archived ?? false,
              messageCount: s.messages.length,
              taskCount: s.taskSummaries.length,
              lastMessage: lastMsg.slice(0, 60),
            };
          } catch {
            return null;
          }
        }),
    );
    return results
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async function switchSession(sessionId: string): Promise<Session> {
    const session = await loadSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    await setCurrentSessionId(sessionId);
    return session;
  }

  async function deleteSession(sessionId: string): Promise<boolean> {
    try {
      await unlink(sessionPath(sessionId));
      const currentId = await getCurrentSessionId();
      if (currentId === sessionId) {
        await writeFile(currentFile, JSON.stringify({ currentSessionId: null }, null, 2), 'utf8');
      }
      return true;
    } catch {
      return false;
    }
  }

  async function updateSessionMeta(sessionId: string, meta: SessionMeta): Promise<Session> {
    const session = await loadSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (meta.title !== undefined) session.title = meta.title;
    if (meta.archived !== undefined) session.archived = meta.archived;
    return saveSession(session);
  }

  async function searchSessions(query: string): Promise<Array<{
    sessionId: string;
    createdAt: string;
    updatedAt: string;
    title: string;
    archived: boolean;
    messageCount: number;
    taskCount: number;
    lastMessage: string;
  }>> {
    const sessions = await listSessions();
    if (!query.trim()) return sessions;
    const lower = query.toLowerCase();
    return sessions.filter(
      (s) => s.title.toLowerCase().includes(lower) || s.lastMessage.toLowerCase().includes(lower),
    ).slice(0, 20);
  }

  async function exportSession(sessionId: string): Promise<Session> {
    const session = await loadSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    return session;
  }

  return {
    sessionsDir,
    getCurrentSessionId,
    setCurrentSessionId,
    createSession,
    loadSession,
    saveSession,
    getOrCreateCurrentSession,
    appendMessages,
    appendTaskSummary,
    readProjectMemory,
    listSessions,
    switchSession,
    deleteSession,
    updateSessionMeta,
    searchSessions,
    exportSession,
  };
}
