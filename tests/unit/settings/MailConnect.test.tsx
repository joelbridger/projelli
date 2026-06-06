import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const mockMailPollLogin = vi.fn();
const mockMailBeginLogin = vi.fn();
const mockMailSyncAll = vi.fn();
const mockMailIsConnected = vi.fn();

vi.mock('@/utils/mail-commands', () => ({
  get mailIsConnected() { return mockMailIsConnected; },
  get mailBeginLogin() { return mockMailBeginLogin; },
  get mailPollLogin() { return mockMailPollLogin; },
  get mailSyncAll() { return mockMailSyncAll; },
  MAIL_SYNC_EVENT: 'mail-sync-progress',
}));
vi.mock('@/hooks/useMailSync', () => ({ useMailSync: () => {} }));

import { MailConnect } from '@/components/settings/MailConnect';

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
    mockMailPollLogin.mockResolvedValue(false);
    mockMailSyncAll.mockResolvedValue(undefined);
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

  it('transitions to connected when poll returns true', async () => {
    // Poll immediately returns true (signed in).
    mockMailPollLogin.mockResolvedValue(true);

    // Use fake timers but allow real Date/promises so findBy* still works.
    vi.useFakeTimers({ shouldAdvanceTime: false, toFake: ['setInterval', 'clearInterval'] });

    render(<MailConnect />);

    // Wait for the connect button with real-timer-safe query.
    const btn = await screen.findByRole('button', { name: /connect microsoft 365/i });
    fireEvent.click(btn);

    // Wait for the prompt to appear (mailBeginLogin resolves).
    expect(await screen.findByText(/WXYZ/)).toBeInTheDocument();

    // Advance past the 1-second interval and flush promises.
    await act(async () => {
      vi.advanceTimersByTime(1100);
      await vi.runAllTimersAsync();
    });

    await waitFor(() => expect(screen.getByText(/connected\./i)).toBeInTheDocument());
  });

  it('shows error state and Try again button when poll throws', async () => {
    mockMailPollLogin.mockRejectedValue(new Error('keychain failure'));

    vi.useFakeTimers({ shouldAdvanceTime: false, toFake: ['setInterval', 'clearInterval'] });

    render(<MailConnect />);

    const btn = await screen.findByRole('button', { name: /connect microsoft 365/i });
    fireEvent.click(btn);

    // Wait for the prompt to appear.
    expect(await screen.findByText(/WXYZ/)).toBeInTheDocument();

    // Advance past the 1-second interval and flush promises.
    await act(async () => {
      vi.advanceTimersByTime(1100);
      await vi.runAllTimersAsync();
    });

    await waitFor(() => expect(screen.getByText(/something went wrong/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
