/**
 * CRM workspace-wiring regression test.
 *
 * Verifies that when a workspace opens, useMemoryWiring calls
 * crmSetWorkspace(rootPath) alongside MemoryService.setWorkspace and
 * mailSetWorkspace — the three backends that must know the workspace path
 * before any command that reads/writes from it can succeed.
 *
 * Regression for: crmSetWorkspace had no caller in the workspace lifecycle,
 * so crm_sync_all always returned "workspace not set" and crm_disconnect
 * could not purge CRM data (the e2e tests masked this by setting the
 * workspace directly in test setup).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';

// ── Hoisted mocks — must come before any import of the module under test ─────

// Make isTauri() return true so the per-workspace lifecycle IIFE runs and
// exercises the three setWorkspace calls.
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: vi.fn().mockResolvedValue(undefined),
}));

const mailMocks = vi.hoisted(() => ({
  mailSetWorkspace: vi.fn().mockResolvedValue(undefined),
  mailBackfillRag: vi.fn().mockResolvedValue(undefined),
  mailRetagFolderMatter: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/platform/utils/mail-commands', () => mailMocks);

const crmMocks = vi.hoisted(() => ({
  crmSetWorkspace: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/platform/utils/wealthbox-commands', () => crmMocks);

// tauri-commands: watchWorkspace + model status helpers used inside the
// per-workspace lifecycle. Return resolved values so the IIFE completes.
const tauriCmdMocks = vi.hoisted(() => ({
  watchWorkspace: vi.fn().mockResolvedValue(undefined),
  MODEL_DOWNLOAD_EVENT: 'model-download-progress',
  modelStatus: vi.fn().mockResolvedValue('ready'),
}));

vi.mock('@/platform/utils/tauri-commands', () => tauriCmdMocks);

// @tauri-apps/api/event: listen() returns an unsubscribe function.
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

// MemoryService: mock the backend calls so no real Tauri IPC is attempted.
const memMocks = vi.hoisted(() => ({
  setWorkspace: vi.fn().mockResolvedValue(undefined),
  indexWorkspace: vi.fn().mockResolvedValue(undefined),
  reindexPaths: vi.fn().mockResolvedValue(undefined),
  deletePath: vi.fn().mockResolvedValue(undefined),
  indexFile: vi.fn().mockResolvedValue(undefined),
  indexPdfFile: vi.fn().mockResolvedValue(undefined),
  retagPrivilege: vi.fn().mockResolvedValue(undefined),
  deleteAllPdfChunks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/platform/rag/MemoryService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/rag/MemoryService')>();
  return {
    ...actual,
    MemoryService: { ...actual.MemoryService, ...memMocks },
  };
});

// ── Import under test (AFTER mocks) ─────────────────────────────────────────

import { useMemoryWiring } from '@/platform/hooks/useMemoryWiring';

// ── Minimal workspace service ────────────────────────────────────────────────

function makeWs() {
  return {
    readFile: vi.fn().mockResolvedValue(''),
    writeFile: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(false),
    getFileTree: vi.fn().mockResolvedValue([]),
  };
}

// ── Harness component ────────────────────────────────────────────────────────

function Harness({ root }: { root: string }) {
  useMemoryWiring(root, makeWs());
  return null;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('useMemoryWiring — CRM workspace wiring', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('calls crmSetWorkspace when a workspace opens', async () => {
    const root = '/home/user/Northcrest';
    render(<Harness root={root} />);

    await waitFor(() => {
      expect(crmMocks.crmSetWorkspace).toHaveBeenCalledWith(root);
    });
  });

  it('calls crmSetWorkspace alongside MemoryService.setWorkspace and mailSetWorkspace', async () => {
    const root = '/home/user/Northcrest';
    render(<Harness root={root} />);

    // All three workspace-awareness calls must fire for every workspace open.
    await waitFor(() => {
      expect(memMocks.setWorkspace).toHaveBeenCalledWith(root);
      expect(mailMocks.mailSetWorkspace).toHaveBeenCalledWith(root);
      expect(crmMocks.crmSetWorkspace).toHaveBeenCalledWith(root);
    });
  });

  it('calls crmSetWorkspace with the new path when the workspace changes', async () => {
    const root1 = '/home/user/ClientA';
    const root2 = '/home/user/ClientB';

    const { rerender } = render(<Harness root={root1} />);

    await waitFor(() => {
      expect(crmMocks.crmSetWorkspace).toHaveBeenCalledWith(root1);
    });

    vi.clearAllMocks();
    rerender(<Harness root={root2} />);

    await waitFor(() => {
      expect(crmMocks.crmSetWorkspace).toHaveBeenCalledWith(root2);
    });
  });

  it('a crmSetWorkspace failure does not break the rest of workspace wiring', async () => {
    // The CRM connector is optional; if its setup throws, file-watching and
    // memory indexing must still be wired for the user.
    crmMocks.crmSetWorkspace.mockRejectedValueOnce(new Error('crm backend unavailable'));
    const root = '/home/user/Northcrest';
    render(<Harness root={root} />);

    await waitFor(() => {
      expect(tauriCmdMocks.watchWorkspace).toHaveBeenCalledWith(root);
    });
  });
});
