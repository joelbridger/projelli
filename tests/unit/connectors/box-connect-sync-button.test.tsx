import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BoxConnect } from '@/platform/connectors/box/BoxConnect';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import type { BoxSyncReport } from '@/platform/utils/box-commands';

const boxCancel = vi.fn();
const boxConnect = vi.fn();
const boxDisconnect = vi.fn();
const boxIsConnected = vi.fn();
const boxListFolders = vi.fn();
const boxStatus = vi.fn();
const boxSync = vi.fn();

vi.mock('@/platform/utils/box-commands', () => ({
  BOX_SYNC_EVENT: 'box-sync-progress',
  boxCancel: (...args: unknown[]) => boxCancel(...args),
  boxConnect: (...args: unknown[]) => boxConnect(...args),
  boxDisconnect: (...args: unknown[]) => boxDisconnect(...args),
  boxIsConnected: (...args: unknown[]) => boxIsConnected(...args),
  boxListFolders: (...args: unknown[]) => boxListFolders(...args),
  boxStatus: (...args: unknown[]) => boxStatus(...args),
  boxSync: (...args: unknown[]) => boxSync(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('@/platform/matter/matterStore', () => ({
  getMatters: vi.fn().mockReturnValue([]),
  useMatterStore: (selector: (s: { addBoxFolderKey: () => void }) => unknown) =>
    selector({ addBoxFolderKey: vi.fn() }),
}));

vi.mock('@/platform/rag/matterResolver', () => ({
  buildBoxMatterMap: vi.fn().mockReturnValue([]),
  isTopLevelBoxClientFolder: vi.fn().mockReturnValue(false),
  resolveMatterForBoxFolder: vi.fn().mockReturnValue({ action: 'skip' }),
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));

function report(overrides: Partial<BoxSyncReport> = {}): BoxSyncReport {
  return {
    seen: 0,
    downloaded: 0,
    indexed: 0,
    skippedUnchanged: 0,
    removed: 0,
    pendingPdf: 0,
    cancelled: false,
    ...overrides,
  } as BoxSyncReport;
}

const OFFLINE_BLOCK = 'Offline Mode is on. Lantern cannot connect to the internet.';

describe('BoxConnect Offline Mode guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useSettingsStore.getState().resetAll();
    boxIsConnected.mockResolvedValue(true);
    boxStatus.mockResolvedValue({ isSyncing: false, lastReport: null });
    boxListFolders.mockResolvedValue([]);
    boxConnect.mockResolvedValue(undefined);
    boxDisconnect.mockResolvedValue(undefined);
    boxCancel.mockResolvedValue(undefined);
  });

  it('fires the sync when clicked with no explicit confidentiality choice persisted yet', async () => {
    boxSync.mockResolvedValue(report({ seen: 3, downloaded: 2, indexed: 2 }));

    render(<BoxConnect />);

    const button = await screen.findByRole('button', { name: 'Sync Box files' });
    fireEvent.click(button);

    await waitFor(() => {
      expect(boxSync).toHaveBeenCalled();
    });
    expect(screen.queryByText(/offline mode is on/i)).toBeNull();
  });

  it('allows the sync when the persisted mode is explicitly direct', async () => {
    useSettingsStore.getState().setSetting('confidentialityMode', 'direct');
    boxSync.mockResolvedValue(report());

    render(<BoxConnect />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sync Box files' }));

    await waitFor(() => {
      expect(boxSync).toHaveBeenCalled();
    });
  });

  it('shows the native Offline Mode refusal before a sync can begin', async () => {
    boxListFolders.mockRejectedValue(new Error(OFFLINE_BLOCK));

    render(<BoxConnect />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sync Box files' }));

    expect(await screen.findByText(OFFLINE_BLOCK)).toBeTruthy();
    expect(boxSync).not.toHaveBeenCalled();
  });

  it('leaves Local AI only free to start a connector sync', async () => {
    useSettingsStore.getState().setSetting('confidentialityMode', 'local-only');
    boxSync.mockResolvedValue(report());

    render(<BoxConnect />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sync Box files' }));

    await waitFor(() => expect(boxSync).toHaveBeenCalled());
  });

  it('stops before bulk sync when Offline Mode turns on during folder listing', async () => {
    boxListFolders.mockImplementation(async () => {
      throw new Error(OFFLINE_BLOCK);
    });
    boxSync.mockResolvedValue(report());

    render(<BoxConnect />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sync Box files' }));

    expect(await screen.findByText(OFFLINE_BLOCK)).toBeTruthy();
    expect(boxSync).not.toHaveBeenCalled();
  });

  it('shows the native Offline Mode refusal before connecting Box', async () => {
    boxIsConnected.mockResolvedValue(false);
    boxConnect.mockRejectedValue(new Error(OFFLINE_BLOCK));

    render(<BoxConnect />);

    fireEvent.change(await screen.findByLabelText('Paste your Box Developer Token'), {
      target: { value: 'tok' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Box' }));

    expect(
      await screen.findByText(OFFLINE_BLOCK)
    ).toBeTruthy();
    expect(boxConnect).toHaveBeenCalledOnce();
  });
});
