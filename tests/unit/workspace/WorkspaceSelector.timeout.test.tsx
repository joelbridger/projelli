// WorkspaceSelector — open-flow robustness (Part B/C of the Windows path fix).
//
// Two behaviours are pinned here:
//   1. Part C — a legitimately LARGE/SLOW workspace must still open. The 30s
//      timeout was widened to cover ONLY the native setup (createFSBackend +
//      initialize); the recursive file-tree scan now runs untimed. A slow scan
//      must NOT reject a valid workspace (nor prune it from recents).
//   2. Part B.1 — cancelling the folder picker must reset the loading state, so
//      the buttons can never end up greyed-out forever.
//
// We mock withTimeout with a SHORT (100ms) window so the test can prove the
// scan runs OUTSIDE it: initialize resolves fast, getFileTree resolves slow.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const dialogOpen = vi.fn();
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: (...a: unknown[]) => dialogOpen(...a) }));

vi.mock('@/platform/fs/BackendFactory', () => ({
  isTauriEnvironment: () => true,
  createFSBackend: vi.fn(async () => ({})),
}));

vi.mock('@/platform/firm/vault/vaultClient', () => ({
  vaultStatus: vi.fn(async () => ({ enabled: false, locked: false })),
}));

// withTimeout with a forced short window — if getFileTree were wrapped by it,
// a slow scan would reject. After the fix only initialize is wrapped.
vi.mock('@/lib/withTimeout', () => ({
  TimeoutError: class TimeoutError extends Error {},
  withTimeout: (p: Promise<unknown>, _ms: number, msg: string) =>
    Promise.race([
      p,
      new Promise((_res, rej) => setTimeout(() => rej(new Error(msg)), 100)),
    ]),
}));

const initialize = vi.fn();
const getFileTree = vi.fn();
vi.mock('@/platform/fs/WorkspaceService', () => ({
  WorkspaceService: class {},
  createWorkspaceService: () => ({ initialize, getFileTree }),
}));

import '@/i18n';
import { WorkspaceSelector } from '@/features/documents/workspace/WorkspaceSelector';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  vi.clearAllMocks();
  // Fast native setup, SLOW tree scan (300ms > the mocked 100ms timeout window).
  initialize.mockImplementation(async () => {
    await delay(10);
    return { rootPath: '/Users/jane/BigArchive', name: 'BigArchive' };
  });
  getFileTree.mockImplementation(async () => {
    await delay(300);
    return [];
  });
});

describe('WorkspaceSelector — Part C: large/slow workspace is not rejected', () => {
  it('opens a workspace whose file-tree scan exceeds the setup timeout window', async () => {
    const onWorkspaceSelected = vi.fn();
    dialogOpen.mockResolvedValue('/Users/jane/BigArchive');

    render(<WorkspaceSelector open onWorkspaceSelected={onWorkspaceSelected} />);
    fireEvent.click(screen.getByTestId('open-existing-workspace'));

    // The slow scan (300ms) must NOT cause a rejection — the workspace opens.
    await waitFor(() => expect(onWorkspaceSelected).toHaveBeenCalledTimes(1), {
      timeout: 2000,
    });
    expect(getFileTree).toHaveBeenCalledTimes(1);
    // No error banner shown.
    expect(screen.queryByText(/took too long/i)).toBeNull();
  });
});

describe('WorkspaceSelector — Part B.1: cancelling the picker resets loading', () => {
  it('re-enables the buttons after the folder dialog is cancelled', async () => {
    const onWorkspaceSelected = vi.fn();
    dialogOpen.mockResolvedValue(null); // user cancelled the picker

    render(<WorkspaceSelector open onWorkspaceSelected={onWorkspaceSelected} />);
    const openBtn = screen.getByTestId('open-existing-workspace') as HTMLButtonElement;
    fireEvent.click(openBtn);

    await waitFor(() => expect(openBtn.disabled).toBe(false));
    expect(onWorkspaceSelected).not.toHaveBeenCalled();
  });
});
