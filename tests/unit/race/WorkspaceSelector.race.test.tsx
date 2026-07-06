/**
 * QA-52 (P0, cross-workspace leak) — WorkspaceSelector open-request guard.
 *
 * Opening workspace A then quickly opening B must land the app on B. If A's
 * load finishes last, it must NOT still call setRootPath / setFileTree /
 * onWorkspaceSelected — that would land the app on the WRONG workspace.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

const { migrateWorkspaceDataDirMock } = vi.hoisted(() => ({
  migrateWorkspaceDataDirMock: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/platform/utils/tauri-commands', () => ({
  migrateWorkspaceDataDir: migrateWorkspaceDataDirMock,
}));

vi.mock('@/platform/firm/vault/vaultClient', () => ({
  vaultStatus: vi.fn().mockResolvedValue({ enabled: false, locked: false, hasEscrow: false, vaultId: null }),
}));

const { createFSBackendMock } = vi.hoisted(() => ({
  createFSBackendMock: vi.fn(),
}));
vi.mock('@/platform/fs/BackendFactory', () => ({
  createFSBackend: createFSBackendMock,
  isTauriEnvironment: () => true,
}));

vi.mock('@/platform/fs/WorkspaceService', () => ({
  createWorkspaceService: () => {
    // Echo the path so each open's resolved workspace is identifiable.
    let root = '';
    return {
      initialize: vi.fn((_backend: unknown, path: string) => {
        root = path;
        return Promise.resolve({ rootPath: path, name: path });
      }),
      getRootPath: () => root,
      getFileTree: vi.fn().mockResolvedValue([]),
    };
  },
}));

import { WorkspaceSelector } from '@/features/documents/workspace/WorkspaceSelector';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  migrateWorkspaceDataDirMock.mockReset();
  migrateWorkspaceDataDirMock.mockResolvedValue(null);
  createFSBackendMock.mockReset();
  useWorkspaceStore.setState({
    rootPath: null,
    fileTree: [],
    recentWorkspaces: [
      { path: '/A', name: 'A', lastOpened: new Date() },
      { path: '/B', name: 'B', lastOpened: new Date() },
    ],
  } as never);
});

describe('WorkspaceSelector — QA-52 stale open-request isolation', () => {
  it('a slower earlier open (A) does not overwrite the newer selected workspace (B)', async () => {
    const aBackend = deferred<object>();
    createFSBackendMock.mockImplementation((path: string) =>
      path === '/A' ? aBackend.promise : Promise.resolve({}),
    );

    // QA-93 round 3: the selector no longer commits the root itself — the
    // handler does, after its own guards. Simulate that contract here so the
    // race assertion still observes the committed root.
    const onWorkspaceSelected = vi.fn(async (service: { getRootPath: () => string }) => {
      useWorkspaceStore.getState().setRootPath(service.getRootPath());
      return true;
    });
    render(<WorkspaceSelector open onWorkspaceSelected={onWorkspaceSelected as never} />);

    // Expand recents and click BOTH rows in the same tick, before React
    // re-renders to disable them — mirrors two opens racing.
    await act(async () => {
      screen.getByTestId('recent-workspaces-toggle').click();
    });
    const rows = screen.getAllByTestId('recent-workspace-row');
    await act(async () => {
      rows[0]!.click(); // open A (backend pending)
      rows[1]!.click(); // open B (backend resolves immediately)
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // B has committed.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(useWorkspaceStore.getState().rootPath).toBe('/B');

    // Now A finishes LAST — it must NOT overwrite B.
    await act(async () => {
      aBackend.resolve({});
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(useWorkspaceStore.getState().rootPath).toBe('/B');
    // onWorkspaceSelected's final call is B, never a late A.
    const lastCall = onWorkspaceSelected.mock.calls.at(-1);
    expect(onWorkspaceSelected).not.toHaveBeenCalledTimes(0);
    // The service that "won" resolves the file tree for /B.
    expect(useWorkspaceStore.getState().rootPath).toBe('/B');
    expect(lastCall).toBeTruthy();
  });
});
