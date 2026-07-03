import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const mockGmailConnect = vi.fn();
const mockGmailConnectCancel = vi.fn();
const mockGmailOauthConfigured = vi.fn();
const mockGmailIsConnected = vi.fn();
const mockGmailDisconnect = vi.fn();
const mockMailSyncAll = vi.fn();
const mockMailCancelSync = vi.fn();

vi.mock('@/platform/utils/mail-commands', () => ({
  get gmailConnect() { return mockGmailConnect; },
  get gmailConnectCancel() { return mockGmailConnectCancel; },
  get gmailOauthConfigured() { return mockGmailOauthConfigured; },
  get gmailIsConnected() { return mockGmailIsConnected; },
  get gmailDisconnect() { return mockGmailDisconnect; },
  get mailSyncAll() { return mockMailSyncAll; },
  get mailCancelSync() { return mockMailCancelSync; },
  // Pure helper used to choose info-note vs error tone (UX-22).
  isDesktopOnlyMailError: (m: string | null | undefined) => !!m && /desktop app/i.test(m),
}));
vi.mock('@/platform/connectors/email/useMailSync', () => ({ useMailSync: () => {} }));

// useMailStore — mock so we can control progress in stall-watchdog tests.
let mockProgress: { status: string; written: number; provider?: string } | undefined = undefined;
vi.mock('@/platform/connectors/email/mailStore', () => ({
  useMailStore: (selector: (s: { progressByProvider: Record<string, unknown> }) => unknown) =>
    selector({ progressByProvider: mockProgress ? { gmail: mockProgress } : {} }),
}));

import { MailGmailConnect } from '@/platform/connectors/email/MailGmailConnect';

describe('MailGmailConnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProgress = undefined;
    mockGmailIsConnected.mockResolvedValue(false);
    mockGmailConnect.mockResolvedValue(undefined);
    mockGmailConnectCancel.mockResolvedValue(undefined);
    mockGmailOauthConfigured.mockResolvedValue(true);
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

  it('shows a calm info note (not a red alarm) for the desktop-only limitation — UX-22', async () => {
    mockGmailConnect.mockRejectedValue(new Error('Email connect is only available in the desktop app.'));

    render(<MailGmailConnect />);
    await waitFor(() => expect(mockGmailIsConnected).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /connect gmail/i }));

    expect(await screen.findByText(/email connects in the Advisor Prep Hero desktop app/i)).toBeInTheDocument();
    // The alarm framing must NOT be used for an expected limitation.
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
  });

  it('shows Connected immediately when gmailIsConnected resolves true on mount', async () => {
    mockGmailIsConnected.mockResolvedValue(true);

    render(<MailGmailConnect />);

    expect(await screen.findByText(/connected\./i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /connect gmail/i })).not.toBeInTheDocument();
  });

  // The bug this fixes: the "not configured" and "stuck waiting" gap found in
  // bench-pass2 item 9 — Gmail OAuth failed with a raw Google "missing
  // client_id" error, and the "Waiting for Google sign-in…" state never
  // cleared on cancel/error short of closing and reopening the panel.
  it('shows a calm "not set up" note and disables Connect when this build has no Google client credentials', async () => {
    mockGmailOauthConfigured.mockResolvedValue(false);

    render(<MailGmailConnect />);
    await waitFor(() => expect(mockGmailOauthConfigured).toHaveBeenCalled());

    expect(await screen.findByTestId('mail-gmail-not-configured')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /connect gmail/i })).toBeDisabled();
    // Not a red alarm — this is a build/setup gap, not something the user did wrong.
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
  });

  it('does not show the "not set up" note when this build has Google client credentials', async () => {
    render(<MailGmailConnect />);
    await waitFor(() => expect(mockGmailOauthConfigured).toHaveBeenCalled());

    expect(screen.queryByTestId('mail-gmail-not-configured')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /connect gmail/i })).not.toBeDisabled();
  });

  it('shows a Cancel button while waiting for Google sign-in', async () => {
    mockGmailConnect.mockReturnValue(new Promise(() => {}));
    render(<MailGmailConnect />);
    await waitFor(() => expect(mockGmailIsConnected).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /connect gmail/i }));

    expect(await screen.findByTestId('mail-gmail-cancel-connect')).toBeInTheDocument();
  });

  it('does not show a Cancel button when not connecting', async () => {
    render(<MailGmailConnect />);
    await waitFor(() => expect(mockGmailIsConnected).toHaveBeenCalled());
    await screen.findByRole('button', { name: /connect gmail/i });
    expect(screen.queryByTestId('mail-gmail-cancel-connect')).not.toBeInTheDocument();
  });

  it('clicking Cancel calls gmailConnectCancel and, once the pending connect settles, resets the waiting state instead of leaving it stuck', async () => {
    let rejectConnect: (err: unknown) => void = () => {};
    mockGmailConnect.mockReturnValue(new Promise((_resolve, reject) => { rejectConnect = reject; }));
    render(<MailGmailConnect />);
    await waitFor(() => expect(mockGmailIsConnected).toHaveBeenCalled());

    const connectBtn = screen.getByRole('button', { name: /connect gmail/i });
    fireEvent.click(connectBtn);
    await waitFor(() => expect(connectBtn).toHaveTextContent('Waiting for Google sign-in in your browser…'));

    const cancelBtn = await screen.findByTestId('mail-gmail-cancel-connect');
    fireEvent.click(cancelBtn);
    await waitFor(() => expect(mockGmailConnectCancel).toHaveBeenCalledTimes(1));

    // Simulate the backend's gmail_connect promise settling with the
    // "cancelled" error once the abort takes effect (the real Rust side is
    // gmail_connect_cancel + await_redirect_code_or_cancel).
    act(() => { rejectConnect('cancelled'); });

    // The button re-enables and goes back to "Connect Gmail" — the panel is
    // never left stuck on "Waiting for Google sign-in…" requiring a manual
    // close/reopen of the Connections panel to recover.
    await waitFor(() => expect(connectBtn).not.toBeDisabled());
    expect(connectBtn).toHaveTextContent('Connect Gmail');
    expect(screen.queryByTestId('mail-gmail-cancel-connect')).not.toBeInTheDocument();
    // A user-initiated cancel is not a "Something went wrong" failure.
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^cancelled$/i)).not.toBeInTheDocument();
  });

  it('resets the waiting state on a real connect error too (not just cancel)', async () => {
    let rejectConnect: (err: unknown) => void = () => {};
    mockGmailConnect.mockReturnValue(new Promise((_resolve, reject) => { rejectConnect = reject; }));
    render(<MailGmailConnect />);
    await waitFor(() => expect(mockGmailIsConnected).toHaveBeenCalled());

    const connectBtn = screen.getByRole('button', { name: /connect gmail/i });
    fireEvent.click(connectBtn);
    await waitFor(() => expect(connectBtn).toHaveTextContent('Waiting for Google sign-in in your browser…'));

    // Simulate the browser tab erroring/closing without the user clicking Cancel.
    act(() => { rejectConnect(new Error('redirect timed out')); });

    await waitFor(() => expect(connectBtn).not.toBeDisabled());
    expect(connectBtn).toHaveTextContent('Connect Gmail');
    expect(screen.queryByTestId('mail-gmail-cancel-connect')).not.toBeInTheDocument();
    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
  });
});

