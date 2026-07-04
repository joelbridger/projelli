/**
 * Connector workspace-wiring regression test.
 *
 * Verifies that when a workspace opens, useMemoryWiring calls
 * connector setWorkspace commands alongside MemoryService.setWorkspace and
 * mailSetWorkspace — the backends that must know the workspace path before
 * any command that reads/writes from it can succeed.
 *
 * Regression for: crmSetWorkspace had no caller in the workspace lifecycle,
 * so crm_sync_all always returned "workspace not set" and crm_disconnect
 * could not purge CRM data (the e2e tests masked this by setting the
 * workspace directly in test setup).
 *
 * Same regression class for DocuSign: docusign_sync returned "workspace not
 * set" because only the unit test called docusignSetWorkspace.
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

const docusignMocks = vi.hoisted(() => ({
  docusignSetWorkspace: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/platform/utils/docusign-commands', () => docusignMocks);
const addeparMocks = vi.hoisted(() => ({
  addeparSetWorkspace: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/platform/utils/addepar-commands', () => addeparMocks);
const calendlyMocks = vi.hoisted(() => ({
  calendlySetWorkspace: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/platform/utils/calendly-commands', () => calendlyMocks);

// tauri-commands: watchWorkspace + model status helpers used inside the
// per-workspace lifecycle. Return resolved values so the IIFE completes.
const tauriCmdMocks = vi.hoisted(() => ({
  watchWorkspace: vi.fn().mockResolvedValue(undefined),
  MODEL_DOWNLOAD_EVENT: 'model-download-progress',
  modelStatus: vi.fn().mockResolvedValue('ready'),
}));

vi.mock('@/platform/utils/tauri-commands', () => tauriCmdMocks);

// @tauri-apps/api/event: listen() returns an unsubscribe function. Hoisted +
// exposed as `eventMocks.listen` so the cancellation-race test below can
// override its resolved value per-call to track the unlisten function.
const eventMocks = vi.hoisted(() => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('@tauri-apps/api/event', () => eventMocks);

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

describe('useMemoryWiring — connector workspace wiring', () => {
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

  it('calls docusignSetWorkspace when a workspace opens', async () => {
    const root = '/home/user/Northcrest';
    render(<Harness root={root} />);

    await waitFor(() => {
      expect(docusignMocks.docusignSetWorkspace).toHaveBeenCalledWith(root);
    });
  });

  it('calls connector setWorkspace commands alongside MemoryService.setWorkspace and mailSetWorkspace', async () => {
    const root = '/home/user/Northcrest';
    render(<Harness root={root} />);

    // All workspace-awareness calls must fire for every workspace open.
    await waitFor(() => {
      expect(memMocks.setWorkspace).toHaveBeenCalledWith(root);
      expect(mailMocks.mailSetWorkspace).toHaveBeenCalledWith(root);
      expect(crmMocks.crmSetWorkspace).toHaveBeenCalledWith(root);
      expect(docusignMocks.docusignSetWorkspace).toHaveBeenCalledWith(root);
      expect(addeparMocks.addeparSetWorkspace).toHaveBeenCalledWith(root);
      expect(calendlyMocks.calendlySetWorkspace).toHaveBeenCalledWith(root);
    });
  });

  it('calls connector setWorkspace commands with the new path when the workspace changes', async () => {
    const root1 = '/home/user/ClientA';
    const root2 = '/home/user/ClientB';

    const { rerender } = render(<Harness root={root1} />);

    await waitFor(() => {
      expect(crmMocks.crmSetWorkspace).toHaveBeenCalledWith(root1);
      expect(docusignMocks.docusignSetWorkspace).toHaveBeenCalledWith(root1);
      expect(addeparMocks.addeparSetWorkspace).toHaveBeenCalledWith(root1);
    });

    vi.clearAllMocks();
    rerender(<Harness root={root2} />);

    await waitFor(() => {
      expect(crmMocks.crmSetWorkspace).toHaveBeenCalledWith(root2);
      expect(docusignMocks.docusignSetWorkspace).toHaveBeenCalledWith(root2);
      expect(addeparMocks.addeparSetWorkspace).toHaveBeenCalledWith(root2);
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

  it('a docusignSetWorkspace failure does not break the rest of workspace wiring', async () => {
    // The DocuSign connector is optional; if its setup throws, file-watching
    // and memory indexing must still be wired for the user.
    docusignMocks.docusignSetWorkspace.mockRejectedValueOnce(new Error('docusign backend unavailable'));
    const root = '/home/user/Northcrest';
    render(<Harness root={root} />);

    await waitFor(() => {
      expect(tauriCmdMocks.watchWorkspace).toHaveBeenCalledWith(root);
    });
  });

  it('an addeparSetWorkspace failure does not break the rest of workspace wiring', async () => {
    addeparMocks.addeparSetWorkspace.mockRejectedValueOnce(new Error('addepar backend unavailable'));
    const root = '/home/user/Northcrest';
    render(<Harness root={root} />);

    await waitFor(() => {
      expect(tauriCmdMocks.watchWorkspace).toHaveBeenCalledWith(root);
    });
  });

  it('QA-19 P2 (codex-review follow-up): a workspace closed/switched WHILE essential wiring is still installing never runs connector setup with the stale rootPath', async () => {
    // Root cause: `if (cancelled) { stop(); } else { unlisten = stop; }`
    // fell through into the optional connector setup below regardless of
    // `cancelled` — a workspace torn down mid-install would still fire
    // mailSetWorkspace/crmSetWorkspace/etc. with THIS closure's stale
    // rootPath, racing whatever workspace opens next and potentially leaving
    // connector state on the Rust side pointing at an inactive workspace.
    let resolveWatch: (() => void) | undefined;
    tauriCmdMocks.watchWorkspace.mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveWatch = resolve; }),
    );
    const unlistenSpy = vi.fn();
    eventMocks.listen.mockResolvedValueOnce(unlistenSpy);

    const root = '/home/user/Northcrest';
    const { unmount } = render(<Harness root={root} />);

    // Essential wiring has started and is now blocked on watchWorkspace.
    await waitFor(() => {
      expect(tauriCmdMocks.watchWorkspace).toHaveBeenCalledWith(root);
    });

    // The workspace closes/switches WHILE essential wiring is still in flight.
    unmount();

    // ...and only THEN does watchWorkspace (and the listener registration
    // inside installEssentialWorkspaceWiring) finish.
    resolveWatch?.();

    // Wait for the now-cancelled effect to reach its `if (cancelled) { stop();
    // return; }` branch and actually call stop() — proof the async chain
    // drained past that check, so the negative assertions below are not just
    // "hasn't happened yet".
    await waitFor(() => {
      expect(unlistenSpy).toHaveBeenCalledTimes(1);
    });

    expect(mailMocks.mailSetWorkspace).not.toHaveBeenCalled();
    expect(crmMocks.crmSetWorkspace).not.toHaveBeenCalled();
    expect(docusignMocks.docusignSetWorkspace).not.toHaveBeenCalled();
    expect(addeparMocks.addeparSetWorkspace).not.toHaveBeenCalled();
    expect(calendlyMocks.calendlySetWorkspace).not.toHaveBeenCalled();
    // The MODEL_DOWNLOAD_EVENT listener is only registered AFTER the
    // connector block — never reached either, so `listen` was called exactly
    // once (for workspace-file-changed).
    expect(eventMocks.listen).toHaveBeenCalledTimes(1);
  });
});
