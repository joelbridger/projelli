import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mailIsConnected = vi.fn();
const mailFdeStatus = vi.fn();
const gmailIsConnected = vi.fn();
const gmailOauthConfigured = vi.fn();
const mailImapIsConnected = vi.fn();
const oneDriveIsConnected = vi.fn();
const crmIsConnected = vi.fn();
const calendlyIsConnected = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
}));

vi.mock('@/platform/utils/mail-commands', () => ({
  outlookConnect: vi.fn(),
  outlookConnectCancel: vi.fn(),
  mailIsConnected: () => mailIsConnected(),
  mailDisconnect: vi.fn(),
  mailSyncAll: vi.fn(),
  mailCancelSync: vi.fn(),
  mailFdeStatus: () => mailFdeStatus(),
  gmailConnect: vi.fn(),
  gmailConnectCancel: vi.fn(),
  gmailOauthConfigured: () => gmailOauthConfigured(),
  gmailIsConnected: () => gmailIsConnected(),
  gmailDisconnect: vi.fn(),
  mailImapConnect: vi.fn(),
  mailImapIsConnected: () => mailImapIsConnected(),
  mailImapDisconnect: vi.fn(),
  isDesktopOnlyMailError: (message: string | null | undefined) =>
    Boolean(message && /desktop app/i.test(message)),
  MAIL_SYNC_EVENT: 'mail-sync-progress',
}));

vi.mock('@/platform/connectors/email/useMailSync', () => ({ useMailSync: () => undefined }));
vi.mock('@/platform/connectors/email/mailStore', () => ({
  useMailStore: (selector: (state: { progressByProvider: Record<string, unknown> }) => unknown) =>
    selector({ progressByProvider: {} }),
}));

vi.mock('@/platform/utils/onedrive-commands', () => ({
  oneDriveCancel: vi.fn(),
  oneDriveConnect: vi.fn(),
  oneDriveConnectCancel: vi.fn(),
  oneDriveDisconnect: vi.fn(),
  oneDriveIsConnected: () => oneDriveIsConnected(),
  oneDriveListFolders: vi.fn(),
  oneDriveSync: vi.fn(),
  ONEDRIVE_SYNC_EVENT: 'onedrive-sync-progress',
}));
vi.mock('@/platform/connectors/onedrive/useOneDriveSync', () => ({ useOneDriveSync: () => undefined }));
vi.mock('@/platform/hooks/useConfidentialityMode', () => ({
  useConfidentialityMode: () => 'direct',
  getConfidentialityMode: () => 'direct',
}));

vi.mock('@/platform/utils/wealthbox-commands', () => ({
  crmConnect: vi.fn(),
  crmIsConnected: () => crmIsConnected(),
  crmDisconnect: vi.fn(),
  crmListHouseholds: vi.fn(),
  crmSyncAll: vi.fn(),
  crmCancelSync: vi.fn(),
  CRM_SYNC_EVENT: 'crm-sync-progress',
}));
vi.mock('@/platform/connectors/crm/useCrmSync', () => ({ useCrmSync: () => undefined }));

vi.mock('@/platform/utils/calendly-commands', () => ({
  calendlyCancelSync: vi.fn(),
  calendlyConnect: vi.fn(),
  calendlyDisconnect: vi.fn(),
  calendlyIsConnected: () => calendlyIsConnected(),
  calendlySyncAll: vi.fn(),
}));
vi.mock('@/platform/connectors/calendly/useCalendlySync', () => ({ useCalendlySync: () => undefined }));

import { CalendlyConnect } from '@/platform/connectors/calendly/CalendlyConnect';
import { WealthboxConnect } from '@/platform/connectors/crm/WealthboxConnect';
import { MailConnect } from '@/platform/connectors/email/MailConnect';
import { MailGmailConnect } from '@/platform/connectors/email/MailGmailConnect';
import { MailImapConnect } from '@/platform/connectors/email/MailImapConnect';
import { OneDriveConnect } from '@/platform/connectors/onedrive/OneDriveConnect';

afterEach(cleanup);

describe('shipping connector honesty-card triggers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mailIsConnected.mockResolvedValue(false);
    mailFdeStatus.mockResolvedValue({ status: 'unknown', platform: 'Linux', detail: null });
    gmailIsConnected.mockResolvedValue(false);
    gmailOauthConfigured.mockResolvedValue(true);
    mailImapIsConnected.mockResolvedValue(false);
    oneDriveIsConnected.mockResolvedValue(false);
    crmIsConnected.mockResolvedValue(false);
    calendlyIsConnected.mockResolvedValue(false);
  });

  it('shows the email card trigger on every email connect surface', async () => {
    render(
      <>
        <MailConnect />
        <MailGmailConnect />
        <MailImapConnect />
      </>
    );

    await waitFor(() => expect(mailIsConnected).toHaveBeenCalled());
    expect(screen.getAllByTestId('integration-honesty-trigger-email')).toHaveLength(3);
  });

  it('shows the OneDrive and SharePoint card trigger', async () => {
    render(<OneDriveConnect />);
    await waitFor(() => expect(oneDriveIsConnected).toHaveBeenCalled());
    expect(screen.getByTestId('integration-honesty-trigger-onedrive-sharepoint')).toBeInTheDocument();
  });

  it('shows the Wealthbox card trigger', async () => {
    render(<WealthboxConnect />);
    await waitFor(() => expect(crmIsConnected).toHaveBeenCalled());
    expect(screen.getByTestId('integration-honesty-trigger-wealthbox')).toBeInTheDocument();
  });

  it('shows the Calendly card trigger', async () => {
    render(<CalendlyConnect />);
    await waitFor(() => expect(calendlyIsConnected).toHaveBeenCalled());
    expect(screen.getByTestId('integration-honesty-trigger-calendly')).toBeInTheDocument();
  });
});
