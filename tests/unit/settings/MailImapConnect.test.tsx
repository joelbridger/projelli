import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockMailImapConnect = vi.fn();
const mockMailImapIsConnected = vi.fn();
const mockMailImapDisconnect = vi.fn();
const mockMailSyncAll = vi.fn();
const mockMailCancelSync = vi.fn();

vi.mock('@/platform/utils/mail-commands', () => ({
  get mailImapConnect() { return mockMailImapConnect; },
  get mailImapIsConnected() { return mockMailImapIsConnected; },
  get mailImapDisconnect() { return mockMailImapDisconnect; },
  get mailSyncAll() { return mockMailSyncAll; },
  get mailCancelSync() { return mockMailCancelSync; },
}));

// Connect = IMPORT: the panel now kicks off a sync after auth (mirroring
// Gmail/Microsoft). Mock the sync wiring so the unit test stays focused.
vi.mock('@/platform/connectors/email/useMailSync', () => ({ useMailSync: () => {} }));
vi.mock('@/platform/connectors/email/mailStore', () => ({
  useMailStore: (sel: (s: { progressByProvider: Record<string, unknown> }) => unknown) =>
    sel({ progressByProvider: {} }),
}));
vi.mock('@/platform/matter/matterStore', () => ({ getMatters: () => [] }));
vi.mock('@/platform/rag/matterResolver', () => ({ buildMailMatterMap: () => [] }));

import { MailImapConnect } from '@/platform/connectors/email/MailImapConnect';

describe('MailImapConnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMailImapIsConnected.mockResolvedValue(false);
    mockMailImapConnect.mockResolvedValue(undefined);
    mockMailImapDisconnect.mockResolvedValue(undefined);
    mockMailSyncAll.mockResolvedValue(undefined);
    mockMailCancelSync.mockResolvedValue(undefined);
  });

  it('renders the connect form when not connected', async () => {
    render(<MailImapConnect />);
    // Wait for the mount effect to resolve so the not-connected form is shown.
    await waitFor(() => expect(mockMailImapIsConnected).toHaveBeenCalled());
    expect(screen.getByLabelText(/host/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/port/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email \/ username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/app password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^connect$/i })).toBeInTheDocument();
  });

  it('calls mailImapConnect with the right args and transitions to Connected', async () => {
    render(<MailImapConnect />);
    await waitFor(() => expect(mockMailImapIsConnected).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/host/i), { target: { value: 'imap.gmail.com' } });
    fireEvent.change(screen.getByLabelText(/port/i), { target: { value: '993' } });
    fireEvent.change(screen.getByLabelText(/email \/ username/i), { target: { value: 'user@gmail.com' } });
    fireEvent.change(screen.getByLabelText(/app password/i), { target: { value: 'secret123' } });

    fireEvent.click(screen.getByRole('button', { name: /^connect$/i }));

    await waitFor(() =>
      expect(mockMailImapConnect).toHaveBeenCalledWith({
        host: 'imap.gmail.com',
        port: 993,
        username: 'user@gmail.com',
        password: 'secret123',
      })
    );
    expect(await screen.findByText(/connected\./i)).toBeInTheDocument();
    // Connect = IMPORT: a sync starts immediately, scoped to the IMAP provider.
    await waitFor(() => expect(mockMailSyncAll).toHaveBeenCalledWith([], 'imap'));
  });

  it('shows error when mailImapConnect rejects (no unhandled rejection)', async () => {
    mockMailImapConnect.mockRejectedValue(new Error('auth failed'));

    render(<MailImapConnect />);
    await waitFor(() => expect(mockMailImapIsConnected).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/host/i), { target: { value: 'imap.fastmail.com' } });
    fireEvent.change(screen.getByLabelText(/email \/ username/i), { target: { value: 'user@fastmail.com' } });
    fireEvent.change(screen.getByLabelText(/app password/i), { target: { value: 'wrong' } });

    fireEvent.click(screen.getByRole('button', { name: /^connect$/i }));

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByText(/auth failed/i)).toBeInTheDocument();
    // Form should still be visible (not transitioned to connected)
    expect(screen.queryByText(/connected\./i)).not.toBeInTheDocument();
  });

  it('shows Connected immediately when mailImapIsConnected resolves true on mount', async () => {
    mockMailImapIsConnected.mockResolvedValue(true);

    render(<MailImapConnect />);

    expect(await screen.findByText(/connected\./i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^connect$/i })).not.toBeInTheDocument();
  });

  it('calls mailImapDisconnect and returns to connect form when Disconnect is clicked', async () => {
    mockMailImapIsConnected.mockResolvedValue(true);

    render(<MailImapConnect />);
    expect(await screen.findByText(/connected\./i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /disconnect/i }));

    await waitFor(() => expect(mockMailImapDisconnect).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: /^connect$/i })).toBeInTheDocument();
  });
});
