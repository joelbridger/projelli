/**
 * WorkspaceSelector — QA-32 regression coverage for the "Open Existing" /
 * "New Workspace" native folder-picker dialog-watchdog fallback.
 *
 * qa5's bench-2 evidence: `plugin:dialog|open` never resolved or rejected —
 * ever — leaving the whole screen stuck. These tests pin down that a picker
 * which never responds now falls back to the manual path-entry prompt
 * instead of leaving the button permanently disabled with no escape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const { openDialogMock } = vi.hoisted(() => ({
  openDialogMock: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: openDialogMock,
}));

const { migrateWorkspaceDataDirMock } = vi.hoisted(() => ({
  migrateWorkspaceDataDirMock: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/platform/utils/tauri-commands', () => ({
  migrateWorkspaceDataDir: migrateWorkspaceDataDirMock,
}));

const { vaultStatusMock } = vi.hoisted(() => ({
  vaultStatusMock: vi.fn(),
}));

vi.mock('@/platform/firm/vault/vaultClient', () => ({
  vaultStatus: vaultStatusMock,
}));

const { createFSBackendMock } = vi.hoisted(() => ({
  createFSBackendMock: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/platform/fs/BackendFactory', () => ({
  createFSBackend: createFSBackendMock,
  isTauriEnvironment: () => true,
}));

vi.mock('@/platform/fs/WorkspaceService', () => ({
  createWorkspaceService: () => ({
    initialize: vi
      .fn()
      .mockResolvedValue({ rootPath: '/manual/path', name: 'path' }),
    getFileTree: vi.fn().mockResolvedValue([]),
  }),
}));

import {
  WorkspaceSelector,
  type WorkspaceSelectorProps,
} from './WorkspaceSelector';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';

function mockPromptForPath() {
  return vi.fn<NonNullable<WorkspaceSelectorProps['promptForPath']>>();
}

describe('WorkspaceSelector — native picker dialog watchdog (QA-32)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    openDialogMock.mockReset();
    vaultStatusMock.mockReset();
    vaultStatusMock.mockResolvedValue({
      enabled: false,
      locked: false,
      hasEscrow: false,
      vaultId: null,
    });
    createFSBackendMock.mockReset();
    createFSBackendMock.mockResolvedValue({});
    migrateWorkspaceDataDirMock.mockReset();
    migrateWorkspaceDataDirMock.mockResolvedValue(null);
    useWorkspaceStore.setState({ recentWorkspaces: [] } as never);
  });

  it('"Open Existing" falls back to the manual path prompt when the picker never responds', async () => {
    openDialogMock.mockReturnValue(new Promise(() => {})); // hangs forever, like qa5's bench-2 repro
    const promptForPath = mockPromptForPath().mockResolvedValue(null); // user cancels the fallback prompt

    render(
      <WorkspaceSelector
        open={true}
        onWorkspaceSelected={vi.fn()}
        promptForPath={promptForPath}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('open-existing-workspace'));
      await vi.advanceTimersByTimeAsync(90_000);
    });

    expect(promptForPath).toHaveBeenCalledTimes(1);
    const call = promptForPath.mock.calls[0];
    if (!call) throw new Error('expected promptForPath to have been called');
    const [message, defaultValue, options] = call;
    expect(message).toEqual(expect.stringContaining("didn't respond"));
    expect(defaultValue).toBe('');
    expect(typeof options?.title).toBe('string');
    expect(typeof options?.placeholder).toBe('string');
    vi.useRealTimers();
  });

  it('"New Workspace" falls back to the manual path prompt when the picker never responds', async () => {
    openDialogMock.mockReturnValue(new Promise(() => {}));
    const promptForPath = mockPromptForPath().mockResolvedValue(null);

    render(
      <WorkspaceSelector
        open={true}
        onWorkspaceSelected={vi.fn()}
        promptForPath={promptForPath}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('new-workspace'));
      await vi.advanceTimersByTimeAsync(90_000);
    });

    expect(promptForPath).toHaveBeenCalledTimes(1);
    const call = promptForPath.mock.calls[0];
    if (!call) throw new Error('expected promptForPath to have been called');
    const [message, defaultValue, options] = call;
    expect(message).toEqual(expect.stringContaining("didn't respond"));
    expect(defaultValue).toBe('');
    expect(typeof options?.title).toBe('string');
    expect(typeof options?.placeholder).toBe('string');
    vi.useRealTimers();
  });

  it('does not invoke the fallback prompt when the picker resolves normally', async () => {
    vi.useRealTimers();
    openDialogMock.mockResolvedValue(null); // user just cancelled the real dialog
    const promptForPath = vi.fn();

    render(
      <WorkspaceSelector
        open={true}
        onWorkspaceSelected={vi.fn()}
        promptForPath={promptForPath}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('open-existing-workspace'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(promptForPath).not.toHaveBeenCalled();
  });
});

describe('WorkspaceSelector — debug first-run workspace', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vaultStatusMock.mockReset();
    createFSBackendMock.mockReset();
    migrateWorkspaceDataDirMock.mockReset();
    migrateWorkspaceDataDirMock.mockResolvedValue(null);
  });

  it('uses the picker path and shows unlock UI for a locked workspace', async () => {
    vaultStatusMock.mockResolvedValue({
      enabled: true,
      locked: true,
      hasEscrow: false,
      vaultId: 'vault-1',
    });

    render(
      <WorkspaceSelector
        open={true}
        onWorkspaceSelected={vi.fn()}
        autoOpenWorkspacePath="/debug/locked-workspace"
      />
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(migrateWorkspaceDataDirMock).toHaveBeenCalledWith(
      '/debug/locked-workspace'
    );
    expect(vaultStatusMock).toHaveBeenCalledWith('/debug/locked-workspace');
    expect(createFSBackendMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('recovery-phrase-input')).toBeInTheDocument();
  });
});

describe('WorkspaceSelector — recent-workspace open failures (codex-review round 2)', () => {
  beforeEach(() => {
    vi.useRealTimers();
    openDialogMock.mockReset();
    vaultStatusMock.mockReset();
    vaultStatusMock.mockResolvedValue({
      enabled: false,
      locked: false,
      hasEscrow: false,
      vaultId: null,
    });
    createFSBackendMock.mockReset();
    migrateWorkspaceDataDirMock.mockReset();
    migrateWorkspaceDataDirMock.mockResolvedValue(null);
    useWorkspaceStore.setState({
      recentWorkspaces: [
        { path: '/recent/one', name: 'one', lastOpened: new Date() },
      ],
    } as never);
  });

  async function openTheOneRecentRow() {
    render(<WorkspaceSelector open={true} onWorkspaceSelected={vi.fn()} />);
    fireEvent.click(screen.getByTestId('recent-workspaces-toggle'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('recent-workspace-row'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('does NOT prune the recent workspace on a transient (serviceUnavailable) failure', async () => {
    createFSBackendMock.mockRejectedValue({
      kind: 'keychain',
      message: 'the OS credential storage service did not respond in time',
    });

    await openTheOneRecentRow();

    expect(useWorkspaceStore.getState().recentWorkspaces).toHaveLength(1);
    // getByText throws if not found — this alone proves the honest message rendered.
    screen.getByText(/did not respond in time/);
  });

  it('DOES prune the recent workspace on a genuine "path does not exist" failure', async () => {
    createFSBackendMock.mockRejectedValue(
      new Error('Workspace path does not exist: /recent/one')
    );

    await openTheOneRecentRow();

    expect(useWorkspaceStore.getState().recentWorkspaces).toHaveLength(0);
  });

  it('a slow migration is fully awaited — createFSBackend (which would re-migrate) never starts early, so no second migration attempt races the first', async () => {
    let resolveMigration: (value: null) => void = () => {};
    migrateWorkspaceDataDirMock.mockReturnValue(
      new Promise((resolve) => {
        resolveMigration = resolve;
      })
    );

    render(<WorkspaceSelector open={true} onWorkspaceSelected={vi.fn()} />);
    fireEvent.click(screen.getByTestId('recent-workspaces-toggle'));
    fireEvent.click(screen.getByTestId('recent-workspace-row'));

    // Let microtasks drain without resolving the migration — if this call
    // raced the migration against ANY timeout, createFSBackend would have
    // been invoked by now (starting a second, concurrent migration attempt
    // inside it) regardless of the first migration still being unresolved.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(createFSBackendMock).not.toHaveBeenCalled();
    expect(migrateWorkspaceDataDirMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveMigration(null);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(createFSBackendMock).toHaveBeenCalledTimes(1);
  });
});
