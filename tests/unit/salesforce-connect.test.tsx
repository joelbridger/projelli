import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: vi.fn().mockResolvedValue(undefined),
}));

const crmOAuthConnect = vi.fn();
const crmOAuthConnectCancel = vi.fn();
const crmIsConnected = vi.fn();
const crmDisconnect = vi.fn();
const crmListHouseholds = vi.fn();
const crmSyncAll = vi.fn();
const crmCancelSync = vi.fn();

vi.mock('@/platform/utils/wealthbox-commands', () => ({
  crmOAuthConnect: (...args: unknown[]) => crmOAuthConnect(...args),
  crmOAuthConnectCancel: (...args: unknown[]) => crmOAuthConnectCancel(...args),
  crmIsConnected: (...args: unknown[]) => crmIsConnected(...args),
  crmDisconnect: (...args: unknown[]) => crmDisconnect(...args),
  crmListHouseholds: (...args: unknown[]) => crmListHouseholds(...args),
  crmSyncAll: (...args: unknown[]) => crmSyncAll(...args),
  crmCancelSync: (...args: unknown[]) => crmCancelSync(...args),
  CRM_SYNC_EVENT: 'crm-sync-progress',
}));

vi.mock('@/platform/connectors/crm/useCrmSync', () => ({
  useCrmSync: () => undefined,
}));

import { SalesforceConnect } from '@/platform/connectors/crm/SalesforceConnect';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useOfflineModeStore } from '@/platform/privacy/offlineMode';

// F2.4: Salesforce OAuth connect hung on "Connecting..." for the full 5-minute
// server-side timeout with no way out. Cancel must abort it immediately and
// restore the UI, leaving the prior connection (if any) intact.
describe('SalesforceConnect — cancel connect (F2.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOfflineModeStore.setState({
      offlineMode: false,
      generation: 1,
      hydrated: true,
      loadError: null,
      statusKnown: true,
      changePending: false,
      changeError: null,
    });
    useMatterStore.setState({ matters: [], activeMatterId: null });
    crmIsConnected.mockResolvedValue(false);
    crmOAuthConnectCancel.mockResolvedValue(undefined);
  });

  it('shows the Connect button when not connected', async () => {
    render(<SalesforceConnect />);
    expect(await screen.findByRole('button', { name: /connect salesforce/i })).toBeInTheDocument();
  });

  it('shows a Cancel button while connecting', async () => {
    crmOAuthConnect.mockReturnValue(new Promise(() => {}));
    render(<SalesforceConnect />);
    fireEvent.click(await screen.findByRole('button', { name: /connect salesforce/i }));
    expect(await screen.findByTestId('salesforce-cancel-connect')).toBeInTheDocument();
  });

  it('does not show a Cancel button when not connecting', async () => {
    render(<SalesforceConnect />);
    await screen.findByRole('button', { name: /connect salesforce/i });
    expect(screen.queryByTestId('salesforce-cancel-connect')).not.toBeInTheDocument();
  });

  it('clicking Cancel calls crmOAuthConnectCancel and, once the pending connect settles, restores the UI without showing a red error', async () => {
    let rejectConnect: (err: unknown) => void = () => {};
    crmOAuthConnect.mockReturnValue(new Promise((_resolve, reject) => { rejectConnect = reject; }));
    render(<SalesforceConnect />);
    const connectBtn = await screen.findByRole('button', { name: /connect salesforce/i });
    fireEvent.click(connectBtn);
    await waitFor(() => expect(screen.getByText(/connecting\.\.\./i)).toBeInTheDocument());

    const cancelBtn = await screen.findByTestId('salesforce-cancel-connect');
    fireEvent.click(cancelBtn);
    await waitFor(() => expect(crmOAuthConnectCancel).toHaveBeenCalledTimes(1));

    // Simulate the backend's crm_oauth_connect promise settling with the
    // "cancelled" error once the abort takes effect (await_redirect_code_or_cancel).
    await act(async () => { rejectConnect('cancelled'); });

    await waitFor(() => expect(screen.getByRole('button', { name: /connect salesforce/i })).not.toBeDisabled());
    expect(screen.queryByTestId('salesforce-cancel-connect')).not.toBeInTheDocument();
    expect(screen.queryByText(/^cancelled$/i)).not.toBeInTheDocument();
  });
});
