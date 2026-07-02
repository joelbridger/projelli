import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OneDriveConnect } from '@/platform/connectors/onedrive/OneDriveConnect';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { OneDriveSyncReport } from '@/platform/utils/onedrive-commands';

const oneDriveConnect = vi.fn();
const oneDriveConnectCancel = vi.fn();
const oneDriveDisconnect = vi.fn();
const oneDriveIsConnected = vi.fn();
const oneDriveListFolders = vi.fn();
const oneDriveSync = vi.fn();
const oneDriveCancel = vi.fn();

vi.mock('@/platform/utils/onedrive-commands', () => ({
  oneDriveCancel: (...args: unknown[]) => oneDriveCancel(...args),
  oneDriveConnect: (...args: unknown[]) => oneDriveConnect(...args),
  oneDriveConnectCancel: (...args: unknown[]) => oneDriveConnectCancel(...args),
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
  getConfidentialityMode: () => 'direct',
}));

function report(overrides: Partial<OneDriveSyncReport> = {}): OneDriveSyncReport {
  return {
    seen: 0,
    downloaded: 0,
    imported: 0,
    indexed: 0,
    skippedUnchanged: 0,
    removed: 0,
    pendingPdf: 0,
    unsupported: 0,
    repaired: 0,
    deltaReset: false,
    cancelled: false,
    ...overrides,
  };
}

describe('OneDriveConnect folder auto-linking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMatterStore.setState({ matters: [], activeMatterId: null });
    oneDriveIsConnected.mockResolvedValue(false);
    oneDriveConnect.mockResolvedValue(undefined);
    oneDriveDisconnect.mockResolvedValue(undefined);
    oneDriveCancel.mockResolvedValue(undefined);
    oneDriveSync.mockResolvedValue(report());
  });

  it('auto-links a client folder and sends a disk destination to the backend', async () => {
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
      // The map now carries a workspace-relative `destFolder` so the backend
      // materializes the files into the client's folder on disk.
      expect(oneDriveSync).toHaveBeenCalledWith([
        {
          folderKey: 'm365/default/drive-a:/clients/patel, priya',
          matterId: matter.id,
          destFolder: 'Clients/Patel, Priya',
        },
      ]);
    });
    expect(useMatterStore.getState().matters[0]?.onedriveFolderKeys).toEqual([
      'm365/default/drive-a:/clients/patel, priya',
    ]);
    // A matter with no folder gets an on-disk home so imports show in Documents.
    expect(useMatterStore.getState().matters[0]?.folderPaths).toContain(
      'Clients/Patel, Priya'
    );
  });

  it('auto-links a TOP-LEVEL client-named folder (not only Clients/<name>)', async () => {
    const matter = useMatterStore.getState().createMatter({
      name: 'Webb, Marcus & Tanya',
      client: 'Webb, Marcus & Tanya',
    });
    oneDriveListFolders.mockResolvedValue([
      {
        key: 'm365/default/drive-a:/webb, marcus & tanya',
        driveId: 'drive-a',
        itemId: 'folder-webb',
        name: 'Webb, Marcus & Tanya',
        path: '/webb, marcus & tanya',
      },
    ]);

    render(<OneDriveConnect />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Connect OneDrive' })
    );

    await waitFor(() => {
      expect(useMatterStore.getState().matters[0]?.onedriveFolderKeys).toEqual([
        'm365/default/drive-a:/webb, marcus & tanya',
      ]);
    });
    expect(oneDriveSync).toHaveBeenCalledWith([
      {
        folderKey: 'm365/default/drive-a:/webb, marcus & tanya',
        matterId: matter.id,
        destFolder: 'Clients/Webb, Marcus & Tanya',
      },
    ]);
  });
});

describe('OneDriveConnect honest sync feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMatterStore.setState({ matters: [], activeMatterId: null });
    oneDriveConnect.mockResolvedValue(undefined);
    oneDriveDisconnect.mockResolvedValue(undefined);
    oneDriveCancel.mockResolvedValue(undefined);
    oneDriveListFolders.mockResolvedValue([]);
  });

  it('shows a clear "no new files" message when zero files import', async () => {
    oneDriveIsConnected.mockResolvedValue(true);
    oneDriveSync.mockResolvedValue(report({ seen: 12, imported: 0 }));

    render(<OneDriveConnect />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sync now' }));

    expect(await screen.findByText(/No new files came in/i)).toBeTruthy();
  });

  it('shows the imported count when files import', async () => {
    oneDriveIsConnected.mockResolvedValue(true);
    oneDriveSync.mockResolvedValue(report({ seen: 5, imported: 3 }));

    render(<OneDriveConnect />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sync now' }));

    expect(
      await screen.findByText(/Imported 3 files into your client folders/i)
    ).toBeTruthy();
  });

  it('surfaces a sync error instead of a silent success', async () => {
    oneDriveIsConnected.mockResolvedValue(true);
    oneDriveSync.mockRejectedValue(new Error('graph 500'));

    render(<OneDriveConnect />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sync now' }));

    expect(await screen.findByText(/ran into a problem/i)).toBeTruthy();
  });
});

// F2.4: the OneDrive connect hung on "Waiting for Microsoft sign-in..." for the
// full 5-minute server-side OAuth timeout with no way out. Cancel must abort it
// immediately and restore the UI, leaving the prior connection (if any) intact.
describe('OneDriveConnect — cancel connect (F2.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMatterStore.setState({ matters: [], activeMatterId: null });
    oneDriveIsConnected.mockResolvedValue(false);
    oneDriveConnectCancel.mockResolvedValue(undefined);
    oneDriveListFolders.mockResolvedValue([]);
  });

  it('shows a Cancel button while connecting', async () => {
    oneDriveConnect.mockReturnValue(new Promise(() => {}));
    render(<OneDriveConnect />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect OneDrive' }));
    expect(await screen.findByTestId('onedrive-cancel-connect')).toBeInTheDocument();
  });

  it('does not show a Cancel button when not connecting', async () => {
    render(<OneDriveConnect />);
    await screen.findByRole('button', { name: 'Connect OneDrive' });
    expect(screen.queryByTestId('onedrive-cancel-connect')).not.toBeInTheDocument();
  });

  it('clicking Cancel calls oneDriveConnectCancel and, once the pending connect settles, restores the UI without showing a red error', async () => {
    let rejectConnect: (err: unknown) => void = () => {};
    oneDriveConnect.mockReturnValue(new Promise((_resolve, reject) => { rejectConnect = reject; }));
    render(<OneDriveConnect />);
    const connectBtn = await screen.findByRole('button', { name: 'Connect OneDrive' });
    fireEvent.click(connectBtn);
    await waitFor(() => expect(screen.getByText(/waiting for microsoft sign-in/i)).toBeInTheDocument());

    const cancelBtn = await screen.findByTestId('onedrive-cancel-connect');
    fireEvent.click(cancelBtn);
    await waitFor(() => expect(oneDriveConnectCancel).toHaveBeenCalledTimes(1));

    // Simulate the backend's onedrive_connect promise settling with the
    // "cancelled" error once the abort takes effect (await_redirect_code_or_cancel).
    await act(async () => { rejectConnect('cancelled'); });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Connect OneDrive' })).not.toBeDisabled());
    expect(screen.queryByTestId('onedrive-cancel-connect')).not.toBeInTheDocument();
    expect(screen.queryByText(/cancelled/i)).not.toBeInTheDocument();
  });
});
