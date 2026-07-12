/**
 * Adversarial review finding: "Wealthbox connect/sync can look frozen" — the
 * backend retries a Wealthbox 429 for a long time (client.rs), and until now
 * the frontend had no timeout and no visible Stop affordance while the first
 * `crmListHouseholds()` call was in flight (before the backend's own
 * `crm-sync-progress` events start). This test drives the REAL
 * `WealthboxConnect` component with fake timers and asserts:
 *
 *   1. After ~20s of a real network wait with no progress, a "taking longer
 *      than usual" warning appears. The Import/Cancel question is a user
 *      decision, not a network wait, so it must never trigger that warning.
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
  createCrmRunId: vi.fn(() => 'test-run'),
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

  it('clicking Stop during the household-list phase actually ends the wait (Round 2 P2 fix) — no need to wait out the 90s timeout', async () => {
    // Round 2 review finding: crm_cancel_sync only sets a flag engine::backfill
    // polls between households during crm_sync_all — crm_list_households never
    // observes it, so the OLD Stop button did nothing during this phase. The
    // mock below never resolves, simulating a stuck/rate-limited household
    // list call; if Stop were still a no-op here, the UI would stay on
    // "Connecting to Wealthbox..." until the real assertion below times out.
    crmMocks.crmListHouseholds.mockReturnValue(new Promise(() => {}));

    await connectAndStartSync();

    const stopButton = await screen.findByRole('button', { name: /stop/i });
    fireEvent.click(stopButton);

    // Settles to "stopped" almost immediately (real timers, well under the
    // 90s CRM_LIST_HOUSEHOLDS_TIMEOUT_MS ceiling) — proof Stop is now real,
    // not merely "eventually times out anyway".
    expect(await screen.findByText(/sync stopped/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /stop/i })).not.toBeInTheDocument();
  });

  it('shows a "taking longer than usual" warning after ~20s of a real backend sync wait', async () => {
    crmMocks.crmListHouseholds.mockResolvedValue([
      { id: 'wb-1', name: 'Household 1' },
    ]);
    crmMocks.crmSyncAll.mockReturnValue(new Promise(() => {}));

    // Render + wire up the click with REAL timers first — Testing Library's
    // findBy/waitFor helpers poll via setTimeout, which would otherwise hang
    // forever once fake timers are installed but never advanced.
    render(<WealthboxConnect />);
    const input = screen.getByPlaceholderText(/wealthbox api key/i);
    fireEvent.change(input, { target: { value: 'test-token-123' } });

    fireEvent.click(screen.getByRole('button', { name: /connect wealthbox/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^import$/i }));

    // The confirmed import starts the backend network phase. Only then do we
    // start virtual time, so the watchdog is testing a real wait rather than
    // the intentionally idle Import/Cancel decision state.
    vi.useFakeTimers();
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
      useCrmStore.getState().setProgress({ runId: 'test-run', status: 'syncing', households: 1, records: 3 });
    });

    expect(await screen.findByRole('button', { name: /stop/i })).toBeInTheDocument();
  });
});
