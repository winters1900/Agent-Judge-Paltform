const chatLog = document.querySelector<HTMLElement>('#chatLog')!;
const chatForm = document.querySelector<HTMLFormElement>('#chatForm')!;
const promptInput = document.querySelector<HTMLTextAreaElement>('#promptInput')!;
const fileTree = document.querySelector<HTMLElement>('#fileTree')!;
const editor = document.querySelector<HTMLTextAreaElement>('#editor')!;
const currentFile = document.querySelector<HTMLElement>('#currentFile')!;
const editorSaveBadge = document.querySelector<HTMLElement>('#editorSaveBadge')!;
const summary = document.querySelector<HTMLElement>('#summary')!;
const taskStatusSteps = document.querySelector<HTMLElement>('#taskStatusSteps')!;
const retryLastTaskBtn = document.querySelector<HTMLButtonElement>('#retryLastTaskBtn')!;
const waitingUserPanel = document.querySelector<HTMLElement>('#waitingUserPanel')!;
const waitingUserQuestion = document.querySelector<HTMLElement>('#waitingUserQuestion')!;
const waitingUserActions = document.querySelector<HTMLElement>('#waitingUserActions')!;
const structuredSummary = document.querySelector<HTMLElement>('#structuredSummary')!;
const toggleRawSummaryBtn = document.querySelector<HTMLButtonElement>('#toggleRawSummaryBtn')!;
const refreshBtn = document.querySelector<HTMLButtonElement>('#refreshBtn')!;
const workspaceLayout = document.querySelector<HTMLElement>('#workspaceLayout')!;
const newItemBtn = document.querySelector<HTMLButtonElement>('#newItemBtn')!;
const newItemMenu = document.querySelector<HTMLElement>('#newItemMenu');
const sessionBadge = document.querySelector<HTMLButtonElement>('#sessionBadge')!;
const sessionDropdown = document.querySelector<HTMLElement>('#sessionDropdown')!;
const agentStatusBadge = document.querySelector<HTMLElement>('#agentStatusBadge')!;
const newSessionBtn = document.querySelector<HTMLButtonElement>('#newSessionBtn')!;
const workspacePathInput = document.querySelector<HTMLInputElement>('#workspacePathInput')!;
const workspaceSuggestList = document.querySelector<HTMLUListElement>('#workspaceSuggestList')!;
const loadWorkspaceBtn = document.querySelector<HTMLButtonElement>('#loadWorkspaceBtn')!;;

type WorkspaceNode = {
  id: string;
  name: string;
  type: 'folder' | 'file';
  content?: string;
  children?: WorkspaceNode[];
  path?: string;
};

type ToolEvent = {
  type: 'tool';
  tool: string;
  summary?: string;
  detail?: string;
};

type PreviewResult = {
  output?: string;
  toolResults?: Array<{ name: string; result?: { ok?: boolean; file?: unknown } }>;
  data?: { toolResults?: Array<{ name: string; result?: { ok?: boolean; file?: unknown } }> };
  summary?: string;
  changedFiles?: string[];
  commands?: Array<{ command: string; exitCode?: number; cwd?: string }>;
};

type AgentStatusState = 'idle' | 'running' | 'waiting_confirm';
type SaveState = 'idle' | 'saved' | 'dirty' | 'saving' | 'error';
type UiTaskPhase =
  | 'idle'
  | 'planning'
  | 'context_loading'
  | 'editing'
  | 'validating'
  | 'waiting_user'
  | 'succeeded'
  | 'failed';

let selectedFile: string | null = null;
let currentFileContent = '';
let workspaceCache: WorkspaceNode[] = [];
let currentAutoRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let editorSaveTimer: ReturnType<typeof setTimeout> | null = null;
let expandedFolders = new Set<string>();
let currentSessionId: string | null = null;
let agentStatus: AgentStatusState = 'idle';
let saveState: SaveState = 'idle';
let lastSaveError: string | null = null;
let lastUserPrompt: string | null = null;
let lastTaskPhase: UiTaskPhase = 'idle';
let lastTaskPhaseUpdatedAt = 0;
let lastConfirmRequest: { confirmId: string; question: string; options?: string[] } | null = null;
let showRawSummary = false;

const layoutState = {
  chat: 34,
  editor: 40,
  tree: 26,
};
const layoutLimits = {
  chat: { min: 22, max: 55 },
  editor: { min: 30, max: 60 },
  tree: { min: 18, max: 40 },
};

function loadLayoutState() {
  try {
    const stored = localStorage.getItem('layoutState');
    if (!stored) return;
    const parsed = JSON.parse(stored) as Partial<typeof layoutState>;
    Object.assign(layoutState, parsed);
  } catch {
    // ignore
  }
}

function persistLayoutState() {
  localStorage.setItem('layoutState', JSON.stringify(layoutState));
}

function applyLayoutWidths() {
  workspaceLayout.style.gridTemplateColumns = `${layoutState.chat}% 2px ${layoutState.editor}% 2px ${layoutState.tree}%`;
}

function clampLayoutState() {
  const total = layoutState.chat + layoutState.editor + layoutState.tree;
  const normalized = total === 100 ? layoutState : {
    chat: (layoutState.chat / total) * 100,
    editor: (layoutState.editor / total) * 100,
    tree: (layoutState.tree / total) * 100,
  };
  layoutState.chat = normalized.chat;
  layoutState.editor = normalized.editor;
  layoutState.tree = normalized.tree;
}

function adjustLayout(delta: number, leftPanel: keyof typeof layoutState, rightPanel: keyof typeof layoutState) {
  const totalWidth = workspaceLayout.getBoundingClientRect().width;
  if (!totalWidth) return;
  const deltaPercent = (delta / totalWidth) * 100;

  const nextLeft = layoutState[leftPanel] + deltaPercent;
  const nextRight = layoutState[rightPanel] - deltaPercent;

  const leftLimits = layoutLimits[leftPanel];
  const rightLimits = layoutLimits[rightPanel];

  if (nextLeft < leftLimits.min || nextLeft > leftLimits.max) return;
  if (nextRight < rightLimits.min || nextRight > rightLimits.max) return;

  layoutState[leftPanel] = nextLeft;
  layoutState[rightPanel] = nextRight;
  clampLayoutState();
  applyLayoutWidths();
  persistLayoutState();
}