// BUG-008: Reconnect button (no fake timers needed — just needs connected state)
describe('MailGmailConnect — BUG-008 Reconnect button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProgress = undefined;
    mockGmailIsConnected.mockResolvedValue(true);
    mockGmailConnect.mockResolvedValue(undefined);
    mockGmailConnectCancel.mockResolvedValue(undefined);
    mockGmailOauthConfigured.mockResolvedValue(true);
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

  it('clicking Cancel during Reconnect calls gmailConnectCancel and restores the Reconnect button instead of leaving it stuck', async () => {
    let rejectConnect: (err: unknown) => void = () => {};
    mockGmailConnect.mockReturnValue(new Promise((_resolve, reject) => { rejectConnect = reject; }));
    render(<MailGmailConnect />);
    await waitFor(() => expect(mockGmailIsConnected).toHaveBeenCalled());
    const reconnectBtn = await screen.findByTestId('mail-gmail-reconnect');
    fireEvent.click(reconnectBtn);
    await waitFor(() => expect(reconnectBtn).toHaveTextContent('Reconnecting…'));

    const cancelBtn = await screen.findByTestId('mail-gmail-cancel-connect');
    fireEvent.click(cancelBtn);
    await waitFor(() => expect(mockGmailConnectCancel).toHaveBeenCalledTimes(1));

    act(() => { rejectConnect('cancelled'); });

    await waitFor(() => expect(reconnectBtn).not.toBeDisabled());
    expect(reconnectBtn).toHaveTextContent('Reconnect');
    expect(screen.queryByTestId('mail-gmail-cancel-connect')).not.toBeInTheDocument();
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
    // The prior working connection was never touched.
    expect(mockGmailDisconnect).not.toHaveBeenCalled();
    expect(screen.getByText(/connected\./i)).toBeInTheDocument();
  });

  // Codex review finding on the not-configured fix: a token saved by an
  // earlier (properly configured) build can leave this panel showing
  // "Connected" even though THIS build has no Google OAuth credentials —
  // without this, clicking Reconnect would silently fail with zero feedback.
  it('shows the "not set up" note and disables Reconnect when a token exists but this build has no Google client credentials', async () => {
    mockGmailOauthConfigured.mockResolvedValue(false);

    render(<MailGmailConnect />);
    await waitFor(() => expect(mockGmailOauthConfigured).toHaveBeenCalled());

    expect(screen.getByText(/connected\./i)).toBeInTheDocument();
    expect(await screen.findByTestId('mail-gmail-not-configured')).toBeInTheDocument();
    expect(screen.getByTestId('mail-gmail-reconnect')).toBeDisabled();
  });
});

// BUG-008: sync-stall watchdog (uses fake timers)
describe('MailGmailConnect — BUG-008 stall watchdog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGmailIsConnected.mockResolvedValue(true);
    mockGmailConnect.mockResolvedValue(undefined);
    mockGmailConnectCancel.mockResolvedValue(undefined);
    mockGmailOauthConfigured.mockResolvedValue(true);
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
