import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const mockOutlookConnect = vi.fn();
const mockMailSyncAll = vi.fn();
const mockMailCancelSync = vi.fn();
const mockMailIsConnected = vi.fn();
const mockMailDisconnect = vi.fn();
const mockMailFdeStatus = vi.fn();

vi.mock('@/platform/utils/mail-commands', () => ({
  get outlookConnect() { return mockOutlookConnect; },
  get mailIsConnected() { return mockMailIsConnected; },
  get mailDisconnect() { return mockMailDisconnect; },
  get mailSyncAll() { return mockMailSyncAll; },
  get mailCancelSync() { return mockMailCancelSync; },
  get mailFdeStatus() { return mockMailFdeStatus; },
  MAIL_SYNC_EVENT: 'mail-sync-progress',
}));
vi.mock('@/platform/connectors/email/useMailSync', () => ({ useMailSync: () => {} }));

// useMailStore is a Zustand store — mock it so we can control progress in tests.
let mockProgress: { status: string; written: number; provider?: string } | undefined = undefined;
vi.mock('@/platform/connectors/email/mailStore', () => ({
  useMailStore: (selector: (s: { progressByProvider: Record<string, unknown> }) => unknown) =>
    selector({ progressByProvider: mockProgress ? { m365: mockProgress } : {} }),
}));

import { MailConnect } from '@/platform/connectors/email/MailConnect';

describe('MailConnect (one-click M365 flow)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProgress = undefined;
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

// BUG-008: Reconnect button (no fake timers needed — just needs connected state)
describe('MailConnect — BUG-008 Reconnect button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProgress = undefined;
    mockMailIsConnected.mockResolvedValue(true);
    mockOutlookConnect.mockResolvedValue(undefined);
    mockMailSyncAll.mockResolvedValue(undefined);
    mockMailCancelSync.mockResolvedValue(undefined);
    mockMailFdeStatus.mockResolvedValue({ status: 'unknown', platform: 'Linux', detail: null });
  });

  it('shows Reconnect button when connected', async () => {
    render(<MailConnect />);
    // Wait for the mount effect (mailIsConnected) to resolve and set connected=true.
    await waitFor(() => expect(mockMailIsConnected).toHaveBeenCalled());
    expect(await screen.findByTestId('mail-m365-reconnect')).toBeInTheDocument();
    expect(screen.getByTestId('mail-m365-reconnect')).toHaveTextContent('Reconnect');
  });

  it('clicking Reconnect calls outlookConnect again', async () => {
    render(<MailConnect />);
    await waitFor(() => expect(mockMailIsConnected).toHaveBeenCalled());
    const btn = await screen.findByTestId('mail-m365-reconnect');
    fireEvent.click(btn);
    await waitFor(() => expect(mockOutlookConnect).toHaveBeenCalledTimes(1));
  });

  it('Reconnect button is disabled and shows "Reconnecting…" while connecting', async () => {
    // outlookConnect never resolves so connecting stays true
    mockOutlookConnect.mockReturnValue(new Promise(() => {}));
    render(<MailConnect />);
    await waitFor(() => expect(mockMailIsConnected).toHaveBeenCalled());
    const btn = await screen.findByTestId('mail-m365-reconnect');
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toHaveTextContent('Reconnecting…'));
    expect(btn).toBeDisabled();
  });
});

// BUG-008 follow-up: M365 Disconnect button (parity with the Gmail panel).
describe('MailConnect — BUG-008 follow-up Disconnect button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProgress = undefined;
    mockMailIsConnected.mockResolvedValue(true);
    mockOutlookConnect.mockResolvedValue(undefined);
    mockMailDisconnect.mockResolvedValue(undefined);
    mockMailSyncAll.mockResolvedValue(undefined);
    mockMailCancelSync.mockResolvedValue(undefined);
    mockMailFdeStatus.mockResolvedValue({ status: 'unknown', platform: 'Linux', detail: null });
  });

  it('shows a Disconnect button when connected', async () => {
    render(<MailConnect />);
    await waitFor(() => expect(mockMailIsConnected).toHaveBeenCalled());
    expect(await screen.findByTestId('mail-m365-disconnect')).toHaveTextContent('Disconnect');
  });

  it('clicking Disconnect cancels sync, calls mailDisconnect, and returns to the Connect state', async () => {
    render(<MailConnect />);
    await waitFor(() => expect(mockMailIsConnected).toHaveBeenCalled());
    fireEvent.click(await screen.findByTestId('mail-m365-disconnect'));
    await waitFor(() => expect(mockMailDisconnect).toHaveBeenCalledTimes(1));
    expect(mockMailCancelSync).toHaveBeenCalled();
    // Back to the disconnected state: the Connect button reappears.
    expect(await screen.findByRole('button', { name: /connect microsoft 365/i })).toBeInTheDocument();
  });

  it('stays honest if mailDisconnect rejects: shows an error and does NOT show a disconnected screen', async () => {
    mockMailDisconnect.mockRejectedValue(new Error('keychain locked'));
    // mailIsConnected resolves true (token still there) — the re-check keeps us connected.
    render(<MailConnect />);
    await waitFor(() => expect(mockMailIsConnected).toHaveBeenCalled());
    fireEvent.click(await screen.findByTestId('mail-m365-disconnect'));
    // The failure surfaces and we do NOT fall back to the "Connect" screen.
    await waitFor(() => expect(screen.getByText(/keychain locked/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /connect microsoft 365/i })).not.toBeInTheDocument();
  });
});

// BUG-008: sync-stall watchdog (uses fake timers)
describe('MailConnect — BUG-008 stall watchdog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMailIsConnected.mockResolvedValue(true);
    mockOutlookConnect.mockResolvedValue(undefined);
    mockMailSyncAll.mockResolvedValue(undefined);
    mockMailCancelSync.mockResolvedValue(undefined);
    mockMailFdeStatus.mockResolvedValue({ status: 'unknown', platform: 'Linux', detail: null });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does NOT show stalled warning before 90 seconds', async () => {
    mockProgress = { status: 'syncing', written: 100, provider: 'm365' };
    render(<MailConnect />);
    // Flush initial mount effects and render with syncing progress.
    await act(async () => { await Promise.resolve(); });
    act(() => { vi.advanceTimersByTime(89_000); });
    expect(screen.queryByTestId('mail-m365-stalled')).not.toBeInTheDocument();
  });

  it('shows stalled warning after 90 seconds with no progress', async () => {
    mockProgress = { status: 'syncing', written: 100, provider: 'm365' };
    render(<MailConnect />);
    await act(async () => { await Promise.resolve(); });
    act(() => { vi.advanceTimersByTime(90_000); });
    expect(screen.getByTestId('mail-m365-stalled')).toBeInTheDocument();
  });

  it('does not show stalled warning when status is done', async () => {
    mockProgress = { status: 'done', written: 500, provider: 'm365' };
    render(<MailConnect />);
    await act(async () => { await Promise.resolve(); });
    act(() => { vi.advanceTimersByTime(90_000); });
    expect(screen.queryByTestId('mail-m365-stalled')).not.toBeInTheDocument();
  });
});
