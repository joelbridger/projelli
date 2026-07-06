/**
 * Adversarial review finding: "Wealthbox connect/sync can look frozen" — the
 * backend retries a Wealthbox 429 for a long time (client.rs), and until now
 * the frontend had no timeout and no visible Stop affordance while the first
 * `crmListHouseholds()` call was in flight (before the backend's own
 * `crm-sync-progress` events start). This test drives the REAL
 * `WealthboxConnect` component with fake timers and asserts:
 *
 *   1. After ~20s of syncing with no progress, a "taking longer than usual"
 *      warning appears.
 *   2. The Stop button is visible during the WHOLE sync (including the
 *      household-list phase, before progress.status === 'syncing').
 *   3. A `crmListHouseholds()` call that never settles produces a clear,
 *      honest failure state instead of hanging forever.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: vi.fn().mockRejectedValue(new Error('invoke should not be called directly in this test')),
}));

vi.mock('@/platform/connectors/crm/useCrmSync', () => ({ useCrmSync: () => {} }));

const crmMocks = vi.hoisted(() => ({
  crmConnect: vi.fn(),
  crmIsConnected: vi.fn(),
  crmDisconnect: vi.fn(),
  crmListHouseholds: vi.fn(),
  crmSyncAll: vi.fn(),
  crmCancelSync: vi.fn(),
}));
vi.mock('@/platform/utils/wealthbox-commands', () => ({
  ...crmMocks,
  CRM_SYNC_EVENT: 'crm-sync-progress',
}));

import { WealthboxConnect } from '@/platform/connectors/crm/WealthboxConnect';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useCrmStore } from '@/platform/connectors/crm/crmStore';
import { CRM_LIST_HOUSEHOLDS_TIMEOUT_MS } from '@/platform/connectors/crm/crmTimeout';

async function connectAndStartSync() {
  render(<WealthboxConnect />);
  const input = await screen.findByPlaceholderText(/wealthbox api key/i);
  fireEvent.change(input, { target: { value: 'test-token-123' } });
  fireEvent.click(screen.getByRole('button', { name: /connect wealthbox/i }));
  // connect() resolves synchronously in these tests, then fires runSync()
  // which immediately awaits the (never-settling) household list call.
  await screen.findByText(/connected/i);
}

describe('WealthboxConnect — connect/sync stall UX', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    useMatterStore.setState({
      matters: [],
      activeMatterId: null,
      snapshots: {},
      cache: {},
      statusByMatterId: {},
    });
    useWorkspaceStore.setState({ rootPath: null, fileTree: [] });
    useCrmStore.setState({ progress: null });

    crmMocks.crmIsConnected.mockResolvedValue(false);
    crmMocks.crmConnect.mockResolvedValue({ name: 'Northcrest', plan: 'basic', email: 'advisor@northcrest.com' });
    crmMocks.crmCancelSync.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows Stop during the household-list phase, before any crm-sync-progress event arrives', async () => {
    // Never resolves — simulates the household list call still in flight.
    crmMocks.crmListHouseholds.mockReturnValue(new Promise(() => {}));

    await connectAndStartSync();

    // No progress event has fired yet (progress.status is not 'syncing'), but
    // the sync is genuinely in flight and must offer a way out.
    expect(useCrmStore.getState().progress).toBeNull();
    expect(await screen.findByRole('button', { name: /stop/i })).toBeInTheDocument();
  });

  it('shows a "taking longer than usual" warning after ~20s of no progress', async () => {
    crmMocks.crmListHouseholds.mockReturnValue(new Promise(() => {}));

    // Render + wire up the click with REAL timers first — Testing Library's
    // findBy/waitFor helpers poll via setTimeout, which would otherwise hang
    // forever once fake timers are installed but never advanced.
    render(<WealthboxConnect />);
    const input = screen.getByPlaceholderText(/wealthbox api key/i);
    fireEvent.change(input, { target: { value: 'test-token-123' } });

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: /connect wealthbox/i }));
    // Flush the microtask chain (crmConnect resolves -> runSync starts ->
    // blocks inside withCrmTimeout, which synchronously arms its own timer)
    // without advancing virtual time yet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      vi.advanceTimersByTime(19_000);
    });
    expect(screen.queryByTestId('wealthbox-stalled')).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(screen.getByTestId('wealthbox-stalled')).toBeInTheDocument();
    expect(screen.getByTestId('wealthbox-stalled')).toHaveTextContent(
      /taking longer than usual/i
    );
  });

  it('fails cleanly (no infinite hang) when crmListHouseholds never settles past the sane timeout', async () => {
    crmMocks.crmListHouseholds.mockReturnValue(new Promise(() => {}));

    render(<WealthboxConnect />);
    const input = screen.getByPlaceholderText(/wealthbox api key/i);
    fireEvent.change(input, { target: { value: 'test-token-123' } });

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: /connect wealthbox/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CRM_LIST_HOUSEHOLDS_TIMEOUT_MS + 1_000);
    });

    expect(screen.getByText(/didn.t respond in time/i)).toBeInTheDocument();
    // The sync must be back to a terminal (non-syncing) state — Stop is gone.
    expect(screen.queryByRole('button', { name: /stop/i })).not.toBeInTheDocument();
  });

  it('still shows Stop once backend crm-sync-progress events start (existing behavior preserved)', async () => {
    crmMocks.crmListHouseholds.mockResolvedValue([
      { id: 'wb-1', name: 'Household 1' },
    ]);
    crmMocks.crmSyncAll.mockReturnValue(new Promise(() => {}));

    render(<WealthboxConnect />);
    const input = await screen.findByPlaceholderText(/wealthbox api key/i);
    fireEvent.change(input, { target: { value: 'test-token-123' } });
    fireEvent.click(screen.getByRole('button', { name: /connect wealthbox/i }));

    const confirmButton = await screen.findByRole('button', { name: /^import$/i });
    fireEvent.click(confirmButton);

    act(() => {
      useCrmStore.getState().setProgress({ status: 'syncing', households: 1, records: 3 });
    });

    expect(await screen.findByRole('button', { name: /stop/i })).toBeInTheDocument();
  });
});
