import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareFileConnect } from '@/platform/connectors/sharefile/ShareFileConnect';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import type { SharefileSyncReport } from '@/platform/utils/sharefile-commands';

const sharefileCancel = vi.fn();
const sharefileConnect = vi.fn();
const sharefileDisconnect = vi.fn();
const sharefileIsConnected = vi.fn();
const sharefileListFolders = vi.fn();
const sharefileSync = vi.fn();

vi.mock('@/platform/utils/sharefile-commands', () => ({
  SHAREFILE_SYNC_EVENT: 'sharefile-sync-progress',
  sharefileCancel: (...args: unknown[]) => sharefileCancel(...args),
  sharefileConnect: (...args: unknown[]) => sharefileConnect(...args),
  sharefileDisconnect: (...args: unknown[]) => sharefileDisconnect(...args),
  sharefileIsConnected: (...args: unknown[]) => sharefileIsConnected(...args),
  sharefileListFolders: (...args: unknown[]) => sharefileListFolders(...args),
  sharefileSync: (...args: unknown[]) => sharefileSync(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('@/platform/matter/matterStore', () => ({
  getMatters: vi.fn().mockReturnValue([]),
  useMatterStore: (selector: (s: { addSharefileFolderKey: () => void }) => unknown) =>
    selector({ addSharefileFolderKey: vi.fn() }),
}));

vi.mock('@/platform/rag/matterResolver', () => ({
  buildSharefileMatterMap: vi.fn().mockReturnValue([]),
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));

function report(overrides: Partial<SharefileSyncReport> = {}): SharefileSyncReport {
  return {
    seen: 0,
    downloaded: 0,
    indexed: 0,
    removed: 0,
    pendingPdf: 0,
    ...overrides,
  } as SharefileSyncReport;
}

describe('ShareFileConnect Sync now button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useSettingsStore.getState().resetAll();
    sharefileIsConnected.mockResolvedValue(true);
    sharefileListFolders.mockResolvedValue([]);
    sharefileConnect.mockResolvedValue(undefined);
    sharefileDisconnect.mockResolvedValue(undefined);
    sharefileCancel.mockResolvedValue(undefined);
  });

  it('fires the sync when clicked with no explicit confidentiality choice persisted yet', async () => {
    sharefileSync.mockResolvedValue(report({ seen: 3, downloaded: 2, indexed: 2 }));

    render(<ShareFileConnect />);

    const button = await screen.findByRole('button', { name: 'Sync now' });
    expect(button).not.toBeDisabled();

    fireEvent.click(button);

    await waitFor(() => {
      expect(sharefileSync).toHaveBeenCalled();
    });
    expect(screen.queryByText(/local-only mode is on/i)).toBeNull();
  });

  it('still blocks the sync when the confidentiality mode is genuinely local-only', async () => {
    useSettingsStore.getState().setSetting('confidentialityMode', 'local-only');

    render(<ShareFileConnect />);

    const button = await screen.findByRole('button', { name: 'Sync now' });
    expect(button).toBeDisabled();

    fireEvent.click(button);

    expect(sharefileSync).not.toHaveBeenCalled();
  });
});
