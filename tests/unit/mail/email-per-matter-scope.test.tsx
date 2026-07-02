/**
 * F2.6b — the embedded (per-client) Email tab must scope in the BACKEND.
 *
 * These tests lock in the isolation fix: when EmailWorkspace is embedded with an
 * active client, it calls `mailListMessagesByMatter` (which enforces per-client
 * isolation in the engine) and renders exactly what the backend returns — never
 * the unscoped `mailListMessages`, and never a client-side filter of a global
 * page. The non-embedded surface must still use the unscoped list.
 *
 * Timer pattern mirrors ReimaginedEmailWorkspace.test.tsx.
 */

/// <reference types="@testing-library/jest-dom" />
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

// ── Module mocks ────────────────────────────────────────────────────────────

vi.mock('@/platform/utils/mail-commands', () => ({
  mailListMessages: vi.fn(),
  mailListMessagesByMatter: vi.fn(),
  mailGetMessage: vi.fn(),
  mailConnectedAccounts: vi.fn(),
  mailRetagFolderMatter: vi.fn(),
  mailRetagMessageMatter: vi.fn(),
  mailSend: vi.fn(),
  mailSyncAll: vi.fn().mockResolvedValue(undefined),
  MAIL_SYNC_EVENT: 'mail-sync-progress',
  MAIL_INDEX_CHUNK_EVENT: 'mail-index-chunk',
}));

vi.mock('@/platform/matter/matterStore', () => ({
  useActiveMatter: vi.fn(),
  useMatters: vi.fn(),
  useMatterStore: vi.fn(),
  getMatters: vi.fn().mockReturnValue([]),
}));

vi.mock('@/platform/firm/privilegeStore', () => ({
  usePrivilegeStore: vi.fn(),
  usePrivilegeForSource: vi.fn(),
}));

vi.mock('@/platform/rag/MemoryService', () => ({
  MemoryService: { retrieve: vi.fn() },
  isMemoryEnabled: vi.fn(),
}));

vi.mock('@/platform/rag/matterResolver', () => ({
  buildMailMatterMap: vi.fn().mockReturnValue([
    { provider: 'm365', account: 'default', folderId: 'inbox', matterId: 'matter-1' },
  ]),
  matterLabel: vi.fn((m: { name: string }) => m.name),
}));

// ── Imports after mocks ─────────────────────────────────────────────────────

import {
  mailListMessages,
  mailListMessagesByMatter,
  mailConnectedAccounts,
} from '@/platform/utils/mail-commands';
import { useActiveMatter, useMatters, getMatters } from '@/platform/matter/matterStore';
import { usePrivilegeStore, usePrivilegeForSource } from '@/platform/firm/privilegeStore';
import { MemoryService, isMemoryEnabled } from '@/platform/rag/MemoryService';
import { EmailWorkspace } from '@/features/email/EmailWorkspace';

// ── Fixture data ────────────────────────────────────────────────────────────

const FIXTURE_ACCOUNTS = [{ provider: 'm365', account: 'default', label: 'Work' }];

const ACTIVE_MATTER = { id: 'matter-1', name: 'Acme Corp', client: 'Acme Corp', folderPaths: [], createdAt: '2026-01-01T00:00:00Z' };
const FIXTURE_MATTERS = [ACTIVE_MATTER, { id: 'matter-2', name: 'Gamma Inc', client: 'Gamma Inc', folderPaths: [], createdAt: '2026-02-01T00:00:00Z' }];

// The backend-scoped call returns ONLY this client's mail (including a message
// whose folder maps elsewhere but was manually filed here — the engine resolved
// it). The client-side path could never have surfaced that message.
const SCOPED_ITEMS = [
  { id: 'msg-acme-1', subject: 'Annual review agenda', fromAddr: 'a@acme.com', fromName: 'Acme', snippet: 'agenda', receivedDateTime: '2026-06-10T09:00:00Z', provider: 'm365', account: 'default', folderId: 'inbox', hasAttachments: false },
  { id: 'msg-acme-filed', subject: 'Beneficiary form (filed here)', fromAddr: 'b@other.com', fromName: 'Other', snippet: 'filed', receivedDateTime: '2026-06-09T09:00:00Z', provider: 'gmail', account: 'default', folderId: 'INBOX', hasAttachments: true },
];

const GLOBAL_ITEMS = [
  { id: 'msg-global', subject: 'Some other client mail', fromAddr: 'x@y.com', fromName: 'X', snippet: 's', receivedDateTime: '2026-06-08T09:00:00Z', provider: 'm365', account: 'default', folderId: 'inbox', hasAttachments: false },
];

// ── Typed mock helpers ──────────────────────────────────────────────────────

const mockList = mailListMessages as ReturnType<typeof vi.fn>;
const mockListByMatter = mailListMessagesByMatter as ReturnType<typeof vi.fn>;
const mockConnected = mailConnectedAccounts as ReturnType<typeof vi.fn>;
const mockUseActiveMatter = useActiveMatter as ReturnType<typeof vi.fn>;
const mockUseMatters = useMatters as ReturnType<typeof vi.fn>;
const mockGetMatters = getMatters as ReturnType<typeof vi.fn>;
const mockMemoryRetrieve = MemoryService.retrieve as ReturnType<typeof vi.fn>;
const mockIsMemoryEnabled = isMemoryEnabled as ReturnType<typeof vi.fn>;

