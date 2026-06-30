/**
 * BUG-002 — WorkspaceService.initialize must support creating a brand-new
 * workspace whose root folder does not exist yet, and must stay strict for the
 * open-existing flow.
 *
 * Also guards the latent double-join bug: the create-the-root fallback must call
 * `backend.mkdir('')` (root) and NOT the absolute rootPath, which the backend
 * would otherwise re-join under itself (e.g. `/root/<root>`).
 */
import { describe, it, expect, vi } from 'vitest';
import { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { FileOperationError } from '@/platform/fs/types';
import type { FSBackend, FileStat, SetRootPathOptions } from '@/platform/fs/types';

function folderStat(name: string): FileStat {
  return {
    path: '',
    name,
    type: 'folder',
    size: 0,
    modifiedAt: new Date(),
    createdAt: new Date(),
    isSymlink: false,
  };
}

/**
 * Mock backend whose root starts MISSING. `setRootPath({createIfMissing})`
 * creates it (mirroring the real TauriFSBackend); a no-op setRootPath leaves it
 * missing so we can exercise the WorkspaceService fallback path too.
 */
function createMissingRootBackend(opts: { createOnSetRoot: boolean }): FSBackend & {
  rootExists: boolean;
  mkdirCalls: string[];
} {
  const dirs = new Set<string>();
  let rootPath = '';
  const state = {
    rootExists: false,
    mkdirCalls: [] as string[],
  };

  const backend: FSBackend & { rootExists: boolean; mkdirCalls: string[] } = {
    get rootExists() {
      return state.rootExists;
    },
    set rootExists(v: boolean) {
      state.rootExists = v;
    },
    get mkdirCalls() {
      return state.mkdirCalls;
    },
    setRootPath: vi.fn(async (path: string, options?: SetRootPathOptions) => {
      rootPath = path;
      if (!state.rootExists && options?.createIfMissing && opts.createOnSetRoot) {
        state.rootExists = true;
      }
    }),
    getRootPath: vi.fn(() => rootPath),
    exists: vi.fn(async (path: string) => {
      if (path === '') return state.rootExists;
      return dirs.has(path);
    }),
    stat: vi.fn(async () => folderStat(rootPath.split(/[\\/]/).pop() || 'WS')),
    mkdir: vi.fn(async (path: string) => {
      state.mkdirCalls.push(path);
      if (path === '') state.rootExists = true;
      else dirs.add(path);
    }),
    read: vi.fn(async () => ''),
    readBinary: vi.fn(async () => new ArrayBuffer(0)),
    write: vi.fn(async () => undefined),
    writeBinary: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    move: vi.fn(async () => undefined),
    copy: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
    isSymlink: vi.fn(async () => false),
    resolveSymlink: vi.fn(async () => rootPath),
  };
  return backend;
}

describe('WorkspaceService.initialize — create-new workspace', () => {
  it('creates a brand-new workspace (root missing) and its default structure when createIfMissing is set', async () => {
    const service = new WorkspaceService();
    const backend = createMissingRootBackend({ createOnSetRoot: true });

    const ws = await service.initialize(backend, '/home/jane/New WS', {
      createIfMissing: true,
      createDefaultStructure: true,
    });

    expect(ws.rootPath).toBe('/home/jane/New WS');
    // setRootPath received the createIfMissing flag.
    expect(backend.setRootPath).toHaveBeenCalledWith('/home/jane/New WS', {
      createIfMissing: true,
    });
    // Default folders were created with workspace-relative paths.
    expect(backend.mkdir).toHaveBeenCalledWith('docs');
    expect(backend.mkdir).toHaveBeenCalledWith('.trash');
  });

  it('open-existing flow stays strict: a missing root throws (no createIfMissing)', async () => {
    const service = new WorkspaceService();
    // Backend whose setRootPath is a no-op (does NOT create), root stays missing.
    const backend = createMissingRootBackend({ createOnSetRoot: false });

    await expect(
      service.initialize(backend, '/home/jane/Typo')
    ).rejects.toBeInstanceOf(FileOperationError);
  });

  it('fallback create-the-root uses mkdir("") not the absolute path (no double-join)', async () => {
    const service = new WorkspaceService();
    // setRootPath does NOT create (e.g. a no-op backend), so WorkspaceService
    // must create the root itself via the fallback.
    const backend = createMissingRootBackend({ createOnSetRoot: false });

    await service.initialize(backend, '/home/jane/New WS', { createIfMissing: true });

    // The very first mkdir (root creation) must be '' — never the absolute path.
    expect(backend.mkdirCalls[0]).toBe('');
    expect(backend.mkdir).not.toHaveBeenCalledWith('/home/jane/New WS');
  });
});
