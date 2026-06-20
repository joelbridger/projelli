import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const mockGmailConnect = vi.fn();
const mockGmailIsConnected = vi.fn();
const mockGmailDisconnect = vi.fn();
const mockMailSyncAll = vi.fn();
const mockMailCancelSync = vi.fn();

vi.mock('@/platform/utils/mail-commands', () => ({
  get gmailConnect() { return mockGmailConnect; },
  get gmailIsConnected() { return mockGmailIsConnected; },
  get gmailDisconnect() { return mockGmailDisconnect; },
  get mailSyncAll() { return mockMailSyncAll; },
  get mailCancelSync() { return mockMailCancelSync; },
}));
vi.mock('@/features/email/useMailSync', () => ({ useMailSync: () => {} }));

// useMailStore — mock so we can control progress in stall-watchdog tests.
let mockProgress: { status: string; written: number; provider?: string } | undefined = undefined;
vi.mock('@/features/email/mailStore', () => ({
  useMailStore: (selector: (s: { progressByProvider: Record<string, unknown> }) => unknown) =>
    selector({ progressByProvider: mockProgress ? { gmail: mockProgress } : {} }),
}));

import { MailGmailConnect } from '@/features/settings/MailGmailConnect';

describe('MailGmailConnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProgress = undefined;
    mockGmailIsConnected.mockResolvedValue(false);
    mockGmailConnect.mockResolvedValue(undefined);
    mockGmailDisconnect.mockResolvedValue(undefined);
    mockMailSyncAll.mockResolvedValue(undefined);
    mockMailCancelSync.mockResolvedValue(undefined);
  });

  it('renders Connect Gmail when not connected', async () => {
    render(<MailGmailConnect />);
    // Wait for the mount effect to resolve so the not-connected state is shown.
    await waitFor(() => expect(mockGmailIsConnected).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /connect gmail/i })).toBeInTheDocument();
    expect(screen.queryByText(/connected\./i)).not.toBeInTheDocument();
  });

  it('calls gmailConnect and transitions to Connected on success', async () => {
    render(<MailGmailConnect />);
    await waitFor(() => expect(mockGmailIsConnected).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /connect gmail/i }));

    await waitFor(() => expect(mockGmailConnect).toHaveBeenCalled());
    expect(await screen.findByText(/connected\./i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /connect gmail/i })).not.toBeInTheDocument();
  });

  it('shows error when gmailConnect rejects (no unhandled rejection)', async () => {
    mockGmailConnect.mockRejectedValue(new Error('auth failed'));

    render(<MailGmailConnect />);
    await waitFor(() => expect(mockGmailIsConnected).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /connect gmail/i }));

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByText(/auth failed/i)).toBeInTheDocument();
    // Should not have transitioned to connected state.
    expect(screen.queryByText(/connected\./i)).not.toBeInTheDocument();
  });

  it('shows Connected immediately when gmailIsConnected resolves true on mount', async () => {
    mockGmailIsConnected.mockResolvedValue(true);

    render(<MailGmailConnect />);

    expect(await screen.findByText(/connected\./i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /connect gmail/i })).not.toBeInTheDocument();
  });
});

// BUG-008: Reconnect button (no fake timers needed — just needs connected state)
describe('MailGmailConnect — BUG-008 Reconnect button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProgress = undefined;
    mockGmailIsConnected.mockResolvedValue(true);
    mockGmailConnect.mockResolvedValue(undefined);
    mockGmailDisconnect.mockResolvedValue(undefined);
    mockMailSyncAll.mockResolvedValue(undefined);
    mockMailCancelSync.mockResolvedValue(undefined);
  });

  it('shows Reconnect button when connected', async () => {
    render(<MailGmailConnect />);
    await waitFor(() => expect(mockGmailIsConnected).toHaveBeenCalled());
    expect(await screen.findByTestId('mail-gmail-reconnect')).toBeInTheDocument();
    expect(screen.getByTestId('mail-gmail-reconnect')).toHaveTextContent('Reconnect');
  });

  it('clicking Reconnect calls gmailConnect again', async () => {
    render(<MailGmailConnect />);
    await waitFor(() => expect(mockGmailIsConnected).toHaveBeenCalled());
    const btn = await screen.findByTestId('mail-gmail-reconnect');
    fireEvent.click(btn);
    await waitFor(() => expect(mockGmailConnect).toHaveBeenCalledTimes(1));
  });

  it('Reconnect button is disabled and shows "Reconnecting…" while connecting', async () => {
    mockGmailConnect.mockReturnValue(new Promise(() => {}));
    render(<MailGmailConnect />);
    await waitFor(() => expect(mockGmailIsConnected).toHaveBeenCalled());
    const btn = await screen.findByTestId('mail-gmail-reconnect');
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toHaveTextContent('Reconnecting…'));
    expect(btn).toBeDisabled();
  });

  it('keeps existing Disconnect button when connected', async () => {
    render(<MailGmailConnect />);
    await waitFor(() => expect(mockGmailIsConnected).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: /disconnect/i })).toBeInTheDocument();
  });
});

// BUG-008: sync-stall watchdog (uses fake timers)
describe('MailGmailConnect — BUG-008 stall watchdog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGmailIsConnected.mockResolvedValue(true);
    mockGmailConnect.mockResolvedValue(undefined);
    mockGmailDisconnect.mockResolvedValue(undefined);
    mockMailSyncAll.mockResolvedValue(undefined);
    mockMailCancelSync.mockResolvedValue(undefined);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does NOT show stalled warning before 90 seconds', async () => {
    mockProgress = { status: 'syncing', written: 100, provider: 'gmail' };
    render(<MailGmailConnect />);
    await act(async () => { await Promise.resolve(); });
    act(() => { vi.advanceTimersByTime(89_000); });
    expect(screen.queryByTestId('mail-gmail-stalled')).not.toBeInTheDocument();
  });

  it('shows stalled warning after 90 seconds with no progress', async () => {
    mockProgress = { status: 'syncing', written: 100, provider: 'gmail' };
    render(<MailGmailConnect />);
    await act(async () => { await Promise.resolve(); });
    act(() => { vi.advanceTimersByTime(90_000); });
    expect(screen.getByTestId('mail-gmail-stalled')).toBeInTheDocument();
  });

  it('does not show stalled warning when status is done', async () => {
    mockProgress = { status: 'done', written: 500, provider: 'gmail' };
    render(<MailGmailConnect />);
    await act(async () => { await Promise.resolve(); });
    act(() => { vi.advanceTimersByTime(90_000); });
    expect(screen.queryByTestId('mail-gmail-stalled')).not.toBeInTheDocument();
  });
});
