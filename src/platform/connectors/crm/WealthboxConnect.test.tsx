import '@/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const controls = vi.hoisted(() => ({
  crmListHouseholds: vi.fn(),
  crmSyncAll: vi.fn(),
  createCrmRunId: vi.fn(() => 'test-run'),
  createMatter: vi.fn(() => ({ id: 'new-client' })),
}));

// Stateful progress mock: tests can emit progress events into the rendered
// component the way the real crm store does, to prove late events cannot
// repaint state over an open Import/Cancel question.
const crmProgress = vi.hoisted(() => {
  type Progress = { status: string; households?: number; records?: number } | null;
  let value: Progress = null;
  const listeners = new Set<() => void>();
  return {
    get: (): Progress => value,
    set(next: Progress) {
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    reset() {
      value = null;
      listeners.clear();
    },
  };
});

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('@/platform/utils/wealthbox-commands', () => ({
  crmConnect: vi.fn(),
  crmIsConnected: vi.fn(() => Promise.resolve(true)),
  crmDisconnect: vi.fn(),
  crmListHouseholds: controls.crmListHouseholds,
  crmSyncAll: controls.crmSyncAll,
  createCrmRunId: controls.createCrmRunId,
  crmCancelSync: vi.fn(),
}));
vi.mock('@/platform/connectors/crm/useCrmSync', () => ({ useCrmSync: () => {} }));
vi.mock('@/platform/connectors/crm/crmStore', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useCrmStore: Object.assign(
      (selector: (state: { progress: unknown }) => unknown) =>
        selector({
          progress: useSyncExternalStore(crmProgress.subscribe, crmProgress.get),
        }),
      { getState: () => ({ startRun: vi.fn(), finishRun: vi.fn(), setProgress: vi.fn() }) },
    ),
  };
});
vi.mock('@/platform/matter/matterStore', () => ({
  getMatters: () => [],
  useMatterStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    createMatter: controls.createMatter,
    addCrmHouseholdKey: vi.fn(),
    setMatterArchived: vi.fn(),
  }),
}));
vi.mock('@/platform/matter/crmMatterFolderBackfill', () => ({
  attachCrmHouseholdFolderIfUnmapped: () => null,
  buildClaimedCrmFolderSet: () => new Set(),
}));
vi.mock('@/platform/rag/matterResolver', () => ({
  buildCrmMatterMap: () => [],
  filterCrmMatterMapForProvider: () => [],
  resolveMatterForHousehold: () => ({ action: 'create' }),
}));
vi.mock('@/platform/connectors/IntegrationHonestyCard', () => ({
  IntegrationHonestyCard: () => null,
}));
vi.mock('@/platform/connectors/wealthbox/WealthboxCustomFieldsAvailability', () => ({
  WealthboxCustomFieldsAvailability: () => null,
}));
vi.mock('@/ui/InfoHelp', () => ({ InfoHelp: () => null }));
vi.mock('@/config/brandText', () => ({ brandText: (text: string) => text }));

import { WealthboxConnect } from './WealthboxConnect';

async function renderConnectedConnector(): Promise<void> {
  render(<WealthboxConnect />);
  await screen.findByTestId('wealthbox-sync-now');
}

