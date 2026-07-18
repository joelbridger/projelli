/**
 * EmailWorkspace rail-shell regression tests.
 *
 * The standalone MailRow memo test stays here because MailRow still exists for
 * legacy readers. The EmailWorkspace-level tests now guard the WP4 master-detail
 * layout: rail rows on the left, selected email detail on the right, bulk
 * selection, overflow filters, and embedded client refetch behavior.
 */

/// <reference types="@testing-library/jest-dom" />
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const selectionFixture = vi.hoisted(() => ({
  matter: null as { id: string; name: string; client: string; folderPaths: string[]; createdAt: string } | null,
}));

vi.mock('@/platform/utils/mail-commands', () => ({
  mailListMessages: vi.fn(),
  mailListMessagesByMatter: vi.fn(),
  mailGetMessage: vi.fn(),
  mailGetAttachment: vi.fn(),
  mailConnectedAccounts: vi.fn(),
  mailRetagFolderMatter: vi.fn(),
  mailRetagMessageMatter: vi.fn(),
  mailSend: vi.fn(),
  mailSyncAll: vi.fn().mockResolvedValue(undefined),
  MAIL_SYNC_EVENT: 'mail-sync-progress',
  MAIL_INDEX_CHUNK_EVENT: 'mail-index-chunk',
}));

vi.mock('@/platform/client-context', () => ({
  useSelectionOperationDecision: () => selectionFixture.matter
    ? { kind: 'matter' as const, sourceKind: 'matter-only' as const, matter: selectionFixture.matter, client: null }
    : { kind: 'all-matters' as const, client: null },
  readSelectionOperationDecision: () => selectionFixture.matter
    ? { kind: 'matter' as const, sourceKind: 'matter-only' as const, matter: selectionFixture.matter, client: null }
    : { kind: 'all-matters' as const, client: null },
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
  resolveMailMatter: vi.fn(),
}));

import {
  mailListMessages,
  mailListMessagesByMatter,
  mailGetMessage,
  mailConnectedAccounts,
} from '@/platform/utils/mail-commands';
import { useActiveMatter, useMatters } from '@/platform/matter/matterStore';
import { usePrivilegeStore, usePrivilegeForSource } from '@/platform/firm/privilegeStore';
import { isMemoryEnabled } from '@/platform/rag/MemoryService';
import { buildMailMatterMap } from '@/platform/rag/matterResolver';
import { EmailWorkspace } from '@/features/email/EmailWorkspace';
import { MailRow } from '@/features/email/MailRow';

const FIXTURE_ACCOUNTS = [{ provider: 'm365', account: 'default', label: 'Work' }];

function makeItems(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `msg-${String(i).padStart(4, '0')}`,
    subject: `Message ${i}`,
    fromAddr: `sender${i}@example.com`,
    fromName: `Sender ${i}`,
    snippet: `This is the body snippet for message ${i}.`,
    receivedDateTime: '2026-06-10T09:00:00Z',
    provider: 'm365',
    account: 'default',
    folderId: 'inbox',
    hasAttachments: false,
  }));
}

const mockMailListMessages = mailListMessages as ReturnType<typeof vi.fn>;
const mockMailGetMessage = mailGetMessage as unknown as ReturnType<typeof vi.fn>;
const mockMailConnectedAccounts = mailConnectedAccounts as ReturnType<typeof vi.fn>;
const mockUseActiveMatter = useActiveMatter as ReturnType<typeof vi.fn>;
const mockUseMatters = useMatters as ReturnType<typeof vi.fn>;
const mockUsePrivilegeForSource = usePrivilegeForSource as ReturnType<typeof vi.fn>;
const mockIsMemoryEnabled = isMemoryEnabled as ReturnType<typeof vi.fn>;

