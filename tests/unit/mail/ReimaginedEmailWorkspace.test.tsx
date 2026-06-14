/**
 * ReimaginedEmailWorkspace — unit tests.
 *
 * Tests cover:
 *   1.  Renders rows from mailListMessages results
 *   2.  Debounced keyword triggers a query after typing
 *   3.  Filters (provider, hasAttachments) get passed into the query
 *   4.  Open action dispatches keepance:open-email with correct sourceId
 *   5.  Privilege sub-component calls setPrivilege when user selects a privilege
 *   6.  File-to-matter calls mailRetagFolderMatter with correct args
 *   7.  Shows loading state when fetching
 *   8.  Shows no-results state when items is empty but accounts exist
 *   9.  Shows empty/no-accounts state when connectedAccounts returns []
 *   10. Shows error state when mailListMessages throws
 *
 * Timer pattern: vi.useFakeTimers() + vi.advanceTimersByTimeAsync(N) inside
 * act() — the async variant flushes microtasks (Promise resolutions) alongside
 * timer callbacks, which is required for async effects that use setTimeout.
 */

/// <reference types="@testing-library/jest-dom" />
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// ── Module mocks ────────────────────────────────────────────────────────────

vi.mock('@/utils/mail-commands', () => ({
  mailListMessages: vi.fn(),
  mailGetMessage: vi.fn(),
  mailConnectedAccounts: vi.fn(),
  mailRetagFolderMatter: vi.fn(),
}));

vi.mock('@/stores/matterStore', () => ({
  useActiveMatter: vi.fn(),
  useMatters: vi.fn(),
  useMatterStore: vi.fn(),
}));

vi.mock('@/stores/privilegeStore', () => ({
  usePrivilegeStore: vi.fn(),
  usePrivilegeForSource: vi.fn(),
}));

vi.mock('@/modules/memory/MemoryService', () => ({
  MemoryService: { retrieve: vi.fn() },
  isMemoryEnabled: vi.fn(),
}));

vi.mock('@/modules/memory/matterResolver', () => ({
  matterLabel: vi.fn((m: { name: string }) => m.name),
}));

// ── Imports after mocks ─────────────────────────────────────────────────────

import {
  mailListMessages,
  mailGetMessage,
  mailConnectedAccounts,
  mailRetagFolderMatter,
} from '@/utils/mail-commands';
import { useActiveMatter, useMatters } from '@/stores/matterStore';
import { usePrivilegeStore, usePrivilegeForSource } from '@/stores/privilegeStore';
import { MemoryService, isMemoryEnabled } from '@/modules/memory/MemoryService';
import { ReimaginedEmailWorkspace } from '@/components/mail/ReimaginedEmailWorkspace';

// ── Fixture data ────────────────────────────────────────────────────────────

const FIXTURE_ACCOUNTS = [{ provider: 'm365', account: 'default', label: 'Work' }];

const FIXTURE_ITEMS = [
  {
    id: 'msg-001',
    subject: 'Contract draft - please review',
    fromAddr: 'alice@example.com',
    fromName: 'Alice Chen',
    snippet: 'See attached draft for your review.',
    receivedDateTime: '2026-06-10T09:00:00Z',
    provider: 'm365',
    account: 'default',
    folderId: 'inbox',
    hasAttachments: true,
  },
  {
    id: 'msg-002',
    subject: 'Deposition schedule',
    fromAddr: 'bob@lawfirm.com',
    fromName: 'Bob Nguyen',
    snippet: 'Scheduling deposition for next Tuesday.',
    receivedDateTime: '2026-06-09T14:30:00Z',
    provider: 'm365',
    account: 'default',
    folderId: 'inbox',
    hasAttachments: false,
  },
];

const FIXTURE_MATTERS = [
  {
    id: 'matter-1',
    name: 'Acme v. Beta',
    client: 'Acme Corp',
    folderPaths: [],
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'matter-2',
    name: 'Gamma Patent',
    client: 'Gamma Inc',
    folderPaths: [],
    createdAt: '2026-02-01T00:00:00Z',
  },
];

// ── Typed mock helpers ──────────────────────────────────────────────────────

const mockMailListMessages = mailListMessages as ReturnType<typeof vi.fn>;
const mockMailGetMessage = mailGetMessage as unknown as ReturnType<typeof vi.fn>;
const mockMailConnectedAccounts = mailConnectedAccounts as ReturnType<typeof vi.fn>;
const mockMailRetagFolderMatter = mailRetagFolderMatter as ReturnType<typeof vi.fn>;
const mockUseActiveMatter = useActiveMatter as ReturnType<typeof vi.fn>;
const mockUseMatters = useMatters as ReturnType<typeof vi.fn>;
const mockUsePrivilegeForSource = usePrivilegeForSource as ReturnType<typeof vi.fn>;
const mockMemoryRetrieve = MemoryService.retrieve as ReturnType<typeof vi.fn>;
const mockIsMemoryEnabled = isMemoryEnabled as ReturnType<typeof vi.fn>;

