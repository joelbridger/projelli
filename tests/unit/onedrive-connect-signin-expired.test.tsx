/**
 * Fix 4 (connect-flow demo hardening): an expired Microsoft sign-in used to
 * surface as raw engineer-speak next to "OneDrive sync ran into a problem:"
 * (e.g. "scope_upgrade_required", "refresh failed: invalid_grant") with no
 * obvious way to fix it. It now shows one plain message with a Reconnect
 * action.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OneDriveConnect } from '@/platform/connectors/onedrive/OneDriveConnect';
import { useMatterStore } from '@/platform/matter/matterStore';

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

describe('OneDriveConnect — expired Microsoft sign-in (Fix 4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMatterStore.setState({ matters: [], activeMatterId: null });
    oneDriveIsConnected.mockResolvedValue(true);
    oneDriveConnect.mockResolvedValue(undefined);
    oneDriveDisconnect.mockResolvedValue(undefined);
    oneDriveCancel.mockResolvedValue(undefined);
    oneDriveListFolders.mockResolvedValue([]);
  });

  it('shows the plain "sign-in expired" message instead of the raw scope_upgrade_required sentinel', async () => {
    oneDriveSync.mockRejectedValue(new Error('scope_upgrade_required'));

    render(<OneDriveConnect />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sync now' }));

    expect(await screen.findByText(/your microsoft sign-in expired/i)).toBeInTheDocument();
    expect(screen.queryByText(/scope_upgrade_required/i)).not.toBeInTheDocument();
  });

  it('shows a Reconnect action next to the expired-sign-in message', async () => {
    oneDriveSync.mockRejectedValue(new Error('refresh failed: invalid_grant'));

    render(<OneDriveConnect />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sync now' }));

    await screen.findByText(/your microsoft sign-in expired/i);
    expect(screen.getByTestId('onedrive-reconnect')).toBeInTheDocument();
  });

  it('clicking Reconnect re-runs the OAuth connect flow', async () => {
    oneDriveSync.mockRejectedValue(new Error('not connected'));

    render(<OneDriveConnect />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sync now' }));
    const reconnectBtn = await screen.findByTestId('onedrive-reconnect');

    fireEvent.click(reconnectBtn);
    await waitFor(() => expect(oneDriveConnect).toHaveBeenCalledTimes(1));
  });

  it('does NOT show Reconnect for an ordinary (non-expiry) sync failure', async () => {
    oneDriveSync.mockRejectedValue(new Error('graph 500'));

    render(<OneDriveConnect />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sync now' }));

    await screen.findByText(/ran into a problem/i);
    expect(screen.queryByTestId('onedrive-reconnect')).not.toBeInTheDocument();
  });
});
