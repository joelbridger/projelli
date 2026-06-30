import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OneDriveConnect } from '@/platform/connectors/onedrive/OneDriveConnect';
import { useMatterStore } from '@/platform/matter/matterStore';

const oneDriveConnect = vi.fn();
const oneDriveDisconnect = vi.fn();
const oneDriveIsConnected = vi.fn();
const oneDriveListFolders = vi.fn();
const oneDriveSync = vi.fn();
const oneDriveCancel = vi.fn();

vi.mock('@/platform/utils/onedrive-commands', () => ({
  oneDriveCancel: (...args: unknown[]) => oneDriveCancel(...args),
  oneDriveConnect: (...args: unknown[]) => oneDriveConnect(...args),
  oneDriveDisconnect: (...args: unknown[]) => oneDriveDisconnect(...args),
  oneDriveIsConnected: (...args: unknown[]) => oneDriveIsConnected(...args),
  oneDriveListFolders: (...args: unknown[]) => oneDriveListFolders(...args),
  oneDriveSync: (...args: unknown[]) => oneDriveSync(...args),
  ONEDRIVE_SYNC_EVENT: 'onedrive-sync-progress',
}));

vi.mock('@/platform/connectors/onedrive/useOneDriveSync', () => ({
  useOneDriveSync: () => undefined,
}));

vi.mock('@/platform/hooks/useConfidentialityMode', () => ({
  useConfidentialityMode: () => 'direct',
}));

describe('OneDriveConnect folder auto-linking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMatterStore.setState({ matters: [], activeMatterId: null });
    oneDriveIsConnected.mockResolvedValue(false);
    oneDriveConnect.mockResolvedValue(undefined);
    oneDriveDisconnect.mockResolvedValue(undefined);
    oneDriveCancel.mockResolvedValue(undefined);
    oneDriveSync.mockResolvedValue({
      seen: 0,
      downloaded: 0,
      indexed: 0,
      skippedUnchanged: 0,
      removed: 0,
      pendingPdf: 0,
      unsupported: 0,
      repaired: 0,
      deltaReset: false,
      cancelled: false,
    });
  });

  it('auto-links top-level /Clients folders by name before syncing', async () => {
    const matter = useMatterStore.getState().createMatter({
      name: 'Patel, Priya',
      client: 'Patel, Priya',
    });
    oneDriveListFolders.mockResolvedValue([
      {
        key: 'm365/default/drive-a:/clients/patel, priya',
        driveId: 'drive-a',
        itemId: 'folder-patel',
        name: 'Patel, Priya',
        path: '/clients/patel, priya',
      },
      {
        key: 'm365/default/drive-a:/clients/patel, priya/tax',
        driveId: 'drive-a',
        itemId: 'folder-patel-tax',
        name: 'Tax',
        path: '/clients/patel, priya/tax',
      },
    ]);

    render(<OneDriveConnect />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Connect OneDrive' })
    );

    await waitFor(() => {
      expect(oneDriveSync).toHaveBeenCalledWith([
        {
          folderKey: 'm365/default/drive-a:/clients/patel, priya',
          matterId: matter.id,
        },
      ]);
    });
    expect(useMatterStore.getState().matters[0]?.onedriveFolderKeys).toEqual([
      'm365/default/drive-a:/clients/patel, priya',
    ]);
  });
});
