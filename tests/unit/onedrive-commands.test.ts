import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: () => true,
}));

import { invoke } from '@tauri-apps/api/core';

describe('onedrive-commands', () => {
  beforeEach(() => vi.clearAllMocks());

  it('points the OneDrive backend at the workspace', async () => {
    (invoke as any).mockResolvedValue(undefined);
    const { oneDriveSetWorkspace } = await import('@/platform/utils/onedrive-commands');
    await oneDriveSetWorkspace('/home/u/ws');
    expect(invoke).toHaveBeenCalledWith('onedrive_set_workspace', { path: '/home/u/ws' });
  });

  it('connects with the dedicated OneDrive command', async () => {
    (invoke as any).mockResolvedValue(undefined);
    const { oneDriveConnect } = await import('@/platform/utils/onedrive-commands');
    await oneDriveConnect();
    expect(invoke).toHaveBeenCalledWith('onedrive_connect');
  });

  it('sync forwards the matter map', async () => {
    (invoke as any).mockResolvedValue({ seen: 1, downloaded: 1, indexed: 1 });
    const { oneDriveSync } = await import('@/platform/utils/onedrive-commands');
    const map = [{ folderKey: 'm365/default/drive-a:/clients/acme', matterId: 'matter-a', destFolder: '' }];
    await oneDriveSync(map);
    expect(invoke).toHaveBeenCalledWith('onedrive_sync', { matterMap: map });
  });

  it('exports the sync event name', async () => {
    const { ONEDRIVE_SYNC_EVENT } = await import('@/platform/utils/onedrive-commands');
    expect(ONEDRIVE_SYNC_EVENT).toBe('onedrive-sync-progress');
  });
});
