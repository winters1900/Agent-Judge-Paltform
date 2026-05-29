import type { WorkspaceFile } from '../workspace-manager/index.ts';

type WorkspaceSummary = {
  prompt: string;
  selectedFile: string | null;
  selectedFileContent: WorkspaceFile | null;
  workspaceSummary: string;
  contextBudget: {
    maxFiles: number;
    maxChars: number;
    includedFiles: string[];
  };
};

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text: unknown): string[] {
  return normalizeText(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/gu)
    .filter(Boolean);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function scoreFile(filePath: string, promptTokens: string[], selectedFileTokens: string[]): number {
  const pathTokens = tokenize(filePath);
  const combined = new Set([...promptTokens, ...selectedFileTokens]);
  let score = 0;

  for (const token of pathTokens) {
    if (combined.has(token)) score += 6;
    if (promptTokens.includes(token)) score += 4;
    if (selectedFileTokens.includes(token)) score += 2;
  }

  if (filePath === 'package.json') score += 3;
  if (filePath.endsWith('.tsx') || filePath.endsWith('.ts') || filePath.endsWith('.js') || filePath.endsWith('.jsx')) score += 2;
  return score;
}

function compressFileContent(content: string | undefined, maxLines = 24): string {
  const lines = String(content ?? '').split('\n');
  if (lines.length <= maxLines) return lines.join('\n');

  const head = lines.slice(0, Math.ceil(maxLines / 2));
  const tail = lines.slice(-Math.floor(maxLines / 2));
  return [...head, '... (content truncated) ...', ...tail].join('\n');
}

function buildWorkspaceSummary(files: WorkspaceFile[], options: { maxFiles: number; maxChars: number; selectedFile: string | null }): string {
  const { maxFiles, maxChars, selectedFile } = options;
  const summary: string[] = [];
  let charCount = 0;

  for (const file of files.slice(0, maxFiles)) {
    const content = file.path === selectedFile ? compressFileContent(file.content, 32) : compressFileContent(file.content, 16);
    const block = [`FILE: ${file.path}`, content ? content : '(empty)', ''].join('\n');
    if (charCount + block.length > maxChars) break;
    summary.push(block);
    charCount += block.length;
  }

  return summary.join('\n');
}

export function createContextBuilder(toolGateway: {
  listWorkspace: () => WorkspaceFile[];
  readFile: (path: string) => Promise<WorkspaceFile | null>;
}, options: { maxFiles?: number; maxChars?: number } = {}) {
  const maxFiles = options.maxFiles ?? 8;
  const maxChars = options.maxChars ?? 12000;

  return {
    async buildForPrompt(prompt: string, selectedFile: string | null = null): Promise<WorkspaceSummary> {
      const files = await toolGateway.listWorkspace();
      const selectedFileContent = selectedFile ? await toolGateway.readFile(selectedFile) : null;

      const promptTokens = tokenize(prompt);
      const selectedFileTokens = tokenize(selectedFile ?? '');

      const rankedFiles = unique([
        ...files
          .map((file) => ({
            ...file,
            score: scoreFile(file.path, promptTokens, selectedFileTokens),
          }))
          .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)),
        ...files.map((file) => ({ ...file, score: 0 })),
      ]).slice(0, maxFiles);

      const workspaceSummary = buildWorkspaceSummary(rankedFiles, {
        maxFiles,
        maxChars,
        selectedFile,
      });

      return {
        prompt,
        selectedFile,
        selectedFileContent,
        workspaceSummary,
        contextBudget: {
          maxFiles,
          maxChars,
          includedFiles: rankedFiles.map((file) => file.path),
        },
      };
    },
  };
}