function initResizers() {
  const resizers = document.querySelectorAll<HTMLElement>('.panel-resizer');
  resizers.forEach((resizer) => {
    const kind = resizer.dataset.resizer;
    let active = false;
    let startX = 0;

    const onMove = (event: MouseEvent) => {
      if (!active) return;
      const delta = event.clientX - startX;
      startX = event.clientX;
      if (kind === 'chat-editor') {
        adjustLayout(delta, 'chat', 'editor');
      } else if (kind === 'editor-tree') {
        adjustLayout(delta, 'editor', 'tree');
      }
    };

    const stop = () => {
      if (!active) return;
      active = false;
      resizer.classList.remove('active');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', stop);
    };

    resizer.addEventListener('mousedown', (event) => {
      event.preventDefault();
      active = true;
      startX = event.clientX;
      resizer.classList.add('active');
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', stop);
    });
  });
}

function loadExpandedFolders() {
  try {
    const stored = localStorage.getItem('expandedFolders');
    if (!stored) return;
    expandedFolders = new Set(JSON.parse(stored) as string[]);
  } catch {
    expandedFolders = new Set();
  }
}

function persistExpandedFolders() {
  localStorage.setItem('expandedFolders', JSON.stringify([...expandedFolders]));
}

function toastHost(): HTMLElement {
  const host = document.querySelector<HTMLElement>('#toastHost');
  if (!host) throw new Error('toastHost not found');
  return host;
}

function showToast(opts: {
  kind: 'info' | 'warn' | 'error';
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  timeoutMs?: number;
}) {
  const host = toastHost();
  const node = document.createElement('div');
  node.className = `toast ${opts.kind}`;
  node.innerHTML = `
    <div>
      <p class="toast-title"></p>
      <p class="toast-msg"></p>
    </div>
    <div class="toast-actions">
      ${opts.actionLabel ? `<button type="button" class="ghost-button toast-action"></button>` : ''}
      <button type="button" class="toast-close" aria-label="关闭">关闭</button>
    </div>
  `;
  (node.querySelector('.toast-title') as HTMLElement).textContent = opts.title;
  (node.querySelector('.toast-msg') as HTMLElement).textContent = opts.message;
  const close = () => node.remove();
  node.querySelector<HTMLButtonElement>('.toast-close')!.addEventListener('click', close);
  const actionBtn = node.querySelector<HTMLButtonElement>('.toast-action');
  if (actionBtn && opts.actionLabel) {
    actionBtn.textContent = opts.actionLabel;
    actionBtn.addEventListener('click', () => {
      try { opts.onAction?.(); } finally { close(); }
    });
  }
  host.appendChild(node);
  const timeout = opts.timeoutMs ?? (opts.kind === 'error' ? 8000 : 4500);
  window.setTimeout(() => {
    if (node.isConnected) close();
  }, timeout);
}

function setSaveState(next: SaveState, detail?: string) {
  saveState = next;
  editorSaveBadge.dataset.state = next;
  const labels: Record<SaveState, string> = {
    idle: '未打开',
    saved: '已保存',
    dirty: '未保存',
    saving: '保存中…',
    error: '保存失败',
  };
  editorSaveBadge.textContent = labels[next];
  if (next === 'idle') {
    editorSaveBadge.title = '未打开文件';
    lastSaveError = null;
  } else if (next === 'error') {
    lastSaveError = detail ?? lastSaveError ?? '未知错误';
    editorSaveBadge.title = lastSaveError;
  } else {
    editorSaveBadge.title = detail ?? editorSaveBadge.textContent ?? '';
    if (next !== 'error') lastSaveError = null;
  }
}

const TASK_PHASES: Array<{ key: UiTaskPhase; label: string }> = [
  { key: 'planning', label: '规划' },
  { key: 'context_loading', label: '加载上下文' },
  { key: 'editing', label: '修改文件' },
  { key: 'validating', label: '验证' },
  { key: 'waiting_user', label: '等待确认' },
  { key: 'succeeded', label: '完成' },
];

function setTaskPhase(phase: UiTaskPhase, detail?: string) {
  lastTaskPhase = phase;
  lastTaskPhaseUpdatedAt = Date.now();
  renderTaskStatusSteps(detail);
  renderWaitingUserPanel();
}

function renderTaskStatusSteps(detail?: string) {
  const phaseIndex = TASK_PHASES.findIndex((p) => p.key === lastTaskPhase);
  taskStatusSteps.innerHTML = '';
  TASK_PHASES.forEach((p, idx) => {
    const pill = document.createElement('span');
    pill.className = 'step-pill';
    pill.textContent = p.label;
    if (lastTaskPhase === 'failed') {
      if (idx === 0) pill.classList.add('error');
    } else if (phaseIndex >= 0) {
      if (idx < phaseIndex) pill.classList.add('done');
      if (idx === phaseIndex) pill.classList.add('active');
    }
    taskStatusSteps.appendChild(pill);
  });
  retryLastTaskBtn.disabled = !lastUserPrompt || agentStatus !== 'idle';
  retryLastTaskBtn.title = lastUserPrompt ? `重试：${lastUserPrompt}` : '暂无可重试任务';
  if (detail) {
    retryLastTaskBtn.title = `${retryLastTaskBtn.title}\n${detail}`;
  }
}

function renderWaitingUserPanel() {
  const visible = lastTaskPhase === 'waiting_user' && !!lastConfirmRequest;
  waitingUserPanel.classList.toggle('hidden', !visible);
  if (!visible) {
    waitingUserQuestion.textContent = '';
    waitingUserActions.innerHTML = '';
    return;
  }

  waitingUserQuestion.textContent = lastConfirmRequest!.question;
  waitingUserActions.innerHTML = '';

  const confirmId = lastConfirmRequest!.confirmId;
  const options = lastConfirmRequest!.options ?? [];

  const submit = async (answer: string) => {
    const trimmed = answer.trim();
    if (!trimmed) {
      showToast({ kind: 'warn', title: '请输入确认内容', message: '回答不能为空。' });
      return;
    }
    try {
      await fetch('/api/agent/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmId, answer: trimmed }),
      });
      showToast({ kind: 'info', title: '已提交确认', message: trimmed });
      lastConfirmRequest = null;
      if (agentStatus === 'waiting_confirm') setAgentStatus('running');
      setTaskPhase('planning', '已提交确认，等待继续执行');
    } catch (err) {
      showToast({ kind: 'error', title: '提交确认失败', message: (err as Error).message });
    }
  };

  if (options.length > 0) {
    options.forEach((opt) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'confirm-option-btn';
      btn.textContent = opt;
      btn.addEventListener('click', () => submit(opt));
      waitingUserActions.appendChild(btn);
    });
    return;
  }

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = '输入你的确认/补充信息…';
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit(input.value);
    }
  });
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'confirm-submit-btn';
  btn.textContent = '提交';
  btn.addEventListener('click', () => submit(input.value));
  waitingUserActions.appendChild(input);
  waitingUserActions.appendChild(btn);
}

