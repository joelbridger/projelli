/**
 * BUG-007 — Connected mail account never syncs after app restart.
 *
 * Tests:
 *   (a) On mount with a connected account, mailSyncAll is called once automatically.
 *   (b) Clicking the "Sync now" button calls mailSyncAll.
 *   (c) "Sync now" button is disabled while a sync is in flight.
 *   (d) No auto-sync fires when there are no connected accounts.
 */

/// <reference types="@testing-library/jest-dom" />
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// ── Module mocks ────────────────────────────────────────────────────────────

const eventMock = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock('@/platform/utils/mail-commands', () => ({
  mailListMessages: vi.fn(),
  mailGetMessage: vi.fn(),
  mailConnectedAccounts: vi.fn(),
  mailRetagFolderMatter: vi.fn(),
  mailRetagMessageMatter: vi.fn(),
  mailSend: vi.fn(),
  mailSyncAll: vi.fn(),
  mailCancelSync: vi.fn().mockResolvedValue(undefined),
  MAIL_SYNC_EVENT: 'mail-sync-progress',
  MAIL_INDEX_CHUNK_EVENT: 'mail-index-chunk',
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((eventName: string, handler: (event: { payload: unknown }) => void) => {
    eventMock.handlers.set(eventName, handler);
    return Promise.resolve(() => {});
  }),
}));

vi.mock('@/platform/client-context', () => ({
  useSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
  readSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
}));
vi.mock('@/platform/matter/matterStore', () => ({
  useActiveMatter: vi.fn().mockReturnValue(null),
  useMatters: vi.fn().mockReturnValue([]),
  getMatters: vi.fn().mockReturnValue([]),
}));

vi.mock('@/platform/rag/matterResolver', () => ({
  buildMailMatterMap: vi.fn().mockReturnValue([]),
  matterLabel: vi.fn((m: { name: string }) => m.name),
}));

vi.mock('@/platform/firm/privilegeStore', () => ({
  usePrivilegeStore: vi.fn().mockReturnValue(vi.fn()),
  usePrivilegeForSource: vi.fn().mockReturnValue('none'),
}));

vi.mock('@/platform/rag/MemoryService', () => ({
  MemoryService: { retrieve: vi.fn().mockResolvedValue([]) },
  isMemoryEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/platform/utils/diagnostics', () => ({
  sendDiagnosticEvent: vi.fn().mockResolvedValue(undefined),
}));

// ── Imports after mocks ─────────────────────────────────────────────────────

import {
  mailListMessages,
  mailConnectedAccounts,
  mailSyncAll,
  mailCancelSync,
} from '@/platform/utils/mail-commands';
import { buildMailMatterMap } from '@/platform/rag/matterResolver';
import { getMatters } from '@/platform/matter/matterStore';
import { EmailWorkspace } from '@/features/email/EmailWorkspace';

// ── Typed mock helpers ──────────────────────────────────────────────────────

const mockMailListMessages = mailListMessages as ReturnType<typeof vi.fn>;
const mockMailConnectedAccounts = mailConnectedAccounts as ReturnType<typeof vi.fn>;
const mockMailSyncAll = mailSyncAll as ReturnType<typeof vi.fn>;
const mockMailCancelSync = mailCancelSync as ReturnType<typeof vi.fn>;
const mockBuildMailMatterMap = buildMailMatterMap as ReturnType<typeof vi.fn>;
const mockGetMatters = vi.mocked(getMatters);

// ── Fixtures ────────────────────────────────────────────────────────────────

