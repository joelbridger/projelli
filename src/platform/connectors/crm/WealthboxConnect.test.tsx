import i18n from '@/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const controls = vi.hoisted(() => ({
  crmListHouseholds: vi.fn(),
  crmSyncAll: vi.fn(),
  crmRebuildStore: vi.fn(),
  createCrmRunId: vi.fn(() => 'test-run'),
  createMatter: vi.fn(() => ({ id: 'new-client' })),
}));
const privacy = vi.hoisted(() => ({
  networkLockdown: false,
  nativeLockdown: { blocked: false, pending: false, error: null as string | null },
  retryNativeNetworkLockdown: vi.fn(),
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
      listeners.forEach((l) => {
        l();
      });
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
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
  crmRebuildStore: controls.crmRebuildStore,
  CRM_STORE_RECOVERY_MESSAGE:
    'Saved CRM records cannot be unlocked on this device. Your file search still works. Rebuild the local CRM copy from Wealthbox.',
  isCrmStoreRecoveryError: (error: unknown) =>
    (error instanceof Error ? error.message : String(error)).includes(
      'CRM_STORE_RECOVERY_REQUIRED',
    ),
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
          progress: useSyncExternalStore(
            (l) => crmProgress.subscribe(l),
            () => crmProgress.get(),
          ),
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
vi.mock('@/platform/hooks/usePrivilegedMatterMode', () => ({
  usePrivilegedMatterModeActive: () => privacy.networkLockdown,
}));
vi.mock('@/platform/privacy/nativeNetworkLockdownBridge', () => ({
  useNativeNetworkLockdownBridgeState: () => privacy.nativeLockdown,
  retryNativeNetworkLockdown: privacy.retryNativeNetworkLockdown,
}));

import { WealthboxConnect } from './WealthboxConnect';

async function renderConnectedConnector(): Promise<void> {
  render(<WealthboxConnect />);
  await screen.findByTestId('wealthbox-sync-now');
}

describe('WealthboxConnect sync', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    controls.crmListHouseholds.mockReset();
    controls.crmSyncAll.mockReset();
    controls.crmRebuildStore.mockReset();
    controls.crmRebuildStore.mockResolvedValue(undefined);
    controls.createMatter.mockClear();
    privacy.networkLockdown = false;
    privacy.nativeLockdown = { blocked: false, pending: false, error: null };
    privacy.retryNativeNetworkLockdown.mockReset();
    crmProgress.set(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows an honest pause and disables sync while Network lockdown is on', async () => {
    privacy.networkLockdown = true;
    await renderConnectedConnector();

    expect(screen.getByTestId('wealthbox-network-lockdown-message')).toHaveTextContent(
      /nothing will be sent to or downloaded from wealthbox/i,
    );
    expect(screen.getByTestId('wealthbox-sync-now')).toBeDisabled();
    fireEvent.click(screen.getByTestId('wealthbox-sync-now'));
    expect(controls.crmListHouseholds).not.toHaveBeenCalled();
  });

  it('shows a working retry action when the native privacy update fails', async () => {
    privacy.nativeLockdown = {
      blocked: true,
      pending: false,
      error: 'Network lockdown is still on because the privacy setting could not be updated.',
    };
    await renderConnectedConnector();

    expect(screen.getByTestId('wealthbox-network-lockdown-message')).toHaveTextContent(
      /network lockdown is still on/i,
    );
    fireEvent.click(screen.getByTestId('wealthbox-network-lockdown-retry'));
    expect(privacy.retryNativeNetworkLockdown).toHaveBeenCalledTimes(1);
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

  it('shows a human indexing message and makes Sync now available to retry', async () => {
    controls.crmListHouseholds.mockResolvedValue([{ id: 'household-1', name: 'Avery Family' }]);
    controls.crmSyncAll.mockRejectedValue(new Error('Wealthbox request failed (HTTP 503)'));

    await renderConnectedConnector();
    fireEvent.click(screen.getByTestId('wealthbox-sync-now'));

    fireEvent.click(await screen.findByTestId('confirm-dialog-confirm'));

    expect(await screen.findByText(/Your household was imported.*Try syncing again/i)).toBeTruthy();
    expect(screen.queryByText(/HTTP 503/i)).toBeNull();
    expect(screen.getByTestId('wealthbox-sync-now')).not.toBeDisabled();
  });

  it.each([
    [
      'en',
      "Your household was imported, but we couldn't finish making it searchable in Ask. Try syncing again.",
      "Your 2 households were imported, but we couldn't finish making them searchable in Ask. Try syncing again.",
    ],
    [
      'es',
      'Tu hogar se importó, pero no pudimos terminar de prepararlo para buscarlo en Ask. Intenta sincronizar de nuevo.',
      'Tus 2 hogares se importaron, pero no pudimos terminar de prepararlos para buscarlos en Ask. Intenta sincronizar de nuevo.',
    ],
    [
      'de',
      'Ihr Haushalt wurde importiert, aber wir konnten ihn noch nicht vollständig für die Suche in Ask vorbereiten. Versuchen Sie die Synchronisierung erneut.',
      'Ihre 2 Haushalte wurden importiert, aber wir konnten sie noch nicht vollständig für die Suche in Ask vorbereiten. Versuchen Sie die Synchronisierung erneut.',
    ],
  ])('keeps the human indexing copy translated in %s', (locale, singular, plural) => {
    expect(
      i18n.t('crm.wealthbox.indexing-incomplete', { lng: locale, count: 1 }),
    ).toBe(singular);
    expect(
      i18n.t('crm.wealthbox.indexing-incomplete', { lng: locale, count: 2 }),
    ).toBe(plural);
  });

  it('shows the honest lockdown message if the guarded doorway closes during sync', async () => {
    controls.crmListHouseholds.mockResolvedValue([{ id: 'household-1', name: 'Avery Family' }]);
    controls.crmSyncAll.mockRejectedValue(
      Object.assign(new Error('internal policy generation mismatch'), {
        code: 'NETWORK_LOCKDOWN_BLOCKED',
      }),
    );

    await renderConnectedConnector();
    fireEvent.click(screen.getByTestId('wealthbox-sync-now'));
    fireEvent.click(await screen.findByTestId('confirm-dialog-confirm'));

    expect(
      await screen.findByText(/nothing will be sent to or downloaded from Wealthbox/i),
    ).toBeTruthy();
    expect(screen.queryByText(/internal policy generation mismatch/i)).toBeNull();
    expect(screen.queryByText(/Your household was imported/i)).toBeNull();
  });

  it('offers to rebuild an unreadable CRM store and starts the safe recovery command', async () => {
    controls.crmListHouseholds.mockResolvedValue([{ id: 'household-1', name: 'Avery Family' }]);
    controls.crmSyncAll.mockRejectedValueOnce(
      new Error('CRM_STORE_RECOVERY_REQUIRED: saved CRM records cannot be unlocked'),
    );

    await renderConnectedConnector();
    fireEvent.click(screen.getByTestId('wealthbox-sync-now'));
    fireEvent.click(await screen.findByTestId('confirm-dialog-confirm'));

    expect(await screen.findByText(/file search still works/i)).toBeTruthy();
    expect(screen.queryByText(/CRM_STORE_RECOVERY_REQUIRED/i)).toBeNull();
    fireEvent.click(screen.getByTestId('wealthbox-rebuild-store'));
    fireEvent.click(await screen.findByTestId('confirm-dialog-confirm'));

    await waitFor(() => {
      expect(controls.crmRebuildStore).toHaveBeenCalledTimes(1);
    });
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
