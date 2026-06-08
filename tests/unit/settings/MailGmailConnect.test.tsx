import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockGmailConnect = vi.fn();
const mockGmailIsConnected = vi.fn();
const mockGmailDisconnect = vi.fn();

vi.mock('@/utils/mail-commands', () => ({
  get gmailConnect() { return mockGmailConnect; },
  get gmailIsConnected() { return mockGmailIsConnected; },
  get gmailDisconnect() { return mockGmailDisconnect; },
}));

import { MailGmailConnect } from '@/components/settings/MailGmailConnect';

describe('MailGmailConnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGmailIsConnected.mockResolvedValue(false);
    mockGmailConnect.mockResolvedValue(undefined);
    mockGmailDisconnect.mockResolvedValue(undefined);
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
