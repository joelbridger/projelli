import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockOutlookConnect = vi.fn();
const mockMailSyncAll = vi.fn();
const mockMailCancelSync = vi.fn();
const mockMailIsConnected = vi.fn();
const mockMailFdeStatus = vi.fn();

vi.mock('@/platform/utils/mail-commands', () => ({
  get outlookConnect() { return mockOutlookConnect; },
  get mailIsConnected() { return mockMailIsConnected; },
  get mailSyncAll() { return mockMailSyncAll; },
  get mailCancelSync() { return mockMailCancelSync; },
  get mailFdeStatus() { return mockMailFdeStatus; },
  MAIL_SYNC_EVENT: 'mail-sync-progress',
}));
vi.mock('@/features/email/useMailSync', () => ({ useMailSync: () => {} }));

import { MailConnect } from '@/features/settings/MailConnect';

describe('MailConnect (one-click M365 flow)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMailIsConnected.mockResolvedValue(false);
    mockOutlookConnect.mockResolvedValue(undefined);
    mockMailSyncAll.mockResolvedValue(undefined);
    mockMailCancelSync.mockResolvedValue(undefined);
    // G6: default to 'unknown' so FDE nudge is hidden in existing tests.
    mockMailFdeStatus.mockResolvedValue({ status: 'unknown', platform: 'Linux', detail: null });
  });

  it('shows the Connect button when not connected', async () => {
    render(<MailConnect />);
    expect(await screen.findByRole('button', { name: /connect microsoft 365/i })).toBeInTheDocument();
  });

  it('shows waiting state while connecting', async () => {
    // outlookConnect never resolves so the button stays in "waiting" state
    mockOutlookConnect.mockReturnValue(new Promise(() => {}));
    render(<MailConnect />);
    fireEvent.click(await screen.findByRole('button', { name: /connect microsoft 365/i }));
    expect(await screen.findByText(/waiting for sign-in/i)).toBeInTheDocument();
  });

  it('transitions to connected when outlookConnect resolves', async () => {
    render(<MailConnect />);
    fireEvent.click(await screen.findByRole('button', { name: /connect microsoft 365/i }));
    await waitFor(() => expect(screen.getByText(/connected\./i)).toBeInTheDocument());
  });

  it('shows error when outlookConnect rejects with an Error', async () => {
    mockOutlookConnect.mockRejectedValue(new Error('oauth failure'));
    render(<MailConnect />);
    fireEvent.click(await screen.findByRole('button', { name: /connect microsoft 365/i }));
    await waitFor(() => expect(screen.getByText(/something went wrong/i)).toBeInTheDocument());
    expect(screen.getByText(/oauth failure/i)).toBeInTheDocument();
  });

  it('surfaces raw string errors from Tauri invoke', async () => {
    mockOutlookConnect.mockRejectedValue('access_denied');
    render(<MailConnect />);
    fireEvent.click(await screen.findByRole('button', { name: /connect microsoft 365/i }));
    await waitFor(() => expect(screen.getByText(/access_denied/i)).toBeInTheDocument());
  });

  // G6: FDE nudge tests
  it('shows FDE nudge when status is off', async () => {
    mockMailFdeStatus.mockResolvedValue({ status: 'off', platform: 'Windows', detail: null });
    render(<MailConnect />);
    expect(await screen.findByText(/full.disk encryption/i)).toBeInTheDocument();
  });

  it('does not show FDE nudge when status is on', async () => {
    mockMailFdeStatus.mockResolvedValue({ status: 'on', platform: 'macOS', detail: null });
    render(<MailConnect />);
    await waitFor(() => expect(mockMailFdeStatus).toHaveBeenCalled());
    expect(screen.queryByText(/full.disk encryption/i)).not.toBeInTheDocument();
  });

  it('does not show FDE nudge when status is unknown', async () => {
    mockMailFdeStatus.mockResolvedValue({ status: 'unknown', platform: 'Linux', detail: 'lsblk unavailable' });
    render(<MailConnect />);
    await waitFor(() => expect(mockMailFdeStatus).toHaveBeenCalled());
    expect(screen.queryByText(/full.disk encryption/i)).not.toBeInTheDocument();
  });
});
