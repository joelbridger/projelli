import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('@/utils/mail-commands', () => ({
  mailIsConnected: vi.fn().mockResolvedValue(false),
  mailBeginLogin: vi.fn().mockResolvedValue({ userCode: 'WXYZ', verificationUri: 'https://microsoft.com/devicelogin', deviceCode: 'DC', intervalSecs: 1 }),
  mailPollLogin: vi.fn().mockResolvedValue(true),
  mailSyncAll: vi.fn().mockResolvedValue(undefined),
  MAIL_SYNC_EVENT: 'mail-sync-progress',
}));
vi.mock('@/hooks/useMailSync', () => ({ useMailSync: () => {} }));
import { MailConnect } from '@/components/settings/MailConnect';

describe('MailConnect', () => {
  beforeEach(() => vi.clearAllMocks());
  it('shows the device code after clicking Connect', async () => {
    render(<MailConnect />);
    fireEvent.click(await screen.findByRole('button', { name: /connect microsoft 365/i }));
    expect(await screen.findByText(/WXYZ/)).toBeInTheDocument();
    expect(screen.getByText(/microsoft\.com\/devicelogin/i)).toBeInTheDocument();
  });
});
