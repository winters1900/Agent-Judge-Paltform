import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { TreeNode, WorkspaceFile } from '../workspace-manager/index.ts';
import { createMcpServer, type McpServer } from '../mcp-server/index.ts';

type WorkspaceManager = {
  rootDir: string;
  projectId: string;
  getRootDir: () => string;
  findFile: (path: string) => WorkspaceFile | null;
  updateFile: (path: string, content: string) => Promise<unknown>;
  listTree: () => TreeNode[];
  listFiles: () => WorkspaceFile[];
  searchInWorkspace: (query: string, path?: string) => unknown[];
  patchFile: (path: string, patch: string) => Promise<unknown> | unknown;
  loadFromDisk: () => Promise<unknown>;
};

function splitCommand(command: string): string[] {
  const parts = command.trim().split(/\s+/);
  return [parts[0], ...parts.slice(1)].filter(Boolean);
}

function buildInputSchema(properties: Record<string, unknown>, required: string[] = []) {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

function buildToolDefinitions(workspaceManager: WorkspaceManager) {
  return [
    {
      name: 'read_file',
      description: '读取工作区中的文件内容',
      inputSchema: buildInputSchema({ path: { type: 'string', minLength: 1 } }, ['path']),
      handler: async ({ path }: Record<string, unknown>) => {
        const rootDir = workspaceManager.getRootDir();
        const absPath = resolve(join(rootDir, String(path ?? '')));
        if (!absPath.startsWith(resolve(rootDir))) return null;
        try {
          const content = await readFile(absPath, 'utf8');
          return { path, content };
        } catch {
          return null;
        }
      },
    },
    {
      name: 'write_file',
      description: '写入工作区中的文件内容',
      inputSchema: buildInputSchema(
        {
          path: { type: 'string', minLength: 1 },
          content: { type: 'string' },
        },
        ['path', 'content'],
      ),
      handler: ({ path, content }: Record<string, unknown>) => workspaceManager.updateFile(String(path ?? ''), String(content ?? '')),
    },
    {
      name: 'patch_file',
      description: '根据局部补丁修改工作区中的文件',
      inputSchema: buildInputSchema(
        {
          path: { type: 'string', minLength: 1 },
          patch: { type: 'string', minLength: 1 },
        },
        ['path', 'patch'],
      ),
      handler: ({ path, patch }: Record<string, unknown>) => workspaceManager.patchFile(String(path ?? ''), String(patch ?? '')),
    },
    {
      name: 'search_in_workspace',
      description: '在工作区中搜索文本或代码片段',
      inputSchema: buildInputSchema(
        {
          query: { type: 'string', minLength: 1 },
          path: { type: 'string' },
          limit: { type: 'number', minimum: 1, maximum: 100 },
        },
        ['query'],
      ),
      handler: ({ query, path, limit }: Record<string, unknown>) => {
        const hits = workspaceManager.searchInWorkspace(String(query ?? ''), path ? String(path) : undefined);
        const max = typeof limit === 'number' ? Math.max(1, Math.min(100, Math.floor(limit))) : hits.length;
        return hits.slice(0, max);
      },
    },
    {
      name: 'run_command',
      description: '在工作区目录中执行命令',
      inputSchema: buildInputSchema(
        {
          command: { type: 'string', minLength: 1 },
        },
        ['command'],
      ),
      handler: async ({ command }: Record<string, unknown>) => {
        return new Promise((resolve) => {
          const [cmd, ...args] = splitCommand(String(command ?? ''));
          execFile(cmd, args, { cwd: workspaceManager.getRootDir() }, (error: unknown, stdout: string, stderr: string) => {
            resolve({
              command,
              status: error ? 'failed' : 'success',
              code: error && typeof error === 'object' && 'code' in error ? Number((error as { code?: number }).code ?? 0) : 0,
              stdout: stdout.trim(),
              stderr: stderr.trim(),
            });
          });
        });
      },
    },
    {
      name: 'list_workspace',
      description: '列出当前工作区文件树',
      inputSchema: buildInputSchema(
        {
          depth: { type: 'number', minimum: 1, maximum: 20 },
        },
        [],
      ),
      handler: ({ depth }: Record<string, unknown>) => {
        const tree = workspaceManager.listTree();
        if (typeof depth !== 'number') return tree;
        const maxDepth = Math.max(1, Math.min(20, Math.floor(depth)));
        const trim = (nodes: TreeNode[], currentDepth = 1): TreeNode[] =>
          nodes.map((node) =>
            node.type === 'folder'
              ? { ...node, children: currentDepth >= maxDepth ? [] : trim(node.children ?? [], currentDepth + 1) }
              : node,
          );
        return trim(tree);
      },
    },
  ];
}

function buildResourceDefinitions(workspaceManager: WorkspaceManager) {
  return [
    {
      name: 'workspace_tree',
      description: '当前工作区文件树',
      uri: 'mcp://workspace/tree',
      mimeType: 'application/json',
      handler: () => workspaceManager.listTree(),
    },
    {
      name: 'workspace_files',
      description: '当前工作区文件列表',
      uri: 'mcp://workspace/files',
      mimeType: 'application/json',
      handler: () => workspaceManager.listFiles(),
    },
    {
      name: 'workspace_meta',
      description: '工作区元信息',
      uri: 'mcp://workspace/meta',
      mimeType: 'application/json',
      handler: () => ({ projectId: workspaceManager.projectId, rootDir: workspaceManager.getRootDir() }),
    },
  ];
}

function buildPromptDefinitions() {
  return [
    {
      name: 'patch_file_prompt',
      description: '生成局部补丁的提示词模板',
      inputSchema: buildInputSchema(
        {
          filePath: { type: 'string', minLength: 1 },
          before: { type: 'string', minLength: 1 },
          after: { type: 'string', minLength: 1 },
        },
        ['filePath', 'before', 'after'],
      ),
      handler: ({ filePath, before, after }: Record<string, unknown>) => ({
        messages: [
          {
            role: 'system',
            content: '你是代码补丁助手，只输出可直接用于 patch_file 的内容。',
          },
          {
            role: 'user',
            content: JSON.stringify({ filePath, before, after }, null, 2),
          },
        ],
      }),
    },
  ];
}

export function createToolGateway(workspaceManager: WorkspaceManager) {
  const mcpServer: McpServer = createMcpServer({
    tools: buildToolDefinitions(workspaceManager),
    resources: buildResourceDefinitions(workspaceManager),
    prompts: buildPromptDefinitions(),
  });

  return {
    async readFile(path: string): Promise<WorkspaceFile | null> {
      const rootDir = workspaceManager.getRootDir();
      const absPath = resolve(join(rootDir, path));
      if (!absPath.startsWith(resolve(rootDir))) return null;
      try {
        const content = await readFile(absPath, 'utf8');
        return { path, content };
      } catch {
        return null;
      }
    },
    async writeFile(path: string, content: string) {
      return workspaceManager.updateFile(path, content);
    },
    listWorkspace(): WorkspaceFile[] {
      return workspaceManager.listFiles();
    },
    searchInWorkspace(query: string, path?: string) {
      return workspaceManager.searchInWorkspace(query, path);
    },
    patchFile(path: string, patch: string) {
      return workspaceManager.patchFile(path, patch);
    },
    async runCommand(command: string) {
      return new Promise((resolve) => {
        const [cmd, ...args] = splitCommand(command);
        execFile(cmd, args, { cwd: workspaceManager.getRootDir() }, (error: unknown, stdout: string, stderr: string) => {
          resolve({
            command,
            status: error ? 'failed' : 'success',
            code: error && typeof error === 'object' && 'code' in error ? Number((error as { code?: number }).code ?? 0) : 0,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
          });
        });
      });
    },
    mcp: mcpServer,
  };
}