const FIXTURE_ACCOUNTS = [{ provider: 'm365', account: 'default', label: 'Work' }];

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  eventMock.handlers.clear();

  mockMailConnectedAccounts.mockResolvedValue(FIXTURE_ACCOUNTS);
  mockMailListMessages.mockResolvedValue({ items: [], total: 0 });
  // mailSyncAll resolves immediately by default (simulates a fast sync)
  mockMailSyncAll.mockResolvedValue(undefined);
  mockMailCancelSync.mockResolvedValue(undefined);
  mockBuildMailMatterMap.mockReturnValue([]);
  mockGetMatters.mockReturnValue([]);
});

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Wait for the accounts fetch to resolve, then flush the debounce. */
async function waitForInitialLoad() {
  // accounts fetch: plain Promise, one microtask flush
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
  // debounce (200 ms) + list fetch
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

async function openEmailActionsMenu() {
  fireEvent.pointerDown(screen.getByTestId('email-more-actions'), { button: 0 });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function getSyncMenuItem() {
  let syncItem = screen.queryByTestId('email-sync-now');
  if (!syncItem) {
    await openEmailActionsMenu();
    syncItem = screen.getByTestId('email-sync-now');
  }
  return syncItem;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('BUG-007: startup sync + manual Sync now', () => {

  // (a) Auto-sync fires on mount when accounts are connected
  it('(a) calls mailSyncAll once on mount when a connected account is found', async () => {
    render(<EmailWorkspace />);
    await waitForInitialLoad();

    // Should have been called exactly once (startup sync)
    expect(mockMailSyncAll).toHaveBeenCalledTimes(1);
    // Called with the matter map built from getMatters()
    expect(mockBuildMailMatterMap).toHaveBeenCalledWith(mockGetMatters());
  });

  // (b) Clicking "Sync now" button calls mailSyncAll
  it('(b) clicking "Sync now" button calls mailSyncAll', async () => {
    // Make startup sync resolve immediately so syncing=false before we click
    mockMailSyncAll.mockResolvedValue(undefined);

    render(<EmailWorkspace />);
    await waitForInitialLoad();

    // One call from startup sync already happened
    const callsBefore = mockMailSyncAll.mock.calls.length;

    // The "Sync now" action now lives in the rail overflow menu.
    const syncBtn = await getSyncMenuItem();
    expect(syncBtn).toBeInTheDocument();

    // Click it
    await act(async () => {
      fireEvent.click(syncBtn);
      await vi.advanceTimersByTimeAsync(50);
    });

    // Should have fired once more
    expect(mockMailSyncAll.mock.calls.length).toBe(callsBefore + 1);
  });

  // (c) "Sync now" is disabled while a sync is in flight
  it('(c) "Sync now" button is disabled while syncing', async () => {
    // Hold the startup sync promise open so syncing stays true
    let resolveSync!: () => void;
    mockMailSyncAll.mockImplementation(
      () => new Promise<void>((res) => { resolveSync = res; }),
    );

    render(<EmailWorkspace />);

    // Accounts resolve — startup sync kicks off
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    // Sync button should now be disabled (sync is in flight)
    const syncBtn = await getSyncMenuItem();
    expect(syncBtn).toHaveAttribute('data-disabled');

    // Resolve the sync and check button is re-enabled
    await act(async () => {
      resolveSync();
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(await getSyncMenuItem()).not.toHaveAttribute('data-disabled');
  });

  // (d) No auto-sync fires when there are no connected accounts
  it('(d) does NOT call mailSyncAll when connectedAccounts returns empty', async () => {
    mockMailConnectedAccounts.mockResolvedValue([]);

    render(<EmailWorkspace />);
    await waitForInitialLoad();

    expect(mockMailSyncAll).not.toHaveBeenCalled();
  });

  // (e) A sync that never resolves no longer leaves "Syncing…" stuck forever:
  // a stall warning appears first, then the hard timeout resets the button
  // and surfaces a clear error.
  it('(e) recovers from a sync that never resolves: stall warning, then hard-timeout reset', async () => {
    mockMailSyncAll.mockImplementation(() => new Promise<void>(() => {})); // never resolves

    render(<EmailWorkspace />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    const syncBtn = await getSyncMenuItem();
    expect(syncBtn).toHaveAttribute('data-disabled');
    expect(screen.queryByTestId('email-sync-stalled')).not.toBeInTheDocument();

    // Before the 90s stall threshold: still syncing, no warning yet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(89_000);
    });
    expect(screen.queryByTestId('email-sync-stalled')).not.toBeInTheDocument();
    expect(syncBtn).toHaveAttribute('data-disabled');

    // Past the 90s stall threshold: warning shows, button still disabled
    // (the sync may still legitimately finish).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(screen.getByTestId('email-sync-stalled')).toBeInTheDocument();
    expect(await getSyncMenuItem()).toHaveAttribute('data-disabled');

    // Past the hard timeout (5 min total): the button resets and a clear
    // error is shown instead of spinning forever.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(await getSyncMenuItem()).not.toHaveAttribute('data-disabled');
    expect(screen.getByTestId('email-sync-error')).toBeInTheDocument();

    // The backend sync must actually be told to stop — otherwise it keeps
    // holding the single-sync guard and the next click fails with "a sync
    // is already in progress" even though the button looks idle again.
    expect(mockMailCancelSync).toHaveBeenCalled();
  });

  // (f) The cancel call itself must not be able to re-block the UI: even if
  // mailCancelSync() also hangs (same dead backend/IPC), the hard timeout's
  // guarantee that the button recovers must still hold.
  it('(f) the button recovers even if mailCancelSync() itself never resolves', async () => {
    mockMailSyncAll.mockImplementation(() => new Promise<void>(() => {})); // never resolves
    mockMailCancelSync.mockImplementation(() => new Promise<void>(() => {})); // never resolves either

    render(<EmailWorkspace />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });

    expect(await getSyncMenuItem()).not.toHaveAttribute('data-disabled');
    expect(screen.getByTestId('email-sync-error')).toBeInTheDocument();
    expect(mockMailCancelSync).toHaveBeenCalled();
  });

  it('(g) shows the live imported-message count while email is syncing', async () => {
    mockMailSyncAll.mockImplementation(() => new Promise<void>(() => {}));

    render(<EmailWorkspace />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    const syncBtn = await getSyncMenuItem();
    expect(syncBtn).toHaveAttribute('data-disabled');

    await act(async () => {
      eventMock.handlers.get('mail-sync-progress')?.({
        payload: {
          status: 'syncing',
          provider: 'm365',
          folder: null,
          written: 42,
          removed: 0,
        },
      });
    });

    expect(await getSyncMenuItem()).toHaveTextContent('Importing 42 messages');
  });

  it('(h) keeps Sync now disabled until the whole all-provider sync finishes', async () => {
    mockMailConnectedAccounts.mockResolvedValue([
      { provider: 'm365', account: 'default', label: 'Work' },
      { provider: 'gmail', account: 'personal', label: 'Personal' },
    ]);

    let resolveSync!: () => void;
    mockMailSyncAll.mockImplementation(
      () => new Promise<void>((res) => { resolveSync = res; }),
    );

    render(<EmailWorkspace />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(await getSyncMenuItem()).toHaveAttribute('data-disabled');

    await act(async () => {
      eventMock.handlers.get('mail-sync-progress')?.({
        payload: {
          status: 'done',
          provider: 'm365',
          folder: null,
          written: 12,
          removed: 0,
        },
      });
    });

    expect(await getSyncMenuItem()).toHaveAttribute('data-disabled');

    await act(async () => {
      resolveSync();
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(await getSyncMenuItem()).not.toHaveAttribute('data-disabled');
  });

});