function normalizeToolResults(result: PreviewResult | null): Array<{ name: string; ok?: boolean; file?: unknown }> {
  if (!result) return [];
  const raw = result.toolResults ?? result.data?.toolResults ?? [];
  return raw.map((item) => ({
    name: item.name,
    ok: item.result?.ok,
    file: item.result?.file,
  }));
}

function renderStructuredSummary(result: PreviewResult | null) {
  const toolResults = normalizeToolResults(result);

  const changedFiles = new Set<string>();
  for (const t of toolResults) {
    const file = t.file as { path?: string } | undefined;
    if (file?.path) changedFiles.add(file.path);
  }
  (result?.changedFiles ?? []).forEach((p) => changedFiles.add(p));

  const writeOk = toolResults.some((t) => t.name === 'write_file' && t.ok);
  const commandOk = toolResults.some((t) => t.name === 'run_command' && t.ok);
  const hasErrors = lastTaskPhase === 'failed';

  structuredSummary.innerHTML = '';

  const mkRow = (key: string, valueNode: HTMLElement) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'structured-row';
    const k = document.createElement('div');
    k.className = 'structured-key';
    k.textContent = key;
    wrapper.appendChild(k);
    wrapper.appendChild(valueNode);
    structuredSummary.appendChild(wrapper);
  };

  const mkValue = (text: string) => {
    const div = document.createElement('div');
    div.className = 'structured-value';
    div.textContent = text;
    return div;
  };

  const mkTags = (items: Array<{ text: string; kind?: 'ok' | 'warn' | 'err' }>) => {
    const list = document.createElement('div');
    list.className = 'structured-list';
    items.forEach((it) => {
      const tag = document.createElement('span');
      tag.className = `tag${it.kind ? ` ${it.kind}` : ''}`;
      tag.textContent = it.text;
      list.appendChild(tag);
    });
    const outer = document.createElement('div');
    outer.className = 'structured-value';
    outer.appendChild(list);
    return outer;
  };

  if (!result) {
    mkRow('状态', mkValue('暂无摘要（等待任务运行）。'));
    return;
  }

  mkRow('当前阶段', mkValue(lastTaskPhase));
  mkRow('结果概览', mkTags([
    { text: writeOk ? '文件已写入' : '未写入文件', kind: writeOk ? 'ok' : 'warn' },
    { text: commandOk ? '命令已执行' : '未执行命令', kind: commandOk ? 'ok' : 'warn' },
    { text: hasErrors ? '存在错误' : '无错误', kind: hasErrors ? 'err' : 'ok' },
  ]));

  if (changedFiles.size > 0) {
    mkRow('变更文件', mkValue([...changedFiles].join('\n')));
  }

  if (typeof result.summary === 'string' && result.summary.trim()) {
    mkRow('摘要', mkValue(result.summary.trim()));
  } else if (typeof result.output === 'string' && result.output.trim()) {
    mkRow('输出', mkValue(result.output.trim()));
  }

  if (toolResults.length > 0) {
    const brief = toolResults
      .map((t) => `${t.name}${t.ok === undefined ? '' : t.ok ? ' ✅' : ' ❌'}`)
      .join(' / ');
    mkRow('工具调用', mkValue(brief));
  }
}

// ── 工作区历史记录 ──
const WORKSPACE_HISTORY_KEY = 'workspaceHistory';
const WORKSPACE_HISTORY_MAX = 10;

function loadWorkspaceHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(WORKSPACE_HISTORY_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function saveWorkspaceHistory(path: string) {
  const history = loadWorkspaceHistory().filter((p) => p !== path);
  history.unshift(path);
  localStorage.setItem(WORKSPACE_HISTORY_KEY, JSON.stringify(history.slice(0, WORKSPACE_HISTORY_MAX)));
}

// ── 路径补全 ──
let suggestDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function hideSuggestList() {
  workspaceSuggestList.classList.remove('visible');
  workspaceSuggestList.innerHTML = '';
}

function renderSuggestItems(items: Array<{ path: string; isHistory: boolean }>) {
  if (items.length === 0) { hideSuggestList(); return; }
  workspaceSuggestList.innerHTML = '';
  items.forEach(({ path, isHistory }) => {
    const li = document.createElement('li');
    li.textContent = path;
    if (isHistory) li.classList.add('history-item');
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      workspacePathInput.value = path;
      hideSuggestList();
      fetchSuggestions(path).then((suggestions) => {
        const items = suggestions.map((p) => ({ path: p, isHistory: false }));
        renderSuggestItems(items);
      });
    });
    workspaceSuggestList.appendChild(li);
  });
  workspaceSuggestList.classList.add('visible');
}

async function fetchSuggestions(prefix: string): Promise<string[]> {
  try {
    const res = await fetch(`/api/fs/suggest?prefix=${encodeURIComponent(prefix)}`);
    const data = await res.json() as { suggestions?: string[] };
    return data.suggestions ?? [];
  } catch {
    showToast({ kind: 'warn', title: '路径补全失败', message: '无法获取路径建议，请检查后端是否运行。' });
    return [];
  }
}

workspacePathInput.addEventListener('input', () => {
  if (suggestDebounceTimer) clearTimeout(suggestDebounceTimer);
  suggestDebounceTimer = setTimeout(async () => {
    const prefix = workspacePathInput.value.trim();
    if (!prefix) { hideSuggestList(); return; }
    const [fsSuggestions, history] = await Promise.all([
      fetchSuggestions(prefix),
      Promise.resolve(loadWorkspaceHistory().filter((h) => h.startsWith(prefix))),
    ]);
    const seen = new Set<string>();
    const items: Array<{ path: string; isHistory: boolean }> = [];
    for (const p of fsSuggestions) { if (!seen.has(p)) { seen.add(p); items.push({ path: p, isHistory: false }); } }
    for (const p of history) { if (!seen.has(p)) { seen.add(p); items.push({ path: p, isHistory: true }); } }
    renderSuggestItems(items);
  }, 200);
});

