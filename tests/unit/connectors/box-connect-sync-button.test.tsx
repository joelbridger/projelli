import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BoxConnect } from '@/platform/connectors/box/BoxConnect';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { SK_SETTINGS } from '@/config/identity';
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

describe('BoxConnect Local-only guard', () => {
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
    expect(screen.queryByText(/local-only mode is on/i)).toBeNull();
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

  it('blocks the sync when the confidentiality mode is genuinely local-only', async () => {
    useSettingsStore.getState().setSetting('confidentialityMode', 'local-only');

    render(<BoxConnect />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sync Box files' }));

    expect(await screen.findByText(/local-only mode is on\. turn it off before syncing box/i)).toBeTruthy();
    expect(boxSync).not.toHaveBeenCalled();
  });

  it('blocks a genuinely-persisted local-only mode during the settings-store hydration window', async () => {
    // The in-memory Zustand settings store reports the schema default
    // ('direct') until it rehydrates from storage. Writing straight to the
    // persisted key (bypassing the store) reproduces exactly that race: a
    // real Local-only user's click, right at app start, before hydration
    // completes.
    localStorage.setItem(
      SK_SETTINGS,
      JSON.stringify({ state: { values: { confidentialityMode: 'local-only' } }, version: 1 })
    );

    render(<BoxConnect />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sync Box files' }));

    expect(await screen.findByText(/local-only mode is on\. turn it off before syncing box/i)).toBeTruthy();
    expect(boxSync).not.toHaveBeenCalled();
  });

  it('regression: blocks the bulk sync if the user flips to local-only while autoLinkBoxFolders is still awaiting Box', async () => {
    // autoLinkBoxFolders() itself awaits a Box call (boxListFolders) before
    // the bulk sync. A user who flips to Local-only during that window must
    // still have the larger boxSync() call blocked, not just the initial
    // pre-check.
    boxListFolders.mockImplementation(async () => {
      useSettingsStore.getState().setSetting('confidentialityMode', 'local-only');
      return [];
    });
    boxSync.mockResolvedValue(report());

    render(<BoxConnect />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sync Box files' }));

    expect(await screen.findByText(/local-only mode is on\. turn it off before syncing box/i)).toBeTruthy();
    expect(boxSync).not.toHaveBeenCalled();
  });

  it('blocks Connect Box during the hydration window too', async () => {
    boxIsConnected.mockResolvedValue(false);
    localStorage.setItem(
      SK_SETTINGS,
      JSON.stringify({ state: { values: { confidentialityMode: 'local-only' } }, version: 1 })
    );

    render(<BoxConnect />);

    fireEvent.change(await screen.findByLabelText('Paste your Box Developer Token'), {
      target: { value: 'tok' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Box' }));

    expect(
      await screen.findByText(/local-only mode is on\. turn it off before connecting box/i)
    ).toBeTruthy();
    expect(boxConnect).not.toHaveBeenCalled();
  });
});