function setupMocks(items: ReturnType<typeof makeItems>) {
  vi.clearAllMocks();
  mockMailConnectedAccounts.mockResolvedValue(FIXTURE_ACCOUNTS);
  mockMailListMessages.mockResolvedValue({ items, total: items.length });
  mockMailGetMessage.mockImplementation((sourceId: string) => {
    const id = sourceId.startsWith('mail:') ? sourceId.slice('mail:'.length) : sourceId;
    const item = items.find((candidate) => candidate.id === id) ?? items[0]!;
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
  mockUseActiveMatter.mockReturnValue(null);
  selectionFixture.matter = null;
  mockUseMatters.mockReturnValue([]);
  (usePrivilegeStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue(vi.fn());
  mockUsePrivilegeForSource.mockReturnValue('none');
  mockIsMemoryEnabled.mockReturnValue(true);
}

async function waitForInitialLoad() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

async function flushEmailDetail() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
}

async function openEmailActionsMenu() {
  fireEvent.pointerDown(screen.getByTestId('email-more-actions'), { button: 0 });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  window.history.pushState({}, '', '/');
  vi.useRealTimers();
});

describe('EmailWorkspace rail-shell regression coverage', () => {
  // Isolated MailRow memoization test. A `React.Profiler` around
  // EmailWorkspace can't tell "1 row re-rendered" from "20 rows
  // re-rendered" — `onRender` fires once per COMMIT of the wrapped subtree,
  // not once per component instance inside it. `usePrivilegeForSource` is
  // called exactly once per MailRow render (it's the first hook MailRow
  // calls), so its mock call count IS an exact proxy for "did this specific
  // MailRow instance actually re-render" — the same technique used by
  // React.memo's own contract: identical props in, zero extra work out.
  it('MailRow (memoized) skips re-rendering on an identical-props re-render', () => {
    const mockUsePrivilegeForSource = usePrivilegeForSource as ReturnType<typeof vi.fn>;
    mockUsePrivilegeForSource.mockReturnValue('none');
    const item = makeItems(1)[0]!;
    const onToggleSelect = vi.fn();

    const { rerender } = render(
      <MailRow item={item} selected={false} anySelected={false} onToggleSelect={onToggleSelect} />,
    );
    expect(mockUsePrivilegeForSource).toHaveBeenCalledTimes(1);

    // Re-render with the SAME prop values (same `item` reference, same
    // primitives, same `onToggleSelect` reference) — exactly what happens
    // in EmailWorkspace when a DIFFERENT row's selection changes and this
    // row's own props are untouched. Memoized MailRow must skip this.
    rerender(
      <MailRow item={item} selected={false} anySelected={false} onToggleSelect={onToggleSelect} />,
    );
    expect(mockUsePrivilegeForSource).toHaveBeenCalledTimes(1);

    // A genuine prop change (this row gets selected) must still re-render.
    rerender(
      <MailRow item={item} selected={true} anySelected={false} onToggleSelect={onToggleSelect} />,
    );
    expect(mockUsePrivilegeForSource).toHaveBeenCalledTimes(2);
  });

  it('EmailWorkspace renders rail rows and the selected email detail', async () => {
    const items = makeItems(20);
    setupMocks(items);

    render(<EmailWorkspace />);
    await waitForInitialLoad();
    expect(screen.getAllByTestId(/^email-rail-row-/)).toHaveLength(20);
    expect(screen.queryByTestId('mail-row')).not.toBeInTheDocument();

    await flushEmailDetail();
    expect(screen.getByTestId('email-viewer-subject')).toHaveTextContent('Message 0');
  });

  it('shows a browser-demo preview instead of the desktop-only reader error for mail fixtures', async () => {
    const items = makeItems(2);
    setupMocks(items);
    window.history.pushState({}, '', '/?mailFixture=1');

    render(<EmailWorkspace />);
    await waitForInitialLoad();

    expect(screen.getByText('Preview')).toBeInTheDocument();
    expect(screen.getAllByText('This is the body snippet for message 0.')).toHaveLength(2);
    expect(screen.queryByTestId('email-viewer-error')).not.toBeInTheDocument();
  });

  it('rail checkboxes support bulk selection without changing the active email', async () => {
    const items = makeItems(10);
    setupMocks(items);

    render(<EmailWorkspace />);
    await waitForInitialLoad();
    await flushEmailDetail();

    expect(screen.getByTestId('email-viewer-subject')).toHaveTextContent('Message 0');

    act(() => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Message 0' }));
    });
    expect(screen.getByTestId('bulk-action-bar')).toHaveTextContent('1 selected');
    expect(screen.getByTestId('email-viewer-subject')).toHaveTextContent('Message 0');

    act(() => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Message 1' }));
    });
    expect(screen.getByTestId('bulk-action-bar')).toHaveTextContent('2 selected');
  });

  it('a busy inbox only mounts a bounded window of rail rows and keeps the loaded count honest', async () => {
    const heightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return 560; } });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return 800; } });

    try {
      const items = makeItems(200);
      setupMocks(items);

      render(<EmailWorkspace />);
      await waitForInitialLoad();

      const rows = screen.getAllByTestId(/^email-rail-row-/);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.length).toBeLessThan(100);
      expect(screen.queryByTestId('result-count')).not.toBeInTheDocument();
      expect(screen.getByRole('listbox', { name: 'Email list' })).toBeInTheDocument();
    } finally {
      if (heightDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', heightDescriptor);
      }
      if (widthDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', widthDescriptor);
      }
    }
  });

  it('the rail list and detail pane stay in separate flexible regions', async () => {
    const items = makeItems(10);
    setupMocks(items);

    render(<EmailWorkspace />);
    await waitForInitialLoad();

    const shellWrapper = screen.getByTestId('mail-list-scroll');
    const body = screen.getByTestId('email-body');
    const railList = screen.getByRole('listbox', { name: 'Email list' });
    const detailPane = screen.getByTestId('email-detail-pane');

    expect(shellWrapper.className).toContain('flex');
    expect(shellWrapper.className).toContain('min-h-0');
    expect(railList.className).toContain('overflow-y-auto');
    expect(body.className).toContain('flex');
    expect(body.className).toContain('flex-col');
    expect(detailPane.className).toContain('flex-1');
  });

  // F2.6b reconcile: per-client scoping moved from a client-side `resolveMailMatter`
  // scan into the BACKEND (`mailListMessagesByMatter`). The reactivity concern the
  // original P2.2 memoization test guarded still holds, just via a different
  // mechanism: the folder→matter map is `buildMailMatterMap(useMatters())`, so a
  // folder-mapping change re-runs the scoped fetch. This proves that — a
  // matters-only change (nothing about items/embedded/activeMatter) still updates
  // which rows show, now by refetching the scoped list rather than re-filtering.
  it('scopedItems (embedded mode) reflects a matters/folder-mapping change via a backend refetch', async () => {
    const items = makeItems(1);
    setupMocks(items);
    const matter = { id: 'matter-1', name: 'Acme', client: 'Acme Corp', folderPaths: [], createdAt: '2026-01-01T00:00:00Z' };
    mockUseActiveMatter.mockReturnValue(matter);
    selectionFixture.matter = matter;

    const mockByMatter = mailListMessagesByMatter as ReturnType<typeof vi.fn>;
    const mockBuildMap = buildMailMatterMap as ReturnType<typeof vi.fn>;
    // The reactive map is derived from matters, so it changes when a folder
    // mapping is added; the scoped backend returns the client's mail only once a
    // mapping covers it (mirrors real per-matter membership).
    mockBuildMap.mockImplementation((ms: Array<{ mailFolderPaths?: string[] }>) =>
      ms.flatMap((m) => (m.mailFolderPaths ?? []).map((f: string) => {
        const [provider, account, folderId] = f.split(':');
        return { provider, account, folderId, matterId: 'matter-1' };
      })),
    );
    mockByMatter.mockImplementation((_id: string, map: unknown[]) =>
      Promise.resolve(map.length > 0 ? { items, total: items.length } : { items: [], total: 0 }),
    );

    // Initially: no folder mapping covers this client → scoped fetch is empty.
    mockUseMatters.mockReturnValue([]);
    render(<EmailWorkspace embedded />);
    await waitForInitialLoad();
    expect(screen.queryAllByTestId(/^email-rail-row-/)).toHaveLength(0);

    // A folder mapping is added elsewhere (e.g. the matter manager) — the matters
    // list changes, so the reactive map changes and the scoped list refetches.
    // Nothing about `items`/`embedded`/`activeMatter` changes.
    mockUseMatters.mockReturnValue([{ id: 'matter-1', name: 'Acme', client: 'Acme Corp', folderPaths: [], mailFolderPaths: ['m365:default:inbox'], createdAt: '2026-01-01T00:00:00Z' }]);
    // Trigger a re-render via something entirely UNRELATED to matters scoping —
    // toggling the filters panel is pure local UI state — then let the debounced
    // scoped refetch run.
    await openEmailActionsMenu();
    fireEvent.click(screen.getByTestId('filters-toggle'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(screen.getAllByTestId(/^email-rail-row-/)).toHaveLength(1);
  });
});