workspacePathInput.addEventListener('focus', () => {
  if (workspacePathInput.value.trim()) return;
  const history = loadWorkspaceHistory();
  renderSuggestItems(history.map((p) => ({ path: p, isHistory: true })));
});

workspacePathInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideSuggestList();
  if (e.key === 'Tab') {
    const first = workspaceSuggestList.querySelector('li');
    if (first) {
      e.preventDefault();
      const path = first.textContent ?? '';
      workspacePathInput.value = path;
      hideSuggestList();
      fetchSuggestions(path).then((suggestions) => {
        renderSuggestItems(suggestions.map((p) => ({ path: p, isHistory: false })));
      });
    }
  }
  if (e.key === 'Enter') { e.preventDefault(); loadWorkspaceBtn.click(); }
});

// ── 加载工作区 ──
function setWorkspaceError(msg: string | null) {
  if (msg) {
    workspacePathInput.classList.add('error');
    workspacePathInput.title = msg;
  } else {
    workspacePathInput.classList.remove('error');
    workspacePathInput.title = '';
  }
}

loadWorkspaceBtn.addEventListener('click', async () => {
  const path = workspacePathInput.value.trim();
  if (!path) return;
  hideSuggestList();
  loadWorkspaceBtn.disabled = true;
  loadWorkspaceBtn.textContent = '加载中…';
  setWorkspaceError(null);

  try {
    const res = await fetch('/api/workspace/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    const data = await res.json() as { ok?: boolean; tree?: WorkspaceNode[]; sessionId?: string; error?: string };

    if (!data.ok) {
      setWorkspaceError(data.error ?? '加载失败');
      showToast({ kind: 'error', title: '加载工作区失败', message: data.error ?? '未知错误' });
      return;
    }

    saveWorkspaceHistory(path);
    workspaceCache = data.tree ?? [];
    renderTree(workspaceCache);

    if (data.sessionId) {
      currentSessionId = data.sessionId;
      const shortId = data.sessionId.replace('session-', '').slice(-6);
      sessionBadge.textContent = `会话 #${shortId}`;
    }

    chatLog.innerHTML = '';
    selectedFile = null;
    currentFile.textContent = '未打开文件';
    editor.value = '';
    currentFileContent = '';
    appendMessage('agent', `已加载工作区：${path}`);
    showToast({ kind: 'info', title: '工作区已加载', message: path });
  } catch (err) {
    setWorkspaceError(`请求失败：${(err as Error).message}`);
    showToast({ kind: 'error', title: '加载工作区失败', message: (err as Error).message });
  } finally {
    loadWorkspaceBtn.disabled = false;
    loadWorkspaceBtn.textContent = '加载';
  }
});

function setAgentStatus(status: AgentStatusState) {
  agentStatus = status;
  agentStatusBadge.dataset.status = status;
  const labels: Record<AgentStatusState, string> = {
    idle: '空闲',
    running: '运行中',
    waiting_confirm: '等待确认',
  };
  agentStatusBadge.textContent = labels[status];
  const submitBtn = chatForm.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  submitBtn.disabled = status !== 'idle';
  promptInput.disabled = status !== 'idle';
  renderTaskStatusSteps();
}

function renderMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[^\0]*?<\/li>(\n|$))+/g, (m) => `<ul>${m}</ul>`)
    .replace(/\n/g, '<br>');
}

const TOOL_COLORS: Record<string, string> = {
  write_file: 'var(--accent-2)',
  read_file: 'var(--muted)',
  run_command: '#f59e0b',
  ask_user: '#facc15',
  list_workspace: 'var(--muted)',
};

function appendMessage(role: string, text: string) {
  const div = document.createElement('div');
  div.className = `message ${role}`;
  div.innerHTML = renderMarkdown(text);
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  return div;
}

function renderConfirmCard(event: { confirmId: string; question: string; options?: string[] }) {
  const card = document.createElement('div');
  card.className = 'confirm-card';
  card.dataset.confirmId = event.confirmId;

  const questionEl = document.createElement('p');
  questionEl.className = 'confirm-question';
  questionEl.textContent = event.question;
  card.appendChild(questionEl);

  const actionsEl = document.createElement('div');
  actionsEl.className = 'confirm-actions';

  if (event.options && event.options.length > 0) {
    event.options.forEach((opt) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'confirm-option-btn';
      btn.textContent = opt;
      btn.addEventListener('click', () => submitConfirm(event.confirmId, opt, card));
      actionsEl.appendChild(btn);
    });
  } else {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '输入回答…';
    input.className = 'confirm-input';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'confirm-submit-btn';
    btn.textContent = '提交';
    btn.addEventListener('click', () => submitConfirm(event.confirmId, input.value, card));
    actionsEl.appendChild(input);
    actionsEl.appendChild(btn);
  }

  card.appendChild(actionsEl);
  chatLog.appendChild(card);
  chatLog.scrollTop = chatLog.scrollHeight;
}

async function submitConfirm(confirmId: string, answer: string, card: HTMLElement) {
  try {
    await fetch('/api/agent/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmId, answer }),
    });
    card.classList.add('confirm-resolved');
    const actionsEl = card.querySelector('.confirm-actions');
    if (actionsEl) {
      actionsEl.innerHTML = `<span class="confirm-answer">已回答：${answer}</span>`;
    }
    if (lastConfirmRequest?.confirmId === confirmId) {
      lastConfirmRequest = null;
      renderWaitingUserPanel();
    }
  } catch {
    appendMessage('agent', `提交确认失败`);
  }
}

function isFolder(node: WorkspaceNode) {
  return node.type === 'folder';
}

function ensureContextMenu() {
  let menu = document.querySelector<HTMLElement>('#treeContextMenu');
  if (menu) return menu;

  menu = document.createElement('div');
  menu.id = 'treeContextMenu';
  menu.className = 'tree-context-menu';
  menu.innerHTML = `
    <button type="button" data-action="new-file">新建文件</button>
    <button type="button" data-action="new-folder">新建文件夹</button>
    <button type="button" data-action="rename">重命名</button>
    <button type="button" data-action="delete">删除</button>
  `;
  document.body.appendChild(menu);
  return menu;
}