describe('WealthboxConnect sync', () => {
  beforeEach(() => {
    controls.crmListHouseholds.mockReset();
    controls.crmSyncAll.mockReset();
    controls.createMatter.mockClear();
    crmProgress.set(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('dispatches the desktop sync command after the advisor confirms the household import', async () => {
    controls.crmListHouseholds.mockResolvedValue([{ id: 'household-1', name: 'Avery Family' }]);
    controls.crmSyncAll.mockResolvedValue({ householdsProcessed: 1, recordsIndexed: 4 });

    await renderConnectedConnector();
    fireEvent.click(screen.getByTestId('wealthbox-sync-now'));

    await waitFor(() => {
      expect(controls.crmListHouseholds).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByTestId('confirm-dialog')).toBeTruthy();
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    await waitFor(() => {
      expect(controls.crmSyncAll).toHaveBeenCalledWith([], 'test-run');
    });
    await waitFor(() => {
      expect(screen.getByTestId('wealthbox-sync-now')).not.toBeDisabled();
    });
  });

  it('shows the backend failure and makes Sync now available to retry', async () => {
    controls.crmListHouseholds.mockResolvedValue([{ id: 'household-1', name: 'Avery Family' }]);
    controls.crmSyncAll.mockRejectedValue(new Error('Wealthbox request failed (HTTP 503)'));

    await renderConnectedConnector();
    fireEvent.click(screen.getByTestId('wealthbox-sync-now'));

    fireEvent.click(await screen.findByTestId('confirm-dialog-confirm'));

    expect(await screen.findByText(/HTTP 503/i)).toBeTruthy();
    expect(screen.getByTestId('wealthbox-sync-now')).not.toBeDisabled();
  });

  it('keeps retry disabled until the Rust command has finished stopping safely', async () => {
    controls.crmListHouseholds.mockResolvedValue([{ id: 'household-1', name: 'Avery Family' }]);
    let finishSync: ((value: { householdsProcessed: number; recordsIndexed: number }) => void) | undefined;
    controls.crmSyncAll.mockImplementation(() => new Promise((resolve) => {
      finishSync = resolve;
    }));

    await renderConnectedConnector();
    fireEvent.click(screen.getByTestId('wealthbox-sync-now'));

    fireEvent.click(await screen.findByTestId('confirm-dialog-confirm'));

    await waitFor(() => {
      expect(controls.crmSyncAll).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('wealthbox-sync-now')).toBeDisabled();
    fireEvent.click(screen.getByTestId('wealthbox-sync-now'));
    expect(controls.crmSyncAll).toHaveBeenCalledTimes(1);
    await act(async () => {
      if (!finishSync) throw new Error('sync resolver was not set');
      finishSync({ householdsProcessed: 1, recordsIndexed: 4 });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId('wealthbox-sync-now')).not.toBeDisabled();
    });
  });

  it('shows a decision state, not syncing, while Import or Cancel is unanswered', async () => {
    controls.crmListHouseholds.mockResolvedValue([{ id: 'household-1', name: 'Avery Family' }]);

    await renderConnectedConnector();
    fireEvent.click(screen.getByTestId('wealthbox-sync-now'));

    expect(await screen.findByTestId('confirm-dialog')).toBeTruthy();
    expect(screen.getByTestId('wealthbox-awaiting-import-confirmation')).toHaveTextContent(
      'Choose Import or Cancel',
    );
    expect(screen.queryByText('Checking your Wealthbox households…')).toBeNull();
    expect(screen.getByTestId('wealthbox-sync-now')).toHaveTextContent('Choose Import or Cancel');
    expect(controls.crmSyncAll).not.toHaveBeenCalled();
  });

  it('ignores a late connecting event while Import or Cancel is open', async () => {
    controls.crmListHouseholds.mockResolvedValue([{ id: 'household-1', name: 'Avery Family' }]);

    await renderConnectedConnector();
    fireEvent.click(screen.getByTestId('wealthbox-sync-now'));
    expect(await screen.findByTestId('confirm-dialog')).toBeTruthy();

    // A delayed progress event from the already-finished household check
    // arrives while the question is open — it must NOT repaint "Syncing".
    await act(async () => {
      crmProgress.set({ status: 'connecting' });
      await Promise.resolve();
    });

    expect(screen.getByTestId('wealthbox-sync-now')).toHaveTextContent('Choose Import or Cancel');
    expect(screen.queryByText(/Syncing/)).toBeNull();
    expect(screen.getByTestId('wealthbox-awaiting-import-confirmation')).toBeTruthy();
  });
});
