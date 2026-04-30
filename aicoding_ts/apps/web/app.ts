const chatLog = document.querySelector<HTMLElement>('#chatLog')!;
const chatForm = document.querySelector<HTMLFormElement>('#chatForm')!;
const promptInput = document.querySelector<HTMLTextAreaElement>('#promptInput')!;
const fileTree = document.querySelector<HTMLElement>('#fileTree')!;
const editor = document.querySelector<HTMLTextAreaElement>('#editor')!;
const currentFile = document.querySelector<HTMLElement>('#currentFile')!;
const editorSaveBadge = document.querySelector<HTMLElement>('#editorSaveBadge')!;
const summary = document.querySelector<HTMLElement>('#summary')!;
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
};

type AgentStatusState = 'idle' | 'running' | 'waiting_confirm';
type SaveState = 'idle' | 'saved' | 'dirty' | 'saving' | 'error';

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
  } catch (err) {
    setWorkspaceError(`请求失败：${(err as Error).message}`);
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
  const res = await fetch(`/api/file/${encodeURIComponent(path)}`);
  const file = await res.json();
  selectedFile = path;
  currentFile.textContent = path;
  currentFileContent = file.content ?? '';
  editor.value = currentFileContent;
  setSaveState('saved');
}

function updateTreeEmptyState() {
  const emptyState = document.querySelector('#treeEmptyState');
  if (emptyState) emptyState.remove();
}

/**
 * 显示模板选择对话框
 */
async function showTemplateSelectionDialog() {
  return new Promise<{ templateId: string; projectName: string } | null>(async (resolve) => {
    // 获取可用的模板列表
    const response = await fetch('/api/templates');
    const { templates } = await response.json() as { templates: Array<{ id: string; name: string; description: string; category: string }> };

    let dialog = document.querySelector<HTMLElement>('#templateSelectionDialog');
    if (!dialog) {
      dialog = document.createElement('div');
      dialog.id = 'templateSelectionDialog';
      dialog.className = 'tree-dialog-overlay';
      document.body.appendChild(dialog);
    }

    // 按类别分组模板
    const categories: Record<string, typeof templates> = {};
    for (const template of templates) {
      if (!categories[template.category]) {
        categories[template.category] = [];
      }
      categories[template.category].push(template);
    }

    const categoryNames: Record<string, string> = {
      frontend: '前端项目',
      backend: '后端项目',
      fullstack: '全栈项目',
      api: 'API 服务',
      cli: '命令行工具',
    };

    let templateHtml = '<div class="template-list">';
    for (const [category, categoryTemplates] of Object.entries(categories)) {
      templateHtml += `<div class="template-category">
        <h4>${categoryNames[category] || category}</h4>
        <div class="template-grid">`;
      for (const template of categoryTemplates) {
        templateHtml += `
          <button type="button" class="template-card" data-template-id="${template.id}">
            <span class="template-name">${template.name}</span>
            <span class="template-description">${template.description}</span>
          </button>`;
      }
      templateHtml += '</div></div>';
    }
    templateHtml += '</div>';

    dialog.innerHTML = `
      <div class="tree-dialog" style="max-width: 600px; max-height: 70vh; overflow-y: auto;">
        <h3>选择项目模板</h3>
        <p>选择一个模板快速开始新项目</p>
        ${templateHtml}
        <div class="tree-dialog-actions">
          <button type="button" data-role="cancel">取消</button>
        </div>
      </div>
    `;
    dialog.classList.add('visible');

    let selectedTemplate: string | null = null;

    // 处理模板选择
    dialog.querySelectorAll<HTMLButtonElement>('.template-card').forEach((button) => {
      button.addEventListener('click', () => {
        selectedTemplate = button.dataset.templateId || null;
        if (selectedTemplate) {
          // 进入项目名称输入
          showProjectNameInputDialog(selectedTemplate).then((projectName) => {
            dialog!.classList.remove('visible');
            resolve(projectName ? { templateId: selectedTemplate!, projectName } : null);
          });
        }
      });
    });

    // 处理取消
    dialog.querySelector<HTMLButtonElement>('[data-role="cancel"]')!.addEventListener('click', () => {
      dialog!.classList.remove('visible');
      resolve(null);
    });
  });
}

/**
 * 显示项目名称输入对话框
 */