function hideContextMenu() {
  const menu = document.querySelector<HTMLElement>('#treeContextMenu');
  if (menu) menu.classList.remove('visible');
}

function hideNewItemMenu() {
  if (newItemMenu) {
    newItemMenu.classList.remove('visible');
    newItemMenu.setAttribute('aria-hidden', 'true');
  }
}

function toggleNewItemMenu() {
  if (!newItemMenu) return;
  const visible = newItemMenu.classList.contains('visible');
  if (visible) {
    hideNewItemMenu();
  } else {
    newItemMenu.classList.add('visible');
    newItemMenu.setAttribute('aria-hidden', 'false');
  }
}

function showConfirmDialog({ title, message, confirmLabel = '确认', danger = false }: { title: string; message: string; confirmLabel?: string; danger?: boolean }) {
  return new Promise<boolean>((resolve) => {
    let dialog = document.querySelector<HTMLElement>('#treeConfirmDialog');
    if (!dialog) {
      dialog = document.createElement('div');
      dialog.id = 'treeConfirmDialog';
      dialog.className = 'tree-dialog-overlay';
      dialog.innerHTML = `
        <div class="tree-dialog">
          <h3 data-role="title"></h3>
          <p data-role="message"></p>
          <div class="tree-dialog-actions">
            <button type="button" data-role="cancel">取消</button>
            <button type="button" data-role="confirm"></button>
          </div>
        </div>
      `;
      document.body.appendChild(dialog);
    }

    dialog.querySelector<HTMLElement>('[data-role="title"]')!.textContent = title;
    dialog.querySelector<HTMLElement>('[data-role="message"]')!.textContent = message;
    const confirmBtn = dialog.querySelector<HTMLButtonElement>('[data-role="confirm"]')!;
    confirmBtn.textContent = confirmLabel;
    confirmBtn.classList.toggle('danger', danger);

    const cleanup = () => {
      dialog!.classList.remove('visible');
      confirmBtn.onclick = null;
      dialog!.querySelector<HTMLButtonElement>('[data-role="cancel"]')!.onclick = null;
    };

    dialog.classList.add('visible');

    dialog.querySelector<HTMLButtonElement>('[data-role="cancel"]')!.onclick = () => {
      cleanup();
      resolve(false);
    };

    confirmBtn.onclick = () => {
      cleanup();
      resolve(true);
    };
  });
}

function showRenameDialog(currentPath: string) {
  return new Promise<string | null>((resolve) => {
    let dialog = document.querySelector<HTMLElement>('#treeRenameDialog');
    if (!dialog) {
      dialog = document.createElement('div');
      dialog.id = 'treeRenameDialog';
      dialog.className = 'tree-dialog-overlay';
      dialog.innerHTML = `
        <div class="tree-dialog">
          <h3>重命名</h3>
          <p data-role="message"></p>
          <input data-role="input" type="text" />
          <div class="tree-dialog-actions">
            <button type="button" data-role="cancel">取消</button>
            <button type="button" data-role="confirm">重命名</button>
          </div>
        </div>
      `;
      document.body.appendChild(dialog);
    }

    dialog.querySelector<HTMLElement>('[data-role="message"]')!.textContent = `当前名称：${currentPath}`;
    const input = dialog.querySelector<HTMLInputElement>('[data-role="input"]')!;
    input.value = currentPath.split('/').pop() || currentPath;

    const cleanup = () => {
      dialog!.classList.remove('visible');
      dialog!.querySelector<HTMLButtonElement>('[data-role="confirm"]')!.onclick = null;
      dialog!.querySelector<HTMLButtonElement>('[data-role="cancel"]')!.onclick = null;
    };

    dialog.classList.add('visible');
    input.focus();
    input.select();

    dialog.querySelector<HTMLButtonElement>('[data-role="cancel"]')!.onclick = () => {
      cleanup();
      resolve(null);
    };

    dialog.querySelector<HTMLButtonElement>('[data-role="confirm"]')!.onclick = () => {
      const value = input.value.trim();
      cleanup();
      resolve(value || null);
    };
  });
}

function saveCurrentFile() {
  if (!selectedFile) return;
  const content = editor.value;
  if (content === currentFileContent) {
    if (saveState !== 'saved') setSaveState('saved');
    return;
  }

  if (saveState !== 'saving') setSaveState('dirty');

  if (editorSaveTimer) clearTimeout(editorSaveTimer);
  editorSaveTimer = setTimeout(async () => {
    try {
      setSaveState('saving');
      const res = await fetch('/api/file', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedFile, content: editor.value }),
      });
      const data = await res.json() as { ok?: boolean; tree?: WorkspaceNode[]; error?: string };
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      currentFileContent = editor.value;
      workspaceCache = data.tree || workspaceCache;
      renderTree(workspaceCache);
      scheduleWorkspaceRefresh(0);
      setSaveState('saved');
    } catch (err) {
      setSaveState('error', (err as Error).message);
      appendMessage('agent', `保存失败：${(err as Error).message}`);
    }
  }, 300);
}

function showCreateNameDialog(kind: 'file' | 'folder') {
  return new Promise<string | null>((resolve) => {
    let dialog = document.querySelector<HTMLElement>('#treeCreateNameDialog');
    if (!dialog) {
      dialog = document.createElement('div');
      dialog.id = 'treeCreateNameDialog';
      dialog.className = 'tree-dialog-overlay';
      dialog.innerHTML = `
        <div class="tree-dialog">
          <h3 data-role="title"></h3>
          <p data-role="message"></p>
          <input data-role="input" type="text" />
          <div class="tree-dialog-actions">
            <button type="button" data-role="cancel">取消</button>
            <button type="button" data-role="confirm">确认</button>
          </div>
        </div>
      `;
      document.body.appendChild(dialog);
    }

    dialog.querySelector<HTMLElement>('[data-role="title"]')!.textContent = kind === 'file' ? '新建文件' : '新建文件夹';
    dialog.querySelector<HTMLElement>('[data-role="message"]')!.textContent = kind === 'file' ? '请输入文件名' : '请输入文件夹名';
    const input = dialog.querySelector<HTMLInputElement>('[data-role="input"]')!;
    input.value = '';

    const cleanup = () => {
      dialog!.classList.remove('visible');
      dialog!.querySelector<HTMLButtonElement>('[data-role="confirm"]')!.onclick = null;
      dialog!.querySelector<HTMLButtonElement>('[data-role="cancel"]')!.onclick = null;
    };

    dialog.classList.add('visible');
    input.focus();

    dialog.querySelector<HTMLButtonElement>('[data-role="cancel"]')!.onclick = () => {
      cleanup();
      resolve(null);
    };

    dialog.querySelector<HTMLButtonElement>('[data-role="confirm"]')!.onclick = () => {
      const value = input.value.trim();
      cleanup();
      resolve(value || null);
    };
  });
}

