/**
 * Perf (P2.2) — EmailWorkspace / MailRow render hygiene measurement.
 *
 * Two properties, measured directly (not vibes) — call counts of
 * `usePrivilegeForSource` (the first hook MailRow calls) as an exact proxy
 * for "did this specific MailRow instance actually render", since a
 * `React.Profiler` around the whole tree can't distinguish "1 row
 * re-rendered" from "20 rows re-rendered" (`onRender` fires once per commit
 * of the wrapped subtree, not once per component instance inside it):
 *
 *  1. Memoization: (a) MailRow in isolation skips re-rendering when given
 *     an identical-props re-render, and still re-renders on a genuine prop
 *     change; (b) end-to-end through EmailWorkspace, selecting a SECOND row
 *     (when `anySelected` is already true, so only that one row's
 *     `selected` prop actually changes) re-renders only that one row.
 *  2. Virtualization: with a busy inbox (200 rows, at the documented page
 *     size), only a small window of rows near the scroll container's
 *     visible height are ever mounted — not all 200 — while the reported
 *     "Showing N" count still reflects the true total.
 *
 * Reuses the same module mocks as ReimaginedEmailWorkspace.test.tsx so the
 * EmailWorkspace-level tests exercise the SAME component, not a stub.
 */

/// <reference types="@testing-library/jest-dom" />
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('@/platform/utils/mail-commands', () => ({
  mailListMessages: vi.fn(),
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
  buildMailMatterMap: vi.fn().mockReturnValue([]),
  matterLabel: vi.fn((m: { name: string }) => m.name),
  resolveMailMatter: vi.fn(),
}));

import {
  mailListMessages,
  mailConnectedAccounts,
} from '@/platform/utils/mail-commands';
import { useActiveMatter, useMatters } from '@/platform/matter/matterStore';
import { usePrivilegeStore, usePrivilegeForSource } from '@/platform/firm/privilegeStore';
import { isMemoryEnabled } from '@/platform/rag/MemoryService';
import { resolveMailMatter } from '@/platform/rag/matterResolver';
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
const mockMailConnectedAccounts = mailConnectedAccounts as ReturnType<typeof vi.fn>;
const mockUseActiveMatter = useActiveMatter as ReturnType<typeof vi.fn>;
const mockUseMatters = useMatters as ReturnType<typeof vi.fn>;
const mockUsePrivilegeForSource = usePrivilegeForSource as ReturnType<typeof vi.fn>;
const mockIsMemoryEnabled = isMemoryEnabled as ReturnType<typeof vi.fn>;

