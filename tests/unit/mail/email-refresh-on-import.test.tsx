/**
 * Bug C regression: imported mail must appear in the Email tab without a manual
 * filter change.
 *
 * The connectors live in a SEPARATE window from the Email tab, so a sync writes
 * hundreds of messages into the shared encrypted store while this window's list
 * still shows the pre-import (empty) state. The tab now re-queries the message
 * list when (a) a mail sync completes (the 'done' progress event) or (b) the
 * window regains focus. These tests pin both triggers — and that a mid-sync
 * 'syncing' tick does NOT cause a spurious re-query.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

// Capture the sync-progress listener so the test can fire a terminal event.
type SyncEvt = { payload: { status: string; provider: string; written: number; removed: number } };
let syncHandler: ((e: SyncEvt) => void) | null = null;
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((_event: string, handler: (e: SyncEvt) => void) => {
    syncHandler = handler;
    return Promise.resolve(() => { syncHandler = null; });
  }),
}));
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/platform/utils/mail-commands', () => ({
  mailListMessages: vi.fn(),
  mailGetMessage: vi.fn(),
  mailConnectedAccounts: vi.fn(),
  mailRetagFolderMatter: vi.fn(),
  mailRetagMessageMatter: vi.fn(),
  mailSend: vi.fn(),
  mailSyncAll: vi.fn().mockResolvedValue(undefined),
  MAIL_SYNC_EVENT: 'mail-sync-progress',
}));
vi.mock('@/platform/client-context', () => ({
  useSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
  readSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
}));
vi.mock('@/platform/matter/matterStore', () => ({
  useActiveMatter: vi.fn(() => null),
  useMatters: vi.fn(() => []),
  useMatterStore: vi.fn(),
  getMatters: vi.fn().mockReturnValue([]),
}));
vi.mock('@/platform/rag/matterResolver', () => ({
  buildMailMatterMap: vi.fn().mockReturnValue([]),
  matterLabel: vi.fn((m: { name: string }) => m.name),
}));
vi.mock('@/platform/firm/privilegeStore', () => ({
  usePrivilegeStore: vi.fn(() => vi.fn()),
  usePrivilegeForSource: vi.fn(() => 'none'),
}));
vi.mock('@/platform/rag/MemoryService', () => ({
  MemoryService: { retrieve: vi.fn().mockResolvedValue([]) },
  isMemoryEnabled: vi.fn(() => true),
}));
vi.mock('@/platform/utils/diagnostics', () => ({
  sendDiagnosticEvent: vi.fn().mockResolvedValue(undefined),
}));

import { mailListMessages, mailGetMessage, mailConnectedAccounts } from '@/platform/utils/mail-commands';
import { EmailWorkspace } from '@/features/email/EmailWorkspace';

const mockList = mailListMessages as ReturnType<typeof vi.fn>;
const mockMailGetMessage = mailGetMessage as unknown as ReturnType<typeof vi.fn>;
const mockAccounts = mailConnectedAccounts as ReturnType<typeof vi.fn>;

const IMPORTED_ITEM = {
  id: 'g1', subject: 'Imported message', fromAddr: 'a@b.com', fromName: 'A',
  snippet: 's', receivedDateTime: '2026-06-17T00:00:00Z', provider: 'gmail',
  account: 'default', folderId: 'INBOX', hasAttachments: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  syncHandler = null;
  vi.useFakeTimers();
  mockAccounts.mockResolvedValue([{ provider: 'gmail', account: 'default', label: 'Gmail' }]);
  // Initial load: nothing imported yet (the bug's starting state).
  mockList.mockResolvedValue({ items: [], total: 0 });
  mockMailGetMessage.mockImplementation((sourceId: string) => {
    const id = sourceId.startsWith('mail:') ? sourceId.slice('mail:'.length) : sourceId;
    return Promise.resolve({
      id,
      subject: IMPORTED_ITEM.subject,
      from: `${IMPORTED_ITEM.fromName} <${IMPORTED_ITEM.fromAddr}>`,
      to: ['advisor@example.com'],
      cc: [],
      date: IMPORTED_ITEM.receivedDateTime,
      provider: IMPORTED_ITEM.provider,
      account: IMPORTED_ITEM.account,
      body: IMPORTED_ITEM.snippet,
      hasAttachments: IMPORTED_ITEM.hasAttachments,
      attachments: [],
      matterId: null,
    });
  });
});

async function waitForInitialLoad() {
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
}

describe('EmailWorkspace refreshes after an import (Bug C)', () => {
  it('re-queries the message list when a mail sync completes', async () => {
    render(<EmailWorkspace />);
    await waitForInitialLoad();
    expect(syncHandler).toBeTypeOf('function');
    const callsAfterLoad = mockList.mock.calls.length;

    // The import has now landed messages; the next query returns them.
    mockList.mockResolvedValue({ items: [IMPORTED_ITEM], total: 368 });
    // Fire the terminal sync event (flush the resulting state update)...
    await act(async () => {
      syncHandler!({ payload: { status: 'done', provider: 'gmail', written: 368, removed: 0 } });
    });
    // ...then let the re-query's debounce elapse.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(mockList.mock.calls.length).toBeGreaterThan(callsAfterLoad);
    expect(screen.getAllByText('Imported message').length).toBeGreaterThan(0);
  });

  it('re-queries the message list when the window regains focus', async () => {
    render(<EmailWorkspace />);
    await waitForInitialLoad();
    const callsAfterLoad = mockList.mock.calls.length;

    mockList.mockResolvedValue({ items: [IMPORTED_ITEM], total: 368 });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(mockList.mock.calls.length).toBeGreaterThan(callsAfterLoad);
    expect(screen.getAllByText('Imported message').length).toBeGreaterThan(0);
  });

  it('does NOT re-query on a non-terminal "syncing" tick', async () => {
    render(<EmailWorkspace />);
    await waitForInitialLoad();
    const callsAfterLoad = mockList.mock.calls.length;

    await act(async () => {
      syncHandler!({ payload: { status: 'syncing', provider: 'gmail', written: 10, removed: 0 } });
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(mockList.mock.calls.length).toBe(callsAfterLoad);
  });
});
