import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZocksConnect } from '@/platform/connectors/zocks/ZocksConnect';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import type { ZocksSyncReport } from '@/platform/utils/zocks-commands';

const zocksCancel = vi.fn();
const zocksConnect = vi.fn();
const zocksDisconnect = vi.fn();
const zocksIsConnected = vi.fn();
const zocksListUnassigned = vi.fn();
const zocksSync = vi.fn();

vi.mock('@/platform/utils/zocks-commands', () => ({
  ZOCKS_SYNC_EVENT: 'zocks-sync-progress',
  zocksCancel: (...args: unknown[]) => zocksCancel(...args),
  zocksConnect: (...args: unknown[]) => zocksConnect(...args),
  zocksDisconnect: (...args: unknown[]) => zocksDisconnect(...args),
  zocksIsConnected: (...args: unknown[]) => zocksIsConnected(...args),
  zocksListUnassigned: (...args: unknown[]) => zocksListUnassigned(...args),
  zocksSync: (...args: unknown[]) => zocksSync(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('@/platform/matter/matterStore', () => ({
  getMatters: vi.fn().mockReturnValue([]),
}));

vi.mock('@/platform/rag/matterResolver', () => ({
  buildZocksMatterMap: vi.fn().mockReturnValue([]),
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));

function report(overrides: Partial<ZocksSyncReport> = {}): ZocksSyncReport {
  return {
    sessionsFetched: 0,
    recordsIndexed: 0,
    needsAssignment: 0,
    fetchFailures: 0,
    ...overrides,
  } as ZocksSyncReport;
}

const OFFLINE_BLOCK = 'Offline Mode is on. Lantern cannot connect to the internet.';

describe('ZocksConnect Offline Mode guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useSettingsStore.getState().resetAll();
    zocksIsConnected.mockResolvedValue(true);
    zocksListUnassigned.mockResolvedValue([]);
    zocksConnect.mockResolvedValue({ baseUrl: 'https://zocks.example', endpointStatus: 'ok' });
    zocksDisconnect.mockResolvedValue({ tokenDeleted: true, ragPurged: true, dataRemains: false, warnings: [] });
    zocksCancel.mockResolvedValue(undefined);
  });

  it('fires the sync when clicked with no explicit confidentiality choice persisted yet', async () => {
    zocksSync.mockResolvedValue(report({ sessionsFetched: 2, recordsIndexed: 2 }));

    render(<ZocksConnect />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sync Zocks meetings' }));

    await waitFor(() => {
      expect(zocksSync).toHaveBeenCalled();
    });
    expect(screen.queryByText(/offline mode is on/i)).toBeNull();
  });

  it('allows the sync when the persisted mode is explicitly direct', async () => {
    useSettingsStore.getState().setSetting('confidentialityMode', 'direct');
    zocksSync.mockResolvedValue(report());

    render(<ZocksConnect />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sync Zocks meetings' }));

    await waitFor(() => {
      expect(zocksSync).toHaveBeenCalled();
    });
  });

  it('shows the native Offline Mode refusal before a sync can begin', async () => {
    zocksSync.mockRejectedValue(new Error(OFFLINE_BLOCK));

    render(<ZocksConnect />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sync Zocks meetings' }));

    expect(
      await screen.findByText(OFFLINE_BLOCK)
    ).toBeTruthy();
    expect(zocksSync).toHaveBeenCalledOnce();
  });

  it('leaves Local AI only free to start a connector sync', async () => {
    useSettingsStore.getState().setSetting('confidentialityMode', 'local-only');
    zocksSync.mockResolvedValue(report());

    render(<ZocksConnect />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sync Zocks meetings' }));

    await waitFor(() => expect(zocksSync).toHaveBeenCalled());
  });

  it('shows the native Offline Mode refusal before connecting Zocks', async () => {
    zocksIsConnected.mockResolvedValue(false);
    zocksConnect.mockRejectedValue(new Error(OFFLINE_BLOCK));

    render(<ZocksConnect />);
    fireEvent.change(await screen.findByPlaceholderText('Zocks API key'), { target: { value: 'k' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Zocks' }));

    expect(
      await screen.findByText(OFFLINE_BLOCK)
    ).toBeTruthy();
    expect(zocksConnect).toHaveBeenCalledOnce();
  });

  it('stops follow-up work when Offline Mode cancels an in-progress sync', async () => {
    zocksSync.mockImplementation(async () => {
      throw new Error(OFFLINE_BLOCK);
    });

    render(<ZocksConnect />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sync Zocks meetings' }));

    await waitFor(() => {
      expect(zocksSync).toHaveBeenCalled();
    });
    expect(await screen.findByText(OFFLINE_BLOCK)).toBeTruthy();
    expect(zocksListUnassigned).not.toHaveBeenCalled();
  });
});
