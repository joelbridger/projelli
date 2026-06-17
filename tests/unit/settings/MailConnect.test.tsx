import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockMailPollLogin = vi.fn();
const mockMailBeginLogin = vi.fn();
const mockMailSyncAll = vi.fn();
const mockMailCancelSync = vi.fn();
const mockMailIsConnected = vi.fn();
const mockMailFdeStatus = vi.fn();

vi.mock('@/platform/utils/mail-commands', () => ({
  get mailIsConnected() { return mockMailIsConnected; },
  get mailBeginLogin() { return mockMailBeginLogin; },
  get mailPollLogin() { return mockMailPollLogin; },
  get mailSyncAll() { return mockMailSyncAll; },
  get mailCancelSync() { return mockMailCancelSync; },
  get mailFdeStatus() { return mockMailFdeStatus; },
  MAIL_SYNC_EVENT: 'mail-sync-progress',
}));
vi.mock('@/features/email/useMailSync', () => ({ useMailSync: () => {} }));

import { MailConnect } from '@/features/settings/MailConnect';

// Prompt with a 1-second interval so fake-timer tests can advance cheaply.
const DEFAULT_PROMPT = {
  userCode: 'WXYZ',
  verificationUri: 'https://microsoft.com/devicelogin',
  deviceCode: 'DC',
  intervalSecs: 1,
  expiresInSecs: 900,
};

describe('MailConnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMailIsConnected.mockResolvedValue(false);
    mockMailBeginLogin.mockResolvedValue({ ...DEFAULT_PROMPT });
    mockMailPollLogin.mockResolvedValue('pending');
    mockMailSyncAll.mockResolvedValue(undefined);
    mockMailCancelSync.mockResolvedValue(undefined);
    // G6: default to 'unknown' so FDE nudge is hidden in existing tests.
    mockMailFdeStatus.mockResolvedValue({ status: 'unknown', platform: 'Linux', detail: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the device code after clicking Connect', async () => {
    render(<MailConnect />);
    fireEvent.click(await screen.findByRole('button', { name: /connect microsoft 365/i }));
    expect(await screen.findByText(/WXYZ/)).toBeInTheDocument();
    expect(screen.getByText(/microsoft\.com\/devicelogin/i)).toBeInTheDocument();
  });

  it('transitions to connected when poll returns authorized', async () => {
    // Poll returns authorized (signed in). Real timers: the first poll fires
    // ~1s after the prompt appears (intervalSecs: 1).
    mockMailPollLogin.mockResolvedValue('authorized');

    render(<MailConnect />);

    const btn = await screen.findByRole('button', { name: /connect microsoft 365/i });
    fireEvent.click(btn);

    expect(await screen.findByText(/WXYZ/)).toBeInTheDocument();

    await waitFor(
      () => expect(screen.getByText(/connected\./i)).toBeInTheDocument(),
      { timeout: 4000 },
    );
  });

  it('shows error state and Try again button when poll throws', async () => {
    mockMailPollLogin.mockRejectedValue(new Error('keychain failure'));

    render(<MailConnect />);

    const btn = await screen.findByRole('button', { name: /connect microsoft 365/i });
    fireEvent.click(btn);

    expect(await screen.findByText(/WXYZ/)).toBeInTheDocument();

    await waitFor(
      () => expect(screen.getByText(/something went wrong/i)).toBeInTheDocument(),
      { timeout: 4000 },
    );
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
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
    // Give time for the effect to resolve.
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