// ── Setup ───────────────────────────────────────────────────────────────────

const mockSetPrivilege = vi.fn();

function setupDefaultMocks() {
  vi.clearAllMocks();

  mockMailConnectedAccounts.mockResolvedValue(FIXTURE_ACCOUNTS);
  mockMailListMessages.mockResolvedValue({
    items: FIXTURE_ITEMS,
    total: FIXTURE_ITEMS.length,
  });
  mockMailGetMessage.mockResolvedValue({
    id: 'msg-001',
    subject: 'Contract draft',
    from: 'Alice Chen <alice@example.com>',
    to: ['me@firm.com'],
    cc: [],
    date: '2026-06-10T09:00:00Z',
    provider: 'm365',
    body: 'See attached.',
    hasAttachments: false,
    attachments: [],
  });
  mockMailRetagFolderMatter.mockResolvedValue(1);
  mockUseActiveMatter.mockReturnValue(null);
  mockUseMatters.mockReturnValue(FIXTURE_MATTERS);
  // usePrivilegeStore is called as a selector: (s) => s.setPrivilege
  (usePrivilegeStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockSetPrivilege);
  mockUsePrivilegeForSource.mockReturnValue('none');
  mockIsMemoryEnabled.mockReturnValue(true);
  mockMemoryRetrieve.mockResolvedValue([]);
}

/** Advance fake timers far enough to flush the 200ms debounce + all promises. */
async function flushDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

/** Wait for accounts to resolve (no timers involved) then flush the debounce. */
async function waitForInitialLoad() {
  // accounts fetch is a plain Promise — one microtask flush settles it
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
  // debounce + list fetch
  await flushDebounce();
}

