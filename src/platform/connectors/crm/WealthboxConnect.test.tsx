import '@/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const controls = vi.hoisted(() => ({
  crmListHouseholds: vi.fn(),
  crmSyncAll: vi.fn(),
  confirm: vi.fn(),
  createMatter: vi.fn(() => ({ id: 'new-client' })),
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('@/platform/utils/wealthbox-commands', () => ({
  crmConnect: vi.fn(),
  crmIsConnected: vi.fn(() => Promise.resolve(true)),
  crmDisconnect: vi.fn(),
  crmListHouseholds: controls.crmListHouseholds,
  crmSyncAll: controls.crmSyncAll,
  crmCancelSync: vi.fn(),
}));
vi.mock('@/platform/connectors/crm/useCrmSync', () => ({ useCrmSync: () => {} }));
vi.mock('@/platform/connectors/crm/crmStore', () => ({
  useCrmStore: (selector: (state: { progress: null }) => unknown) => selector({ progress: null }),
}));
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
vi.mock('@/platform/hooks/useConfirmDialog', () => ({
  useConfirmDialog: () => ({ confirm: controls.confirm, dialogProps: {} }),
}));
vi.mock('@/platform/connectors/IntegrationHonestyCard', () => ({
  IntegrationHonestyCard: () => null,
}));
vi.mock('@/platform/connectors/wealthbox/WealthboxCustomFieldsAvailability', () => ({
  WealthboxCustomFieldsAvailability: () => null,
}));
vi.mock('@/ui/InfoHelp', () => ({ InfoHelp: () => null }));
vi.mock('@/ui/ConfirmDialog', () => ({ ConfirmDialog: () => null }));
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
    controls.confirm.mockReset();
    controls.createMatter.mockClear();
    controls.confirm.mockResolvedValue(true);
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
    await waitFor(() => {
      expect(controls.confirm).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(controls.crmSyncAll).toHaveBeenCalledWith([]);
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
});