async function createWorkspaceItem(kind: 'file' | 'folder', basePath = '') {
  const name = await showCreateNameDialog(kind);
  if (!name) return;

  if (kind === 'file') {
    const path = basePath ? `${basePath}/${name}` : name;
    const res = await fetch('/api/file', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content: '' }),
    });
    const data = await res.json();
    workspaceCache = data.tree || workspaceCache;
    renderTree(workspaceCache);
    scheduleWorkspaceRefresh(0);
    return;
  }

  const path = basePath ? `${basePath}/${name}` : name;
  const res = await fetch('/api/folder', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  const data = await res.json();
  workspaceCache = data.tree || workspaceCache;
  renderTree(workspaceCache);
  scheduleWorkspaceRefresh(0);
}

async function renameWorkspaceItem(path: string) {
  const nextName = await showRenameDialog(path);
  if (!nextName) return;

  const res = await fetch('/api/item/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, nextName }),
  });
  const data = await res.json();
  workspaceCache = data.tree || workspaceCache;
  if (selectedFile && selectedFile === path) selectedFile = data.to?.path || selectedFile;
  renderTree(workspaceCache);
  scheduleWorkspaceRefresh(0);
}

async function deleteWorkspaceItem(path: string) {
  const confirmed = await showConfirmDialog({
    title: '删除确认',
    message: `确定删除 ${path} 吗？此操作无法撤销。`,
    confirmLabel: '删除',
    danger: true,
  });
  if (!confirmed) return;

  const res = await fetch('/api/item/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  const data = await res.json();
  workspaceCache = data.tree || workspaceCache;
  if (selectedFile === path) {
    selectedFile = null;
    currentFile.textContent = '未打开文件';
    editor.value = '';
    currentFileContent = '';
  }
  renderTree(workspaceCache);
  scheduleWorkspaceRefresh(0);
}

function renderTree(nodes: WorkspaceNode[]) {
  fileTree.innerHTML = '';
  const menu = ensureContextMenu();

  const closeMenuOnScroll = () => hideContextMenu();

  const renderNode = (node: WorkspaceNode, depth = 0, parentPath = '') => {
    const fullPath = parentPath ? `${parentPath}/${node.name}` : node.name;
    const row = document.createElement('div');
    row.className = 'file-item';
    row.style.paddingLeft = `${12 + depth * 16}px`;

    if (isFolder(node)) {
      const expanded = expandedFolders.has(fullPath);
      const arrow = expanded ? '▾' : '▸';
      row.innerHTML = `<span class="tree-arrow">${arrow}</span><span class="tree-icon">${expanded ? '📂' : '📁'}</span><span class="tree-label">${node.name}</span>`;
      row.addEventListener('click', () => {
        if (expandedFolders.has(fullPath)) {
          expandedFolders.delete(fullPath);
        } else {
          expandedFolders.add(fullPath);
        }
        persistExpandedFolders();
        renderTree(workspaceCache);
      });
      row.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        menu.style.left = `${event.clientX}px`;
        menu.style.top = `${event.clientY}px`;
        menu.dataset.basePath = fullPath;
        menu.dataset.targetPath = fullPath;
        menu.dataset.targetType = 'folder';
        menu.classList.add('visible');
      });
      fileTree.appendChild(row);

      if (expanded) {
        (node.children || []).forEach((child) => renderNode(child, depth + 1, fullPath));
      }
      return;
    }

    row.innerHTML = `<span class="tree-arrow tree-arrow-spacer"></span><span class="tree-icon">📄</span><span class="tree-label">${node.name}</span>`;
    row.addEventListener('click', () => openFile(fullPath));
    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      menu.style.left = `${event.clientX}px`;
      menu.style.top = `${event.clientY}px`;
      menu.dataset.basePath = parentPath;
      menu.dataset.targetPath = fullPath;
      menu.dataset.targetType = 'file';
      menu.classList.add('visible');
    });
    fileTree.appendChild(row);
  };

  nodes.forEach((node) => renderNode(node, 0, ''));

  menu.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    button.onclick = async () => {
      const action = button.dataset.action;
      const basePath = menu.dataset.basePath || '';
      const targetPath = menu.dataset.targetPath || '';
      hideContextMenu();

      if (action === 'new-file') {
        await createWorkspaceItem('file', basePath);
      } else if (action === 'new-folder') {
        await createWorkspaceItem('folder', basePath);
      } else if (action === 'rename') {
        await renameWorkspaceItem(targetPath);
      } else if (action === 'delete') {
        await deleteWorkspaceItem(targetPath);
      }
    };
  });

  fileTree.removeEventListener('scroll', closeMenuOnScroll);
  fileTree.addEventListener('scroll', closeMenuOnScroll, { once: true });
}

async function loadWorkspace() {
  const res = await fetch('/api/workspace');
  const data = await res.json();
  workspaceCache = data.tree;
  renderTree(workspaceCache);
  updateTreeEmptyState();
}

function scheduleWorkspaceRefresh(delayMs = 0) {
  if (currentAutoRefreshTimer) clearTimeout(currentAutoRefreshTimer);
  currentAutoRefreshTimer = setTimeout(() => {
    loadWorkspace();
  }, delayMs);
}