function setupMocks(items: ReturnType<typeof makeItems>) {
  vi.clearAllMocks();
  mockMailConnectedAccounts.mockResolvedValue(FIXTURE_ACCOUNTS);
  mockMailListMessages.mockResolvedValue({ items, total: items.length });
  mockUseActiveMatter.mockReturnValue(null);
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

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Perf (P2.2) — EmailWorkspace / MailRow render hygiene', () => {
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

  // End-to-end version of the same property, through the real EmailWorkspace
  // + selection flow: selecting a SECOND row (when `anySelected` is already
  // true, so only that one row's `selected` prop actually changes) must not
  // force every OTHER visible row to do render work — verified via the same
  // usePrivilegeForSource-call-count proxy, counted per row via the id
  // argument each row passes to it (`mail:<id>`).
  it('selecting a second row does not re-render every other visible row', async () => {
    const items = makeItems(20); // below the virtualize threshold — every row is really in the DOM
    setupMocks(items);
    const mockUsePrivilegeForSource = usePrivilegeForSource as ReturnType<typeof vi.fn>;
    mockUsePrivilegeForSource.mockReturnValue('none');

    render(<EmailWorkspace />);
    await waitForInitialLoad();
    expect(screen.getAllByTestId('mail-row')).toHaveLength(20);

    // Select row 0 — this flips `anySelected` false -> true for every row,
    // so a re-render of all rows here is CORRECT, not a bug.
    act(() => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Message 0' }));
    });

    mockUsePrivilegeForSource.mockClear();

    // Select row 1 — `anySelected` is already true; only row 1's own
    // `selected` prop changes.
    act(() => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Message 1' }));
    });

    const rerenderedRowIds = mockUsePrivilegeForSource.mock.calls.map((call: unknown[]) => call[0]);
    console.log(`[perf/email-render] rows re-rendered after 2nd selection: ${JSON.stringify(rerenderedRowIds)}`);
    expect(rerenderedRowIds).toEqual(['mail:msg-0001']);
  });

  it('virtualization: a 200-row inbox only mounts a small window of rows, not all 200', async () => {
    // @tanstack/react-virtual's initial (synchronous, no ResizeObserver
    // needed) measurement reads `element.offsetWidth`/`offsetHeight` — jsdom
    // reports 0 for both on every element by default, which is why an
    // un-mocked virtualizer renders nothing in tests. Mocking those two is
    // enough; no ResizeObserver polyfill is needed (jsdom has none, and the
    // library already no-ops gracefully when it's absent).
    const heightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return 560; } });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return 800; } });

    try {
      const items = makeItems(200);
      setupMocks(items);

      render(<EmailWorkspace />);
      await waitForInitialLoad();

      const rows = screen.getAllByTestId('mail-row');
      console.log(`[perf/email-render] items=200 mountedRows=${rows.length}`);

      // The result-count header is correctness-independent of virtualization
      // (all 200 items loaded, so it reports "All email loaded" rather than
      // "Showing N of M" — same as it would with virtualization off)...
      expect(screen.getByTestId('result-count').textContent).toBe('All email loaded');
      // ...while the DOM only carries a bounded window of rows, not all 200.
      expect(rows.length).toBeLessThan(100);
    } finally {
      if (heightDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', heightDescriptor);
      }
      if (widthDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', widthDescriptor);
      }
    }
  });

  it('a small inbox (below the virtualize threshold) still renders every row directly', async () => {
    const items = makeItems(10);
    setupMocks(items);

    render(<EmailWorkspace />);
    await waitForInitialLoad();

    expect(screen.getAllByTestId('mail-row')).toHaveLength(10);
  });

  // Codex review (P2.2, round 3): giving the results box a small fixed
  // max-height (560px) — rather than letting it fill the remaining page
  // height the way it did before virtualization — shrank the "safe zone"
  // for row popovers (File/Privilege menus, absolutely positioned and
  // clipped by any `overflow` ancestor) from the full page down to a few
  // hundred pixels, so a dropdown opened on any row past the first few got
  // visibly clipped. This checks the structural property that makes that
  // regression possible: the results box must be a flexible (`flex: 1`),
  // not a small-fixed-height, region.
  it('the results box fills available space (flex: 1) instead of a small fixed height', async () => {
    const items = makeItems(10);
    setupMocks(items);

    render(<EmailWorkspace />);
    await waitForInitialLoad();

    const resultsBox = screen.getByTestId('result-count').parentElement;
    expect(resultsBox).not.toBeNull();
    // jsdom expands the `flex` shorthand — "1" becomes "1 1 0%".
    expect(resultsBox!.style.flex).toBe('1 1 0%');
    // Explicitly guard against reintroducing a small fixed cap.
    expect(resultsBox!.style.maxHeight).toBe('');
  });

  // Codex review (P2.2, round 4, P1): `flex: 1` on an element does NOTHING
  // unless its own PARENT is an actual flex container — the "Body" wrapper
  // had `flex: 1` (to size itself within the page) but no `display: flex`
  // of its own, so the results box's `flex: 1` (checked above) was silently
  // ignored: the box grew to fit `rowVirtualizer.getTotalSize()` instead of
  // being constrained to a scrollable height, the virtualizer's scroll
  // container never scrolled, and a busy (>40-row) inbox went blank past
  // the first virtual window. Neither of the tests above would have caught
  // this — they mock `offsetHeight`/`offsetWidth` uniformly on every
  // element, which bypasses real CSS layout entirely and can't detect a
  // broken flex chain. This instead directly asserts the structural
  // property that makes flex-based sizing actually take effect: every
  // `flex`-bearing element in the chain from `email-body` down to the
  // virtualizer's scroll container must ALSO be a flex container itself
  // (or be a direct, immediate flex child with nothing non-flex in between).
  it('the flex chain from the page body down to the scroll container is unbroken', async () => {
    const items = makeItems(10);
    setupMocks(items);

    render(<EmailWorkspace />);
    await waitForInitialLoad();

    const body = screen.getByTestId('email-body');
    expect(body.style.display).toBe('flex');
    expect(body.style.flexDirection).toBe('column');

    const resultsBox = screen.getByTestId('result-count').parentElement!;
    // The results box must be a DIRECT child of `email-body` — if some
    // future refactor wraps it in another element, that wrapper would also
    // need `display: flex` or the chain breaks again.
    expect(resultsBox.parentElement).toBe(body);
    expect(resultsBox.style.display).toBe('flex');
    expect(resultsBox.style.flexDirection).toBe('column');

    const scrollContainer = screen.getByTestId('mail-list-scroll');
    expect(scrollContainer.parentElement).toBe(resultsBox);
    expect(scrollContainer.style.flex).toBe('1 1 0%');
    expect(scrollContainer.style.overflowY).toBe('auto');
  });

  // Codex review (P2.2, round 1): `scopedItems` used to call `getMatters()`
  // — a non-reactive Zustand SNAPSHOT getter — inside the memoized filter,
  // with `matters` absent from the dependency array. The pre-memo code got
  // away with reading a stale snapshot because it re-ran on every render for
  // ANY reason; once memoized, a matters/folder-mapping change (e.g. another
  // client claiming a more specific folder) landing with none of the OTHER
  // deps changing would never be picked up until something unrelated also
  // happened to re-render the component. This proves the fix: `matters`
  // (via the reactive `useMatters()`) is a real dependency, so a matters-only
  // change, surfaced through an otherwise-unrelated re-render, does update
  // which items are shown.
  it('scopedItems (embedded mode) reflects a matters/folder-mapping change, not a stale scan', async () => {
    const items = makeItems(1);
    setupMocks(items);
    mockUseActiveMatter.mockReturnValue({ id: 'matter-1', name: 'Acme', client: 'Acme Corp', folderPaths: [], createdAt: '2026-01-01T00:00:00Z' });
    const mockResolveMailMatter = resolveMailMatter as ReturnType<typeof vi.fn>;

    // Initially: no matter's folder mapping covers this item.
    mockUseMatters.mockReturnValue([]);
    mockResolveMailMatter.mockReturnValue('unassigned');

    render(<EmailWorkspace embedded />);
    await waitForInitialLoad();
    expect(screen.queryAllByTestId('mail-row')).toHaveLength(0);

    // A folder mapping is added elsewhere (e.g. the matter manager) — the
    // matters list changes, resolveMailMatter would now match this item to
    // the active matter. Nothing about `items`/`embedded`/`activeMatter`
    // changes.
    mockUseMatters.mockReturnValue([{ id: 'matter-1', name: 'Acme', client: 'Acme Corp', folderPaths: [], mailFolderPaths: ['m365:default:inbox'], createdAt: '2026-01-01T00:00:00Z' }]);
    mockResolveMailMatter.mockReturnValue('matter-1');

    // Trigger a re-render via something entirely UNRELATED to matters
    // scoping — toggling the filters panel is pure local UI state.
    act(() => {
      fireEvent.click(screen.getByTestId('filters-toggle'));
    });

    expect(screen.getAllByTestId('mail-row')).toHaveLength(1);
  });
});
