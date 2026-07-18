/**
 * EmailWorkspace — unit tests.
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
import { render, screen, fireEvent, act, within } from '@testing-library/react';

// ── Module mocks ────────────────────────────────────────────────────────────

vi.mock('@/platform/utils/mail-commands', () => ({
  mailListMessages: vi.fn(),
  mailGetMessage: vi.fn(),
  mailConnectedAccounts: vi.fn(),
  mailRetagFolderMatter: vi.fn(),
  mailRetagMessageMatter: vi.fn(),
  mailSend: vi.fn(),
  mailGetAttachment: vi.fn(),
  mailSyncAll: vi.fn().mockResolvedValue(undefined),
  MAIL_SYNC_EVENT: 'mail-sync-progress',
  MAIL_INDEX_CHUNK_EVENT: 'mail-index-chunk',
}));

vi.mock('@/platform/client-context', () => ({
  useSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
  readSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
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
  buildMailMatterMap: vi.fn().mockReturnValue([]),
  matterLabel: vi.fn((m: { name: string }) => m.name),
}));

// ── Imports after mocks ─────────────────────────────────────────────────────

import {
  mailListMessages,
  mailGetMessage,
  mailConnectedAccounts,
  mailRetagFolderMatter,
  mailRetagMessageMatter,
  mailSend,
} from '@/platform/utils/mail-commands';
import { useActiveMatter, useMatters } from '@/platform/matter/matterStore';
import { usePrivilegeStore, usePrivilegeForSource } from '@/platform/firm/privilegeStore';
import { MemoryService, isMemoryEnabled } from '@/platform/rag/MemoryService';
import { EmailWorkspace } from '@/features/email/EmailWorkspace';
import { EV_OPEN_SETTINGS } from '@/config/identity';

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
const mockMailRetagMessageMatter = mailRetagMessageMatter as ReturnType<typeof vi.fn>;
const mockMailSend = mailSend as unknown as ReturnType<typeof vi.fn>;
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
  mockMailGetMessage.mockImplementation((sourceId: string) => {
    const id = sourceId.startsWith('mail:') ? sourceId.slice('mail:'.length) : sourceId;
    const item = FIXTURE_ITEMS.find((candidate) => candidate.id === id) ?? FIXTURE_ITEMS[0]!;
    return Promise.resolve({
      id: item.id,
      subject: item.subject,
      from: item.fromName ? `${item.fromName} <${item.fromAddr}>` : item.fromAddr,
      to: ['me@firm.com'],
      cc: [],
      date: item.receivedDateTime,
      provider: item.provider,
      account: item.account,
      body: item.snippet,
      hasAttachments: item.hasAttachments,
      attachments: [],
      matterId: null,
    });
  });
  mockMailRetagFolderMatter.mockResolvedValue(1);
  mockMailRetagMessageMatter.mockResolvedValue(undefined);
  mockMailSend.mockResolvedValue('sent-ok');
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

async function flushEmailDetail() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
}

function openEmailSearch(): HTMLElement {
  const existing = screen.queryByTestId('email-search-input');
  if (existing) return existing;
  fireEvent.click(screen.getByTestId('email-search-input-toggle'));
  return screen.getByTestId('email-search-input');
}

async function openEmailActionsMenu() {
  fireEvent.pointerDown(screen.getByTestId('email-more-actions'), { button: 0 });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function openEmailRowActionsMenu(id: string) {
  fireEvent.pointerDown(screen.getByTestId(`email-rail-actions-${id}`), { button: 0, ctrlKey: false });
  fireEvent.click(screen.getByTestId(`email-rail-actions-${id}`));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function openDetailSensitivityMenu() {
  const trigger = screen.getByTestId('email-privilege-control').querySelector('button');
  expect(trigger).not.toBeNull();
  fireEvent.pointerDown(trigger!, { button: 0, ctrlKey: false });
  fireEvent.click(trigger!);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.getByTestId('email-privilege-option-attorney-client')).toBeInTheDocument();
}

async function openDetailFilingPicker() {
  const trigger = screen.getByTestId('email-file-to-matter').querySelector('button');
  expect(trigger).not.toBeNull();
  fireEvent.click(trigger!);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.getByTestId('email-file-matter-search')).toBeInTheDocument();
}

beforeEach(() => {
  setupDefaultMocks();
  vi.useFakeTimers();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('EmailWorkspace', () => {

  // 1. Renders rows from mailListMessages results
  it('renders email rows in a left rail with the selected email on the right', async () => {
    render(<EmailWorkspace />);
    await waitForInitialLoad();

    expect(screen.getByTestId('email-master-detail')).toBeInTheDocument();
    expect(screen.getByRole('listbox', { name: 'Email list' })).toBeInTheDocument();
    expect(screen.getByTestId('email-detail-pane')).toBeInTheDocument();

    const rows = screen.getAllByTestId(/^email-rail-row-/);
    expect(rows).toHaveLength(FIXTURE_ITEMS.length);
    expect(rows[0]).toHaveTextContent('Contract draft - please review');
    expect(rows[1]).toHaveTextContent('Deposition schedule');
    await flushEmailDetail();
    expect(screen.getByTestId('email-viewer-subject')).toHaveTextContent('Contract draft - please review');
  });

  it('changes the right-side email detail when a rail row is selected', async () => {
    render(<EmailWorkspace />);
    await waitForInitialLoad();

    fireEvent.click(screen.getByTestId('email-rail-row-msg-002'));
    await flushEmailDetail();

    expect(mockMailGetMessage).toHaveBeenLastCalledWith('mail:msg-002');
    expect(screen.getByTestId('email-viewer-subject')).toHaveTextContent('Deposition schedule');
  });

  // 2. Debounced keyword triggers a query after typing
  it('fires mailListMessages with the keyword after debounce', async () => {
    render(<EmailWorkspace />);
    await waitForInitialLoad();

    const callsBefore = mockMailListMessages.mock.calls.length;

    // Type a keyword
    const input = openEmailSearch();
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

    render(<EmailWorkspace />);
    await waitForInitialLoad();

    // Expand the filter row from the rail overflow menu (collapsed by default)
    await openEmailActionsMenu();
    const filtersToggle = screen.getByTestId('filters-toggle');
    fireEvent.click(filtersToggle);

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
  it('dispatches keepance:open-email with the correct sourceId from the explicit open action', async () => {
    render(<EmailWorkspace />);
    await waitForInitialLoad();

    const dispatched: CustomEvent[] = [];
    const listener = (e: Event) => { dispatched.push(e as CustomEvent); };
    window.addEventListener('lantern:open-email', listener);

    await openEmailRowActionsMenu('msg-001');
    fireEvent.click(screen.getByTestId('email-rail-open-msg-001'));

    window.removeEventListener('lantern:open-email', listener);

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.detail).toEqual({ sourceId: 'mail:msg-001' });
  });

  // 5. Privilege sub-component calls setPrivilege when user selects a privilege
  it('keeps the sensitive badge visible in the email rail', async () => {
    mockUsePrivilegeForSource.mockImplementation((sourceId: string | null | undefined) => (
      sourceId === 'mail:msg-001' ? 'attorney-client' : 'none'
    ));

    render(<EmailWorkspace />);
    await waitForInitialLoad();

    const sensitiveRow = screen.getByTestId('email-rail-row-msg-001');
    expect(within(sensitiveRow).getByTestId('email-rail-sensitive-msg-001')).toHaveTextContent('Sensitive');
    expect(screen.queryByTestId('email-rail-sensitive-msg-002')).not.toBeInTheDocument();
  });

  it('calls setPrivilege when a privilege option is selected from the dropdown', async () => {
    render(<EmailWorkspace />);
    await waitForInitialLoad();

    await flushEmailDetail();
    expect(screen.getByTestId('email-privilege-control')).toBeInTheDocument();

    await openDetailSensitivityMenu();
    const acOption = screen.getByTestId('email-privilege-option-attorney-client');
    fireEvent.click(acOption);

    expect(mockSetPrivilege).toHaveBeenCalledWith('mail:msg-001', 'attorney-client');
  });

  // 6. File-to-matter (per-message) calls mailRetagMessageMatter with correct args
  it('calls mailRetagMessageMatter with correct args when a matter is chosen from the detail pane', async () => {
    render(<EmailWorkspace />);
    await waitForInitialLoad();

    await flushEmailDetail();
    expect(screen.getByTestId('email-file-to-matter')).toBeInTheDocument();

    await openDetailFilingPicker();
    const matterBtn = screen.getByTestId('file-to-matter-btn-matter-1');
    fireEvent.click(matterBtn);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    // Per-row "File" action uses per-message retag (not folder retag)
    expect(mockMailRetagMessageMatter).toHaveBeenCalledWith(
      'msg-001',
      'matter-1',
    );
    expect(mockMailRetagFolderMatter).not.toHaveBeenCalled();
  });

  // 7. Shows loading state when fetching
  it('shows loading state while mailListMessages is in flight', async () => {
    let resolveList!: (v: { items: typeof FIXTURE_ITEMS; total: number }) => void;
    mockMailListMessages.mockImplementation(
      () => new Promise((res) => { resolveList = res; }),
    );

    render(<EmailWorkspace />);

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

    render(<EmailWorkspace />);
    await waitForInitialLoad();

    expect(screen.getByTestId('no-results-state')).toBeInTheDocument();
    expect(screen.getByTestId('no-results-state')).toHaveTextContent('No email');
    expect(screen.getByTestId('email-detail-empty-state')).toHaveTextContent('No email');
    expect(screen.queryByText('Select an email from the list to read it here.')).not.toBeInTheDocument();
    expect(screen.queryByTestId('no-accounts-state')).not.toBeInTheDocument();
  });

  // 9. Shows empty/no-accounts state when connectedAccounts returns []
  it('shows no-accounts state and connect CTA when connectedAccounts is empty', async () => {
    mockMailConnectedAccounts.mockResolvedValue([]);

    const onOpenSettings = vi.fn();
    render(<EmailWorkspace onOpenSettings={onOpenSettings} />);

    // Only accounts fetch fires here - no debounce needed
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });

    expect(screen.getByTestId('no-accounts-state')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect email' })).toBeInTheDocument();
    expect(screen.queryByText('Your email is connected.')).not.toBeInTheDocument();
    expect(screen.queryByTestId('email-sync-now')).not.toBeInTheDocument();
    expect(screen.queryByTestId('email-search-input')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Connect email' }));
    expect(onOpenSettings).toHaveBeenCalledOnce();

    expect(mockMailListMessages).not.toHaveBeenCalled();
  });

  // 10. Shows error state when mailListMessages throws
  // Error messages are now mapped to plain language by mapMailError():
  //   generic errors → "Something went wrong with that email action. Try again."
  //   auth/token errors → "Your email account isn't fully connected. Reconnect it in Settings."
  it('shows error state when mailListMessages rejects', async () => {
    mockMailListMessages.mockRejectedValue(new Error('Network error'));

    render(<EmailWorkspace />);
    await waitForInitialLoad();

    expect(screen.getByTestId('error-state')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong with that email action. Try again.')).toBeInTheDocument();
    expect(screen.getByTestId('error-retry')).toBeInTheDocument();
  });

  // 11. Opens the compose panel when "New email" button is clicked
  it('opens the compose panel when "New email" button is clicked', async () => {
    render(<EmailWorkspace />);
    await waitForInitialLoad();

    expect(screen.queryByTestId('compose-close')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('compose-btn'));

    expect(screen.getByTestId('compose-close')).toBeInTheDocument();
    expect(screen.getByTestId('compose-to')).toBeInTheDocument();
    expect(screen.getByTestId('compose-subject')).toBeInTheDocument();
    expect(screen.getByTestId('compose-body')).toBeInTheDocument();
    expect(screen.getByTestId('compose-send')).toBeInTheDocument();
  });

  // 12. Compose Send calls mailSend with the right args and shows success
  it('compose Send calls mailSend with the right args and shows success', async () => {
    render(<EmailWorkspace />);
    await waitForInitialLoad();

    fireEvent.click(screen.getByTestId('compose-btn'));

    fireEvent.change(screen.getByTestId('compose-to'), { target: { value: 'alice@example.com' } });
    fireEvent.change(screen.getByTestId('compose-subject'), { target: { value: 'Hello from Lantern' } });
    fireEvent.change(screen.getByTestId('compose-body'), { target: { value: 'Test body text.' } });

    // Click send and flush all microtasks + timers
    await act(async () => {
      fireEvent.click(screen.getByTestId('compose-send'));
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(mockMailSend).toHaveBeenCalledWith(
      'm365',
      'default',
      ['alice@example.com'],
      [],
      [],
      'Hello from Lantern',
      'Test body text.',
      undefined,
      undefined,
    );

    expect(screen.getByTestId('compose-success')).toBeInTheDocument();
  });

  // 13. Compose shows scope_upgrade_required notice when mailSend rejects with that message
  it('compose shows scope_upgrade_required notice when mailSend rejects with that message', async () => {
    mockMailSend.mockRejectedValue(new Error('scope_upgrade_required'));

    render(<EmailWorkspace />);
    await waitForInitialLoad();

    fireEvent.click(screen.getByTestId('compose-btn'));
    fireEvent.change(screen.getByTestId('compose-to'), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByTestId('compose-body'), { target: { value: 'Hello.' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('compose-send'));
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(screen.getByTestId('compose-scope-upgrade')).toBeInTheDocument();
  });

  // 14. Ask AI mode shows empty-state headline + chips when no query is typed
  it('shows Ask AI empty state headline and chips when switching to Ask AI mode with no query', async () => {
    render(<EmailWorkspace />);
    await waitForInitialLoad();

    // Switch to Ask AI mode from the rail overflow menu
    await openEmailActionsMenu();
    fireEvent.click(screen.getByTestId('mode-ask'));

    expect(screen.getByTestId('ask-empty-state')).toBeInTheDocument();
    expect(screen.getByText('Ask your email')).toBeInTheDocument();

    const chips = screen.getAllByTestId('ask-chip');
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveTextContent('Beneficiary change');
  });

  // 15. Clicking a chip fills the Ask AI input with the chip text
  it('clicking an Ask AI chip populates the search input', async () => {
    render(<EmailWorkspace />);
    await waitForInitialLoad();

    await openEmailActionsMenu();
    fireEvent.click(screen.getByTestId('mode-ask'));

    const chips = screen.getAllByTestId('ask-chip');
    expect(chips[0]).toBeDefined();
    fireEvent.click(chips[0]!);

    const input = openEmailSearch() as HTMLInputElement;
    expect(input.value).toBe('Beneficiary change');
    // Empty state should be hidden once there is a query
    expect(screen.queryByTestId('ask-empty-state')).not.toBeInTheDocument();
  });

  it('opens AI settings from the disabled-memory email link through one surface only', async () => {
    let resolveRetrieve: ((hits: unknown[]) => void) | undefined;
    mockIsMemoryEnabled.mockReturnValue(true);
    mockMemoryRetrieve.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRetrieve = resolve;
        }),
    );
    const onOpenSettings = vi.fn();
    const settingsEvents: CustomEvent[] = [];
    const onSettingsEvent = vi.fn((event: Event) => {
      settingsEvents.push(event as CustomEvent);
    });
    window.addEventListener(EV_OPEN_SETTINGS, onSettingsEvent);

    try {
      render(<EmailWorkspace onOpenSettings={onOpenSettings} />);
      await waitForInitialLoad();

      await openEmailActionsMenu();
      fireEvent.click(screen.getByTestId('mode-ask'));
      fireEvent.change(openEmailSearch(), {
        target: { value: 'beneficiary' },
      });
      expect(mockMemoryRetrieve).toHaveBeenCalled();

      mockIsMemoryEnabled.mockReturnValue(false);
      await act(async () => {
        resolveRetrieve?.([]);
        await vi.advanceTimersByTimeAsync(0);
      });

      fireEvent.click(screen.getByRole('button', { name: 'Enable it in Settings' }));

      expect(onSettingsEvent).toHaveBeenCalledTimes(1);
      expect(settingsEvents[0]?.detail).toEqual({ category: 'ai' });
      expect(onOpenSettings).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(EV_OPEN_SETTINGS, onSettingsEvent);
    }
  });

  // 16. Parses recipients correctly from comma/semicolon-separated input
  it('parses recipients correctly from comma/semicolon-separated input', async () => {
    render(<EmailWorkspace />);
    await waitForInitialLoad();

    fireEvent.click(screen.getByTestId('compose-btn'));
    fireEvent.change(screen.getByTestId('compose-to'), { target: { value: 'alice@a.com, bob@b.com; carol@c.com' } });
    fireEvent.change(screen.getByTestId('compose-body'), { target: { value: 'Hi all.' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('compose-send'));
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(mockMailSend).toHaveBeenCalledWith(
      'm365',
      'default',
      ['alice@a.com', 'bob@b.com', 'carol@c.com'],
      [],
      [],
      '',
      'Hi all.',
      undefined,
      undefined,
    );
  });

  // 17. Attach button renders in compose modal and attachment chips appear/disappear
  it('renders attach button in compose and shows/removes attachment chips', async () => {
    render(<EmailWorkspace />);
    await waitForInitialLoad();

    fireEvent.click(screen.getByTestId('compose-btn'));

    // Attach button should be visible
    const attachBtn = screen.getByTestId('compose-attach');
    expect(attachBtn).toBeInTheDocument();

    // No chips yet
    expect(screen.queryByTestId('compose-remove-attachment-0')).not.toBeInTheDocument();

    // Stub FileReader with a proper constructor (not an arrow function)
    const originalFileReader = global.FileReader;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let capturedReader: any = null;
    function FakeFileReader(this: FileReader) {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      capturedReader = this;
      (this as unknown as { result: string | null }).result = null;
      (this as unknown as { onload: null }).onload = null;
    }
    FakeFileReader.prototype.readAsDataURL = function () {
      // schedule onload asynchronously so act() can flush it
      setTimeout(() => {
        (this as unknown as { result: string }).result = 'data:text/plain;base64,aGVsbG8=';
        if ((this as unknown as { onload: (() => void) | null }).onload) {
          (this as unknown as { onload: () => void }).onload();
        }
      }, 0);
    };
    global.FileReader = FakeFileReader as unknown as typeof FileReader;

    const fileInput = screen.getByTestId('compose-attach-input');
    const fakeFile = new File(['hello'], 'test.txt', { type: 'text/plain' });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [fakeFile] } });
      await vi.advanceTimersByTimeAsync(50);
    });

    global.FileReader = originalFileReader;

    // Chip should appear
    expect(capturedReader).not.toBeNull();
    const removeBtn = screen.getByTestId('compose-remove-attachment-0');
    expect(removeBtn).toBeInTheDocument();
    expect(screen.getByText('test.txt')).toBeInTheDocument();

    // Remove the attachment
    fireEvent.click(removeBtn);
    expect(screen.queryByTestId('compose-remove-attachment-0')).not.toBeInTheDocument();
  });

  // 18. Result count line — keeps the quiet "More" action when partial load
  it('shows the quiet More action when fewer items loaded than total', async () => {
    // Simulate 2 loaded of 10 total
    mockMailListMessages.mockResolvedValue({ items: FIXTURE_ITEMS, total: 10 });

    render(<EmailWorkspace />);
    await waitForInitialLoad();

    const countEl = screen.getByTestId('result-count');
    expect(countEl).toBeInTheDocument();
    expect(countEl.textContent).toContain('More');
    expect(countEl.textContent).not.toContain('2 of 10');
  });

  // 19. Result count line — hides when all items are loaded and no query is active
  it('hides the result count when all items are loaded and there is no query', async () => {
    // items.length === total (2) and no query
    mockMailListMessages.mockResolvedValue({ items: FIXTURE_ITEMS, total: FIXTURE_ITEMS.length });

    render(<EmailWorkspace />);
    await waitForInitialLoad();

    expect(screen.queryByTestId('result-count')).not.toBeInTheDocument();
  });

  // 20. Result count line — shows "Showing N of M" when query is active (even if N === total in results)
  it('shows "Showing N of M" when a keyword query is active, even if all returned items equal total', async () => {
    mockMailListMessages.mockResolvedValue({ items: FIXTURE_ITEMS, total: FIXTURE_ITEMS.length });

    render(<EmailWorkspace />);
    await waitForInitialLoad();

    // Type a query
    const input = openEmailSearch();
    fireEvent.change(input, { target: { value: 'deposition' } });
    await flushDebounce();

    const countEl = screen.getByTestId('result-count');
    expect(countEl.textContent).toContain(`2 of ${String(FIXTURE_ITEMS.length)}`);
  });

  // 21. Detail pane matter choices
  it('shows the matter choices in the selected email detail pane', async () => {
    render(<EmailWorkspace />);
    await waitForInitialLoad();

    await flushEmailDetail();
    expect(screen.getByTestId('email-file-to-matter')).toBeInTheDocument();
    await openDetailFilingPicker();
    expect(screen.getByTestId('file-to-matter-btn-matter-1')).toHaveTextContent('Acme v. Beta');
    expect(screen.getByTestId('file-to-matter-btn-matter-2')).toHaveTextContent('Gamma Patent');
  });

  // 22. Auth error is mapped to a reconnect prompt
  it('maps auth/401 errors to a plain reconnect message', async () => {
    mockMailListMessages.mockRejectedValue(new Error('401 Unauthorized'));

    render(<EmailWorkspace />);
    await waitForInitialLoad();

    expect(screen.getByTestId('error-state')).toBeInTheDocument();
    expect(screen.getByText("Your email account isn't fully connected. Reconnect it in Settings.")).toBeInTheDocument();
  });

  // 23. Error state shows "Try again" button that triggers a retry
  it('shows a Try again button in error state that clears the error and re-fetches', async () => {
    let callCount = 0;
    mockMailListMessages.mockImplementation(() => {
      callCount++;
      if (callCount <= 1) {
        return Promise.reject(new Error('Flaky error'));
      }
      return Promise.resolve({ items: FIXTURE_ITEMS, total: FIXTURE_ITEMS.length });
    });

    render(<EmailWorkspace />);
    await waitForInitialLoad();

    expect(screen.getByTestId('error-state')).toBeInTheDocument();
    const retryBtn = screen.getByTestId('error-retry');
    expect(retryBtn).toBeInTheDocument();

    // Click retry and flush debounce + promise
    fireEvent.click(retryBtn);
    await flushDebounce();

    // After retry, results appear
    expect(screen.queryByTestId('error-state')).not.toBeInTheDocument();
    expect(screen.getAllByTestId(/^email-rail-row-/)).toHaveLength(FIXTURE_ITEMS.length);
  });

});
