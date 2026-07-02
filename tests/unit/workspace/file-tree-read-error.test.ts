/**
 * WorkspaceService.getFileTree — F2.4 honest read-error state.
 *
 * A folder whose contents can't be read (permission denied, an offline
 * network/OneDrive location, a locked drive) used to become a silent
 * `children: []` — indistinguishable from an ordinary empty folder. It must
 * now be flagged `readError: true` so the UI can show that honestly instead.
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

function createMockBackend(
  listing: Record<string, FileNode[] | Error>,
): FSBackend {
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
    list: vi.fn(async (p: string) => {
      const entry = listing[p] ?? [];
      if (entry instanceof Error) throw entry;
      return entry;
    }),
    isSymlink: vi.fn(async () => false),
    resolveSymlink: vi.fn(async () => rootPath),
  } as unknown as FSBackend;
}

describe('WorkspaceService.getFileTree — read-error flag', () => {
  it('flags a folder whose contents could not be read, instead of silently reporting it empty', async () => {
    const backend = createMockBackend({
      '': [node('Clients', 'folder', 'Clients')],
      Clients: new Error('permission denied'),
    });

    const service = new WorkspaceService();
    await service.initialize(backend, '/ws');

    const tree = await service.getFileTree();
    const clients = tree.find((n) => n.name === 'Clients');

    expect(clients?.children).toEqual([]);
    expect(clients?.readError).toBe(true);
  });

  it('does not flag a genuinely empty folder', async () => {
    const backend = createMockBackend({
      '': [node('Empty', 'folder', 'Empty')],
      Empty: [],
    });

    const service = new WorkspaceService();
    await service.initialize(backend, '/ws');

    const tree = await service.getFileTree();
    const empty = tree.find((n) => n.name === 'Empty');

    expect(empty?.children).toEqual([]);
    expect(empty?.readError).toBeUndefined();
  });
});
