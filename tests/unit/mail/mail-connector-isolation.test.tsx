import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, within, act } from '@testing-library/react';

// These two panels are rendered together in the Account window. Before the fix
// they shared one global sync-progress object, so a Gmail import showed its count
// on the Microsoft 365 panel, and a Microsoft 365 error showed on the Gmail panel
// (exactly what Windows testing surfaced). This test drives the REAL mail store and
// asserts each panel now reacts only to its own provider.

vi.mock('@/platform/utils/mail-commands', () => ({
  outlookConnect: vi.fn().mockResolvedValue(undefined),
  gmailConnect: vi.fn().mockResolvedValue(undefined),
  gmailDisconnect: vi.fn().mockResolvedValue(undefined),
  mailIsConnected: vi.fn().mockResolvedValue(true),
  gmailIsConnected: vi.fn().mockResolvedValue(true),
  mailSyncAll: vi.fn().mockResolvedValue(undefined),
  mailCancelSync: vi.fn().mockResolvedValue(undefined),
  mailFdeStatus: vi.fn().mockResolvedValue({ status: 'unknown', platform: 'Linux', detail: null }),
  MAIL_SYNC_EVENT: 'mail-sync-progress',
}));
// Drive the store directly rather than through the Tauri event listener.
vi.mock('@/platform/connectors/email/useMailSync', () => ({ useMailSync: () => {} }));

import { MailConnect } from '@/platform/connectors/email/MailConnect';
import { MailGmailConnect } from '@/platform/connectors/email/MailGmailConnect';
import { useMailStore } from '@/platform/connectors/email/mailStore';

describe('mail connector panels are isolated per provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMailStore.setState({ progressByProvider: {} });
  });

  it('shows a Gmail import count only on the Gmail panel, not on Microsoft 365', async () => {
    const m365 = render(<MailConnect />);
    const gmail = render(<MailGmailConnect />);
    await within(m365.container).findByText(/connected\./i);
    await within(gmail.container).findByText(/connected\./i);

    // A Gmail import is in progress (368 messages so far).
    act(() => {
      useMailStore.getState().setProgress({ provider: 'gmail', status: 'syncing', written: 368, removed: 0 });
    });

    // Gmail panel shows the live count...
    await within(gmail.container).findByText(/importing.*368/i);
    // ...the Microsoft 365 panel shows neither the spinner nor the borrowed count.
    expect(within(m365.container).queryByText(/importing/i)).toBeNull();
    expect(within(m365.container).queryByText(/368/)).toBeNull();
  });

  it('shows a Microsoft 365 sync error only on the Microsoft 365 panel', async () => {
    const m365 = render(<MailConnect />);
    const gmail = render(<MailGmailConnect />);
    await within(m365.container).findByText(/connected\./i);
    await within(gmail.container).findByText(/connected\./i);

    // Microsoft 365 sync failed; Gmail is mid-import and never connected to this error.
    act(() => {
      useMailStore.getState().setProgress({ provider: 'gmail', status: 'syncing', written: 12, removed: 0 });
      useMailStore.getState().setProgress({ provider: 'm365', status: 'error', written: 0, removed: 0 });
    });

    await within(m365.container).findByText(/ran into a problem/i);
    // The Gmail panel does NOT show the Microsoft 365 error; it keeps importing.
    expect(within(gmail.container).queryByText(/ran into a problem/i)).toBeNull();
    await within(gmail.container).findByText(/importing.*12/i);
  });
});