function setupMocks() {
  vi.clearAllMocks();
  mockConnected.mockResolvedValue(FIXTURE_ACCOUNTS);
  mockList.mockResolvedValue({ items: GLOBAL_ITEMS, total: GLOBAL_ITEMS.length });
  mockListByMatter.mockResolvedValue({ items: SCOPED_ITEMS, total: SCOPED_ITEMS.length });
  mockUseActiveMatter.mockReturnValue(ACTIVE_MATTER);
  mockUseMatters.mockReturnValue(FIXTURE_MATTERS);
  mockGetMatters.mockReturnValue(FIXTURE_MATTERS);
  (usePrivilegeStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue(vi.fn());
  (usePrivilegeForSource as ReturnType<typeof vi.fn>).mockReturnValue('none');
  mockIsMemoryEnabled.mockReturnValue(true);
  mockMemoryRetrieve.mockResolvedValue([]);
}

async function waitForInitialLoad() {
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
}

beforeEach(() => {
  setupMocks();
  vi.useFakeTimers();
});

describe('EmailWorkspace per-client backend scoping (F2.6b)', () => {
  it('embedded mode calls mailListMessagesByMatter and never the unscoped list', async () => {
    render(<EmailWorkspace embedded />);
    await waitForInitialLoad();

    expect(mockListByMatter).toHaveBeenCalled();
    // The active client's id and the folder→matter map are forwarded to the engine.
    const [matterId, map] = mockListByMatter.mock.calls[0]!;
    expect(matterId).toBe('matter-1');
    expect(Array.isArray(map)).toBe(true);
    // The unscoped global browse must NOT be used in embedded mode.
    expect(mockList).not.toHaveBeenCalled();
  });

  it('embedded mode renders exactly the backend-scoped rows (incl. a message filed here from another folder)', async () => {
    render(<EmailWorkspace embedded />);
    await waitForInitialLoad();

    const rows = screen.getAllByTestId('mail-row');
    expect(rows).toHaveLength(SCOPED_ITEMS.length);
    expect(screen.getByText('Annual review agenda')).toBeInTheDocument();
    // The per-message-filed mail whose folder maps ELSEWHERE still shows — proof
    // the engine (not a client-side folder filter) decided membership.
    expect(screen.getByText('Beneficiary form (filed here)')).toBeInTheDocument();
    // No global-client mail leaks in.
    expect(screen.queryByText('Some other client mail')).not.toBeInTheDocument();
  });

  it('embedded mode FAILS CLOSED when no client is active — never calls the global list', async () => {
    // A momentarily-null active matter must NOT fall back to the unscoped list;
    // that would render another client's mail inside a client tab.
    mockUseActiveMatter.mockReturnValue(null);
    render(<EmailWorkspace embedded />);
    await waitForInitialLoad();

    expect(mockList).not.toHaveBeenCalled();
    expect(mockListByMatter).not.toHaveBeenCalled();
    expect(screen.queryByText('Some other client mail')).not.toBeInTheDocument();
  });

  it('embedded mode hides already-loaded rows the instant the active client disappears', async () => {
    // Load this client's mail, then simulate activeMatter going null (stale/mid-
    // switch). The previously-rendered rows must vanish immediately — not linger
    // until the debounced refetch clears them.
    const { rerender } = render(<EmailWorkspace embedded />);
    await waitForInitialLoad();
    expect(screen.getByText('Annual review agenda')).toBeInTheDocument();

    mockUseActiveMatter.mockReturnValue(null);
    await act(async () => {
      rerender(<EmailWorkspace embedded />);
    });
    expect(screen.queryByText('Annual review agenda')).not.toBeInTheDocument();
    expect(screen.queryByText('Beneficiary form (filed here)')).not.toBeInTheDocument();
  });

  it('embedded AI search scopes retrieval to the active client, never allMatters', async () => {
    render(<EmailWorkspace embedded />);
    await waitForInitialLoad();

    // Switch to AI search mode and type a query.
    fireEvent.click(screen.getByTestId('mode-ask'));
    fireEvent.change(screen.getByTestId('email-search-input'), { target: { value: 'beneficiary' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });

    expect(mockMemoryRetrieve).toHaveBeenCalled();
    // The retrieval scope must be this client's matter — never { kind: 'allMatters' }.
    for (const call of mockMemoryRetrieve.mock.calls) {
      expect(call[2]).toEqual({ kind: 'matter', matterId: 'matter-1' });
    }
  });

  it('embedded AI search FAILS CLOSED with no active client — never retrieves', async () => {
    mockUseActiveMatter.mockReturnValue(null);
    render(<EmailWorkspace embedded />);
    await waitForInitialLoad();

    fireEvent.click(screen.getByTestId('mode-ask'));
    fireEvent.change(screen.getByTestId('email-search-input'), { target: { value: 'beneficiary' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });

    // No retrieval at all — an all-clients search must never run in a client tab.
    expect(mockMemoryRetrieve).not.toHaveBeenCalled();
  });

  it('non-embedded (global) surface still uses the unscoped mailListMessages', async () => {
    render(<EmailWorkspace />);
    await waitForInitialLoad();

    expect(mockList).toHaveBeenCalled();
    expect(mockListByMatter).not.toHaveBeenCalled();
    expect(screen.getByText('Some other client mail')).toBeInTheDocument();
  });
});