function showProjectNameInputDialog(templateId: string): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let dialog = document.querySelector<HTMLElement>('#projectNameInputDialog');
    if (!dialog) {
      dialog = document.createElement('div');
      dialog.id = 'projectNameInputDialog';
      dialog.className = 'tree-dialog-overlay';
      dialog.innerHTML = `
        <div class="tree-dialog">
          <h3>创建项目</h3>
          <p>请输入项目名称</p>
          <input data-role="input" type="text" placeholder="例如: my-app, my-project" />
          <div class="tree-dialog-actions">
            <button type="button" data-role="cancel">取消</button>
            <button type="button" data-role="confirm">创建</button>
          </div>
        </div>
      `;
      document.body.appendChild(dialog);
    }

    const input = dialog.querySelector<HTMLInputElement>('[data-role="input"]')!;
    input.value = 'my-project';
    dialog.classList.add('visible');
    input.focus();
    input.select();

    const cleanup = () => {
      dialog!.classList.remove('visible');
    };

    const handleConfirm = () => {
      const value = input.value.trim();
      cleanup();
      resolve(value || null);
    };

    const handleCancel = () => {
      cleanup();
      resolve(null);
    };

    dialog.querySelector<HTMLButtonElement>('[data-role="confirm"]')!.onclick = handleConfirm;
    dialog.querySelector<HTMLButtonElement>('[data-role="cancel"]')!.onclick = handleCancel;

    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleConfirm();
      if (e.key === 'Escape') handleCancel();
    });
  });
}

/**
 * 流式生成项目骨架
 */
async function streamGenerateScaffold(projectName: string, templateId: string) {
  const response = await fetch('/api/scaffold/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectName, templateId }),
  });

  if (!response.ok || !response.body) {
    throw new Error('项目生成请求失败');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const assistantMessage = appendMessage('agent', '');
  let finalResult: PreviewResult | null = null;
  let generatedFileCount = 0;

  const updateAssistant = (text: string) => {
    assistantMessage.textContent = text;
    chatLog.scrollTop = chatLog.scrollHeight;
  };

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
          | { type: 'error'; message: string };

        if (event.type === 'chunk') {
          updateAssistant((assistantMessage.textContent || '') + event.chunk);
        } else if (event.type === 'tool') {
          generatedFileCount++;
          updateAssistant(`✓ 已生成 ${generatedFileCount} 个文件...\n\n${event.summary || '正在生成项目'}`);
        } else if (event.type === 'result') {
          finalResult = event.result;
          updateAssistant(`✅ 项目骨架生成完成！\n\n${projectName} 项目已生成 ${generatedFileCount} 个文件。\n\n现在你可以开始编辑文件或继续输入需求来修改项目。`);
          scheduleWorkspaceRefresh(200);
        } else if (event.type === 'error') {
          updateAssistant(`❌ 出错了：${event.message}`);
        }
      } catch (e) {
        console.error('解析事件失败:', e);
        continue;
      }
    }
  }

  return finalResult;
}
  const response = await fetch('/api/agent/preview', {
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
        } else if (event.type === 'error') {
          updateAssistant(`出错了：${event.message}`);
          setAgentStatus('idle');
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
        } else if (event.type === 'confirm_request') {
          setAgentStatus('waiting_confirm');
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
  } catch (error) {
    appendMessage('agent', `请求失败：${(error as Error).message}`);
    setAgentStatus('idle');
  }
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

// 添加模板生成按钮到新建菜单
const newItemMenuElement = newItemMenu;
if (newItemMenuElement) {
  const scaffoldButton = document.createElement('button');
  scaffoldButton.type = 'button';
  scaffoldButton.textContent = '📦 生成项目模板';
  scaffoldButton.style.borderTop = '1px solid #ccc';
  scaffoldButton.style.marginTop = '8px';
  scaffoldButton.style.paddingTop = '8px';
  scaffoldButton.addEventListener('click', async () => {
    hideNewItemMenu();
    const result = await showTemplateSelectionDialog();
    if (result) {
      appendMessage('user', `生成 ${result.projectName} 项目（${result.templateId}）`);
      appendMessage('agent', `正在生成 ${result.projectName} 项目骨架…`);
      try {
        await streamGenerateScaffold(result.projectName, result.templateId);
      } catch (error) {
        appendMessage('agent', `项目生成失败：${(error as Error).message}`);
      }
    }
  });
  newItemMenuElement.appendChild(scaffoldButton);
}

appendMessage('agent', 'MVP 已启动：选择"新建 > 📦 生成项目模板"来快速启动项目，或浏览文件树后输入需求开始。');