beforeEach(() => {
  setupDefaultMocks();
  vi.useFakeTimers();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('ReimaginedEmailWorkspace', () => {

  // 1. Renders rows from mailListMessages results
  it('renders email rows from mailListMessages results', async () => {
    render(<ReimaginedEmailWorkspace />);
    await waitForInitialLoad();

    const rows = screen.getAllByTestId('mail-row');
    expect(rows).toHaveLength(FIXTURE_ITEMS.length);
    expect(screen.getByText('Contract draft - please review')).toBeInTheDocument();
    expect(screen.getByText('Deposition schedule')).toBeInTheDocument();
  });

  // 2. Debounced keyword triggers a query after typing
  it('fires mailListMessages with the keyword after debounce', async () => {
    render(<ReimaginedEmailWorkspace />);
    await waitForInitialLoad();

    const callsBefore = mockMailListMessages.mock.calls.length;

    // Type a keyword
    const input = screen.getByTestId('email-search-input');
    fireEvent.change(input, { target: { value: 'deposition' } });

    // Advance only a little — debounce not yet elapsed
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(mockMailListMessages.mock.calls.length).toBe(callsBefore);

    // Now flush the rest
    await flushDebounce();

    const lastCall = mockMailListMessages.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    expect(lastCall![0]).toMatchObject({ keyword: 'deposition' });
  });

  // 3. Filters (provider, hasAttachments) get passed into the query
  it('passes provider and hasAttachments filters into the query', async () => {
    // Two providers so the select renders
    mockMailConnectedAccounts.mockResolvedValue([
      { provider: 'm365', account: 'default', label: 'Work' },
      { provider: 'gmail', account: 'personal', label: 'Personal' },
    ]);

    render(<ReimaginedEmailWorkspace />);
    await waitForInitialLoad();

    // Change provider filter
    const providerSelect = screen.getByTestId('provider-filter');
    fireEvent.change(providerSelect, { target: { value: 'm365' } });
    await flushDebounce();

    let lastCall = mockMailListMessages.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    expect(lastCall![0]).toMatchObject({ provider: 'm365' });

    // Toggle attachment filter
    const attachmentCheckbox = screen.getByTestId('attachment-filter');
    fireEvent.click(attachmentCheckbox);
    await flushDebounce();

    lastCall = mockMailListMessages.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    expect(lastCall![0]).toMatchObject({ hasAttachments: true });
  });

  // 4. Open action dispatches keepance:open-email with correct sourceId
  it('dispatches keepance:open-email with the correct sourceId when row is clicked', async () => {
    render(<ReimaginedEmailWorkspace />);
    await waitForInitialLoad();

    const dispatched: CustomEvent[] = [];
    const listener = (e: Event) => { dispatched.push(e as CustomEvent); };
    window.addEventListener('keepance:open-email', listener);

    const rows = screen.getAllByTestId('mail-row');
    expect(rows[0]).toBeDefined();
    fireEvent.click(rows[0]!);

    window.removeEventListener('keepance:open-email', listener);

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.detail).toEqual({ sourceId: 'mail:msg-001' });
  });

  // 5. Privilege sub-component calls setPrivilege when user selects a privilege
  it('calls setPrivilege when a privilege option is selected from the dropdown', async () => {
    render(<ReimaginedEmailWorkspace />);
    await waitForInitialLoad();

    const rows = screen.getAllByTestId('mail-row');
    expect(rows[0]).toBeDefined();
    // Hover to reveal row actions
    fireEvent.mouseEnter(rows[0]!);

    // Open privilege dropdown
    const privilegeBtn = rows[0]!.querySelector('button[title="Set privilege"]');
    expect(privilegeBtn).toBeTruthy();
    fireEvent.click(privilegeBtn!);

    // Select attorney-client option
    const acOption = screen.getByTestId('privilege-option-attorney-client');
    fireEvent.click(acOption);

    expect(mockSetPrivilege).toHaveBeenCalledWith('mail:msg-001', 'attorney-client');
  });

  // 6. File-to-matter calls mailRetagFolderMatter with correct args
  it('calls mailRetagFolderMatter with correct args when a matter is chosen', async () => {
    render(<ReimaginedEmailWorkspace />);
    await waitForInitialLoad();

    const rows = screen.getAllByTestId('mail-row');
    expect(rows[0]).toBeDefined();
    fireEvent.mouseEnter(rows[0]!);

    const fileBtn = screen.getByTestId('file-to-matter-msg-001');
    fireEvent.click(fileBtn);

    // Matter picker renders; click the first matter
    const matterBtn = screen.getByText('Acme v. Beta');
    fireEvent.click(matterBtn);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(mockMailRetagFolderMatter).toHaveBeenCalledWith(
      'm365',
      'default',
      'inbox',
      'matter-1',
    );
  });

  // 7. Shows loading state when fetching
  it('shows loading state while mailListMessages is in flight', async () => {
    let resolveList!: (v: { items: typeof FIXTURE_ITEMS; total: number }) => void;
    mockMailListMessages.mockImplementation(
      () => new Promise((res) => { resolveList = res; }),
    );

    render(<ReimaginedEmailWorkspace />);

    // Accounts settle, debounce fires, list call is in flight
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });

    expect(screen.getByTestId('loading-state')).toBeInTheDocument();

    // Resolve the list
    await act(async () => {
      resolveList({ items: FIXTURE_ITEMS, total: FIXTURE_ITEMS.length });
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(screen.queryByTestId('loading-state')).not.toBeInTheDocument();
  });

  // 8. Shows no-results state when items is empty but accounts exist
  it('shows no-results state when mailListMessages returns empty items', async () => {
    mockMailListMessages.mockResolvedValue({ items: [], total: 0 });

    render(<ReimaginedEmailWorkspace />);
    await waitForInitialLoad();

    expect(screen.getByTestId('no-results-state')).toBeInTheDocument();
    expect(screen.queryByTestId('no-accounts-state')).not.toBeInTheDocument();
  });

  // 9. Shows empty/no-accounts state when connectedAccounts returns []
  it('shows no-accounts state and connect CTA when connectedAccounts is empty', async () => {
    mockMailConnectedAccounts.mockResolvedValue([]);

    const onOpenSettings = vi.fn();
    render(<ReimaginedEmailWorkspace onOpenSettings={onOpenSettings} />);

    // Only accounts fetch fires here - no debounce needed
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });

    expect(screen.getByTestId('no-accounts-state')).toBeInTheDocument();
    expect(screen.getByText('Connect your email')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Connect your email'));
    expect(onOpenSettings).toHaveBeenCalledOnce();

    expect(mockMailListMessages).not.toHaveBeenCalled();
  });

  // 10. Shows error state when mailListMessages throws
  it('shows error state when mailListMessages rejects', async () => {
    mockMailListMessages.mockRejectedValue(new Error('Network error'));

    render(<ReimaginedEmailWorkspace />);
    await waitForInitialLoad();

    expect(screen.getByTestId('error-state')).toBeInTheDocument();
    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

});