async function openFile(path: string) {
  try {
    const res = await fetch(`/api/file/${encodeURIComponent(path)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const file = await res.json() as { content?: string };
    selectedFile = path;
    currentFile.textContent = path;
    currentFileContent = file.content ?? '';
    editor.value = currentFileContent;
    setSaveState('saved');
  } catch (err) {
    showToast({
      kind: 'error',
      title: '打开文件失败',
      message: `${path}\n${(err as Error).message}`,
      actionLabel: '重试',
      onAction: () => openFile(path),
    });
  }
}

function updateTreeEmptyState() {
  const emptyState = document.querySelector('#treeEmptyState');
  if (emptyState) emptyState.remove();
}

async function initSession() {
  try {
    const res = await fetch('/api/session');
    const data = await res.json() as { sessionId: string; taskSummaries?: Array<{ prompt: string; summary: string }> };
    currentSessionId = data.sessionId;
    const shortId = data.sessionId.replace('session-', '').slice(-6);
    sessionBadge.textContent = `会话 #${shortId}`;

    if (data.taskSummaries && data.taskSummaries.length > 0) {
      appendMessage('agent', `恢复会话 — 历史任务 ${data.taskSummaries.length} 条。最近：${data.taskSummaries[data.taskSummaries.length - 1].prompt}`);
    }
  } catch {
    sessionBadge.textContent = '会话加载失败';
    showToast({ kind: 'warn', title: '会话加载失败', message: '无法获取会话信息，后端可能未启动。' });
  }
}

type SessionSummary = {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  taskCount: number;
  lastMessage: string;
};

type FullSession = {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  messages: Array<{ role: string; content?: string | null }>;
  taskSummaries: Array<{ taskId: string; prompt: string; summary: string }>;
};

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

function hideSessionDropdown() {
  sessionDropdown.classList.remove('visible');
  sessionDropdown.setAttribute('aria-hidden', 'true');
}

async function renderSessionDropdown() {
  const res = await fetch('/api/sessions');
  const data = await res.json() as { sessions: SessionSummary[] };
  const sessions = data.sessions;

  sessionDropdown.innerHTML = '';
  if (sessions.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:12px;color:var(--muted);font-size:13px;text-align:center';
    empty.textContent = '暂无历史会话';
    sessionDropdown.appendChild(empty);
  } else {
    sessions.forEach((s) => {
      const shortId = s.sessionId.replace('session-', '').slice(-6);
      const item = document.createElement('div');
      item.className = 'session-item' + (s.sessionId === currentSessionId ? ' active' : '');
      item.innerHTML = `
        <div class="session-item-header">
          <span class="session-item-id">#${shortId}</span>
          <span class="session-item-time">${formatRelativeTime(s.updatedAt)}</span>
        </div>
        ${s.lastMessage ? `<div class="session-item-preview">${s.lastMessage}</div>` : ''}
        <div class="session-item-meta">${s.taskCount} 个任务</div>
      `;
      item.addEventListener('mousedown', async (e) => {
        e.preventDefault();
        hideSessionDropdown();
        if (s.sessionId === currentSessionId) return;
        await switchToSession(s.sessionId);
      });
      sessionDropdown.appendChild(item);
    });
  }
  sessionDropdown.classList.add('visible');
  sessionDropdown.setAttribute('aria-hidden', 'false');
}

async function switchToSession(sessionId: string) {
  const res = await fetch('/api/session/switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });
  if (!res.ok) return;
  const session = await res.json() as FullSession;

  currentSessionId = session.sessionId;
  const shortId = session.sessionId.replace('session-', '').slice(-6);
  sessionBadge.textContent = `会话 #${shortId}`;

  // 还原完整对话
  chatLog.innerHTML = '';
  for (const msg of session.messages) {
    if (msg.role === 'user' && typeof msg.content === 'string') {
      appendMessage('user', msg.content);
    } else if (msg.role === 'assistant' && typeof msg.content === 'string' && msg.content) {
      appendMessage('agent', msg.content);
    }
  }
  if (session.messages.length === 0) {
    appendMessage('agent', `已切换到会话 #${shortId}（空会话）`);
  }
}

async function createNewSession() {
  const confirmed = await showConfirmDialog({
    title: '新建会话',
    message: '新建会话将清空当前聊天记录和任务历史，新会话将从空白状态开始。确定继续？',
    confirmLabel: '新建',
    danger: false,
  });
  if (!confirmed) return;

  const res = await fetch('/api/session', { method: 'POST' });
  const data = await res.json() as { sessionId: string };
  currentSessionId = data.sessionId;
  const shortId = data.sessionId.replace('session-', '').slice(-6);
  sessionBadge.textContent = `会话 #${shortId}`;
  chatLog.innerHTML = '';
  appendMessage('agent', `新会话已创建（#${shortId}）`);
}

async function streamChat(prompt: string) {
  lastUserPrompt = prompt;
  setTaskPhase('planning', '已发送请求，等待 Agent 规划');
  const response = await fetch('/api/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, selectedFile, sessionId: currentSessionId }),
  });

  if (!response.ok || !response.body) {
    throw new Error('流式请求失败');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const assistantMessage = appendMessage('agent', '');
  let finalResult: PreviewResult | null = null;
  let sawWriteFileSuccess = false;
  let currentMessageElement: HTMLElement = assistantMessage;
  let toolCallElement: HTMLElement | null = null;
  let pendingToolDetails = '';

  const ensureToolNode = (toolName?: string) => {
    if (toolCallElement) return toolCallElement;
    toolCallElement = document.createElement('div');
    toolCallElement.className = 'tool-call';
    toolCallElement.dataset.kind = 'tool';
    toolCallElement.dataset.expanded = 'false';
    const color = toolName ? (TOOL_COLORS[toolName] ?? 'var(--muted)') : 'var(--muted)';
    const label = toolName ?? '工具调用';
    toolCallElement.innerHTML = `
      <button type="button" class="tool-call-header">
        <span class="tool-call-arrow">▸</span>
        <span class="tool-call-badge" style="background:${color}20;color:${color};border-color:${color}40">${label}</span>
        <span class="tool-call-title">执行结果</span>
      </button>
      <pre class="tool-call-body"></pre>
    `;
    chatLog.replaceChild(toolCallElement, assistantMessage);
    currentMessageElement = toolCallElement;

    const header = toolCallElement.querySelector<HTMLButtonElement>('.tool-call-header')!;
    const arrow = toolCallElement.querySelector<HTMLElement>('.tool-call-arrow')!;
    const body = toolCallElement.querySelector<HTMLElement>('.tool-call-body')!;
    header.addEventListener('click', () => {
      const expanded = toolCallElement!.dataset.expanded === 'true';
      toolCallElement!.dataset.expanded = expanded ? 'false' : 'true';
      arrow.textContent = expanded ? '▸' : '▾';
      body.style.display = expanded ? 'none' : 'block';
    });
    body.style.display = 'none';
    return toolCallElement;
  };

  const updateAssistant = (text: string) => {
    const body = currentMessageElement.querySelector<HTMLElement>('.tool-call-body');
    if (body) {
      body.innerHTML = renderMarkdown(text);
      body.style.display = 'block';
      currentMessageElement.dataset.expanded = 'true';
      const arrow = currentMessageElement.querySelector<HTMLElement>('.tool-call-arrow');
      if (arrow) arrow.textContent = '▾';
    } else {
      currentMessageElement.innerHTML = renderMarkdown(text);
    }
    chatLog.scrollTop = chatLog.scrollHeight;
  };

  const appendToolDetail = (toolName: string, text: string) => {
    const node = ensureToolNode(toolName);
    const body = node.querySelector<HTMLElement>('.tool-call-body')!;
    pendingToolDetails = pendingToolDetails ? `${pendingToolDetails}\n${text}` : text;
    body.textContent = pendingToolDetails;
  };

  let accumulatedChunks = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';

    for (const part of parts) {
      const line = part.split('\n').find((item) => item.startsWith('data: '));
      if (!line) continue;
      const payload = line.slice(6);
      if (payload === '[DONE]') continue;

      try {
        const event = JSON.parse(payload) as
          | ToolEvent
          | { type: 'chunk'; chunk: string }
          | { type: 'result'; result: PreviewResult }
          | { type: 'error'; message: string }
          | { type: 'session'; sessionId: string }
          | { type: 'task_status'; taskId: string; status: string }
          | { type: 'confirm_request'; confirmId: string; question: string; options?: string[] };

        if (event.type === 'chunk') {
          accumulatedChunks += event.chunk;
          updateAssistant(accumulatedChunks);
        } else if (event.type === 'tool') {
          appendToolDetail(event.tool, `${event.summary || '工具调用结果'}\n\n${event.detail || ''}`);
          if (event.tool === 'write_file') {
            sawWriteFileSuccess = true;
            scheduleWorkspaceRefresh(300);
          }
        } else if (event.type === 'result') {
          finalResult = event.result as PreviewResult;
          setAgentStatus('idle');
          setTaskPhase('succeeded');
          renderStructuredSummary(finalResult);
        } else if (event.type === 'error') {
          updateAssistant(`出错了：${event.message}`);
          setAgentStatus('idle');
          setTaskPhase('failed', event.message);
          renderStructuredSummary(finalResult);
        } else if (event.type === 'session') {
          currentSessionId = event.sessionId;
          const shortId = event.sessionId.replace('session-', '').slice(-6);
          sessionBadge.textContent = `会话 #${shortId}`;
        } else if (event.type === 'task_status') {
          const statusMap: Record<string, AgentStatusState> = {
            planning: 'running',
            executing: 'running',
            summarizing: 'running',
            waiting_confirm: 'waiting_confirm',
            done: 'idle',
            error: 'idle',
          };
          if (statusMap[event.status]) {
            setAgentStatus(statusMap[event.status] as AgentStatusState);
          }
          const phaseMap: Record<string, UiTaskPhase> = {
            planning: 'planning',
            executing: 'editing',
            summarizing: 'validating',
            waiting_confirm: 'waiting_user',
            done: 'succeeded',
            error: 'failed',
          };
          if (phaseMap[event.status]) setTaskPhase(phaseMap[event.status], `状态：${event.status}`);
        } else if (event.type === 'confirm_request') {
          setAgentStatus('waiting_confirm');
          setTaskPhase('waiting_user');
          lastConfirmRequest = { confirmId: event.confirmId, question: event.question, options: event.options };
          renderWaitingUserPanel();
          renderConfirmCard(event);
        }
      } catch {
        continue;
      }
    }
  }

  return finalResult;
}

editor.addEventListener('input', saveCurrentFile);
editor.addEventListener('blur', saveCurrentFile);

promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatForm.requestSubmit();
  }
});

chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const prompt = promptInput.value.trim();
  if (!prompt || agentStatus !== 'idle') return;

  appendMessage('user', prompt);
  promptInput.value = '';
  setAgentStatus('running');

  try {
    const result = await streamChat(prompt);
    summary.textContent = JSON.stringify(result, null, 2);
    renderStructuredSummary(result);
  } catch (error) {
    appendMessage('agent', `请求失败：${(error as Error).message}`);
    setTaskPhase('failed', (error as Error).message);
    renderStructuredSummary(null);
    showToast({
      kind: 'error',
      title: '任务执行失败',
      message: (error as Error).message,
      actionLabel: lastUserPrompt ? '重试' : undefined,
      onAction: () => {
        if (lastUserPrompt) {
          promptInput.value = lastUserPrompt;
          chatForm.requestSubmit();
        }
      },
      timeoutMs: 9000,
    });
    setAgentStatus('idle');
  }
});

retryLastTaskBtn.addEventListener('click', () => {
  if (!lastUserPrompt || agentStatus !== 'idle') return;
  promptInput.value = lastUserPrompt;
  chatForm.requestSubmit();
});

toggleRawSummaryBtn.addEventListener('click', () => {
  showRawSummary = !showRawSummary;
  summary.classList.toggle('hidden', !showRawSummary);
  toggleRawSummaryBtn.textContent = showRawSummary ? '隐藏原始' : '查看原始';
});

newSessionBtn.addEventListener('click', createNewSession);
sessionBadge.addEventListener('click', (e) => {
  e.stopPropagation();
  if (sessionDropdown.classList.contains('visible')) {
    hideSessionDropdown();
  } else {
    renderSessionDropdown();
  }
});
refreshBtn.addEventListener('click', loadWorkspace);
newItemBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  toggleNewItemMenu();
});
newItemMenu?.querySelectorAll<HTMLButtonElement>('button[data-kind]').forEach((button) => {
  button.addEventListener('click', async () => {
    hideNewItemMenu();
    const createKind = button.dataset.kind as 'file' | 'folder';
    await createWorkspaceItem(createKind, '');
  });
});
document.addEventListener('click', () => {
  hideContextMenu();
  hideNewItemMenu();
  hideSuggestList();
  hideSessionDropdown();
});
loadLayoutState();
applyLayoutWidths();
initResizers();
loadExpandedFolders();
loadWorkspace();
initSession();
appendMessage('agent', 'MVP 已启动：你可以先浏览文件树，再输入一个需求开始。');
setTaskPhase('idle');
renderStructuredSummary(null);
summary.classList.add('hidden');
toggleRawSummaryBtn.textContent = '查看原始';
