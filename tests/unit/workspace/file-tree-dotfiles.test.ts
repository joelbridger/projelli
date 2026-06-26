/**
 * WorkspaceService.getFileTree — centralized dotfile handling (UX-21).
 *
 * Recursion + dotfile/.keepance/.trash rules belong in listRecursive (the shared
 * tree builder), so EVERY fileTree consumer — not just FileTree/FileGridView —
 * gets a tree that:
 *   - never contains Keepance's internal `.keepance` folder,
 *   - shows ordinary dotfiles (.gitignore) and dot-directories (.git) so the
 *     "Show Hidden Files" setting can reveal them, and
 *   - never WALKS into a dot-directory (a huge .git must not slow load).
 */
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type { FSBackend, FileStat } from '@/platform/fs/types';
import type { FileNode } from '@/platform/types/workspace';

function node(name: string, type: 'file' | 'folder', path: string): FileNode {
  return type === 'folder'
    ? { id: path, name, type, path, children: [] }
    : { id: path, name, type, path };
}

function createMockBackend(listing: Record<string, FileNode[]>): FSBackend {
  let rootPath = '';
  const stat = (p: string): FileStat => ({
    path: p,
    name: p.split('/').pop() || 'root',
    type: 'folder',
    size: 0,
    modifiedAt: new Date(),
    createdAt: new Date(),
    isSymlink: false,
  });
  return {
    setRootPath: vi.fn(async (p: string) => {
      rootPath = p;
    }),
    getRootPath: vi.fn(() => rootPath),
    exists: vi.fn(async () => true),
    stat: vi.fn(async (p: string) => stat(p)),
    read: vi.fn(async () => ''),
    readBinary: vi.fn(async () => new ArrayBuffer(0)),
    write: vi.fn(async () => undefined),
    writeBinary: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    move: vi.fn(async () => undefined),
    copy: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
    list: vi.fn(async (p: string) => listing[p] ?? []),
    isSymlink: vi.fn(async () => false),
    resolveSymlink: vi.fn(async () => rootPath),
  } as unknown as FSBackend;
}

describe('WorkspaceService.getFileTree — dotfile handling', () => {
  it('hides .keepance everywhere, shows ordinary dotfiles, and never walks dot-directories', async () => {
    const backend = createMockBackend({
      '': [
        node('.gitignore', 'file', '.gitignore'),
        node('.keepance', 'folder', '.keepance'),
        node('.git', 'folder', '.git'),
        node('.trash', 'folder', '.trash'),
        node('docs', 'folder', 'docs'),
        node('README.md', 'file', 'README.md'),
      ],
      docs: [node('note.md', 'file', 'docs/note.md')],
    });

    const service = new WorkspaceService();
    await service.initialize(backend, '/ws');

    const tree = await service.getFileTree();
    const names = tree.map((n) => n.name);

    // Ordinary dotfile + dot-directory are visible; .keepance is gone for ALL
    // fileTree consumers (DocumentBrowser/DocumentGridView included).
    expect(names).toContain('.gitignore');
    expect(names).toContain('.git');
    expect(names).toContain('.trash');
    expect(names).toContain('docs');
    expect(names).toContain('README.md');
    expect(names).not.toContain('.keepance');

    // Ordinary directory IS walked; dot-directories + .keepance are NOT (perf).
    expect(backend.list).toHaveBeenCalledWith('docs');
    expect(backend.list).not.toHaveBeenCalledWith('.git');
    expect(backend.list).not.toHaveBeenCalledWith('.trash');
    expect(backend.list).not.toHaveBeenCalledWith('.keepance');

    expect(tree.find((n) => n.name === '.git')?.children).toEqual([]);
    expect(
      tree.find((n) => n.name === 'docs')?.children?.map((c) => c.name),
    ).toEqual(['note.md']);
  });
});
