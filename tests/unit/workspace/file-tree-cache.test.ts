/**
 * P1.1 (Task 6) — WorkspaceService shares ONE boot tree scan.
 *
 * getFileTree() does a full recursive backend walk. On workspace open ~5
 * consumers scan the tree nearly simultaneously; this caches the in-flight scan
 * so they share one walk. Correctness: any mutation through the service, and any
 * `{ fresh: true }` call (the file watcher's poll), re-scans; each caller gets an
 * isolated clone.
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

/** A mock backend whose root listing is swappable, to simulate disk changes. */
function createMockBackend(initial: FileNode[]) {
  let root = initial;
  const stat = (p: string): FileStat => ({
    path: p,
    name: p.split('/').pop() || 'root',
    type: 'folder',
    size: 0,
    modifiedAt: new Date(),
    createdAt: new Date(),
    isSymlink: false,
  });
  const backend = {
    setRootPath: vi.fn(async () => undefined),
    getRootPath: vi.fn(() => '/ws'),
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
    list: vi.fn(async (p: string) => (p === '' ? root : [])),
    isSymlink: vi.fn(async () => false),
    resolveSymlink: vi.fn(async () => '/ws'),
  } as unknown as FSBackend & { list: ReturnType<typeof vi.fn> };
  return { backend, setRoot: (n: FileNode[]) => { root = n; } };
}

async function makeService(initial: FileNode[]) {
  const { backend, setRoot } = createMockBackend(initial);
  const service = new WorkspaceService();
  await service.initialize(backend, '/ws');
  return { service, backend, setRoot };
}

describe('WorkspaceService — shared boot tree scan (P1.1 Task 6)', () => {
  it('concurrent getFileTree() calls share ONE backend walk', async () => {
    const { service, backend } = await makeService([node('a.md', 'file', 'a.md')]);
    backend.list.mockClear();

    // Five simultaneous boot consumers.
    const [t1, t2, t3, t4, t5] = await Promise.all([
      service.getFileTree(),
      service.getFileTree(),
      service.getFileTree(),
      service.getFileTree(),
      service.getFileTree(),
    ]);

    // Only ONE root walk happened (the shared in-flight scan).
    expect(backend.list).toHaveBeenCalledTimes(1);
    expect(t1.map((n) => n.name)).toEqual(['a.md']);
    expect(t2).toEqual(t1);
    // Distinct array/object instances (clone-on-return), so a consumer mutating
    // its tree can't corrupt another's.
    expect(t1).not.toBe(t2);
    expect(t1[0]).not.toBe(t2[0]);
    void t3; void t4; void t5;
  });

  it('a mutation invalidates the cache so the next scan is fresh', async () => {
    const { service, backend, setRoot } = await makeService([node('a.md', 'file', 'a.md')]);
    await service.getFileTree(); // populate cache
    backend.list.mockClear();

    // Cached — no new walk.
    await service.getFileTree();
    expect(backend.list).toHaveBeenCalledTimes(0);

    // Mutation invalidates; disk now has a new file.
    setRoot([node('a.md', 'file', 'a.md'), node('b.md', 'file', 'b.md')]);
    await service.writeFile('b.md', 'hi');

    const after = await service.getFileTree();
    expect(backend.list).toHaveBeenCalledTimes(1); // re-scanned after the write
    expect(after.map((n) => n.name).sort()).toEqual(['a.md', 'b.md']);
  });

  it('{ fresh: true } bypasses the cache and repopulates it', async () => {
    const { service, backend, setRoot } = await makeService([node('a.md', 'file', 'a.md')]);
    await service.getFileTree(); // populate
    backend.list.mockClear();

    // External change the service didn't make (mtime-style) — cache is stale.
    setRoot([node('a.md', 'file', 'a.md'), node('c.md', 'file', 'c.md')]);

    // Cached read would miss it...
    const stale = await service.getFileTree();
    expect(stale.map((n) => n.name)).toEqual(['a.md']);
    expect(backend.list).toHaveBeenCalledTimes(0);

    // ...the watcher's fresh poll sees it AND warms the cache.
    const fresh = await service.getFileTree({ fresh: true });
    expect(fresh.map((n) => n.name).sort()).toEqual(['a.md', 'c.md']);
    expect(backend.list).toHaveBeenCalledTimes(1);

    // Subsequent cached read now reflects the fresh scan.
    const cachedNow = await service.getFileTree();
    expect(cachedNow.map((n) => n.name).sort()).toEqual(['a.md', 'c.md']);
    expect(backend.list).toHaveBeenCalledTimes(1);
  });
});
