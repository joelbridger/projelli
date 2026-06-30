import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ── Mock the firm session (controllable) ─────────────────────────────────────
let firm = {
  isSignedIn: false,
  hasActiveSeat: false,
  org: null as { name: string } | null,
};
vi.mock('@/platform/hooks/useFirm', () => ({
  useFirm: () => firm,
}));

// ── Mock UseWithFirmFlow so we can assert it mounts when the action is used ───
vi.mock('@/features/firm/UseWithFirmFlow', () => ({
  UseWithFirmFlow: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="use-with-firm-flow-mock">
      <button data-testid="bridge-close" onClick={() => onClose()} />
    </div>
  ),
}));

// ── Heavy child components AccountWindow pulls in: keep tests light ───────────
vi.mock('@/features/firm/FirmSignIn', () => ({ FirmSignIn: () => <div data-testid="firm-signin" /> }));
vi.mock('@/features/firm/FirmAdminConsole', () => ({ FirmAdminConsole: () => <div data-testid="firm-admin" /> }));
vi.mock('@/features/settings/LicenseSettings', () => ({ LicenseSettings: () => <div /> }));
vi.mock('@/platform/analysis/ui/CostMetrics', () => ({ CostMetrics: () => <div /> }));
vi.mock('@/platform/connectors/email/MailConnect', () => ({ MailConnect: () => <div /> }));
vi.mock('@/platform/connectors/email/MailImapConnect', () => ({ MailImapConnect: () => <div /> }));
vi.mock('@/platform/connectors/email/MailGmailConnect', () => ({ MailGmailConnect: () => <div /> }));
vi.mock('@/features/settings/McpSettingsSection', () => ({ McpSettingsSection: () => <div /> }));
vi.mock('@/features/settings/OllamaSettingsSection', () => ({ OllamaSettingsSection: () => <div /> }));
vi.mock('@/platform/profile/profileStore', () => ({
  useProfileStore: () => ({
    soloName: '', firmName: '', soloAvatar: null, firmLogo: null,
    setSoloName: () => {}, setFirmName: () => {}, setSoloAvatar: () => {}, setFirmLogo: () => {},
  }),
}));

import { AccountWindow } from '@/features/account/AccountWindow';
import { UseWithFirmPrompt } from '@/features/firm/UseWithFirmPrompt';

beforeEach(() => {
  vi.clearAllMocks();
  firm = { isSignedIn: false, hasActiveSeat: false, org: null };
});

describe('Account window "Use this with my firm" entry', () => {
  it('shows the action for a solo user and opens the flow', () => {
    render(<AccountWindow open={true} onOpenChange={() => {}} initialTab="firm" />);
    const action = screen.getByTestId('use-with-firm-action');
    expect(action).toBeInTheDocument();
    fireEvent.click(action);
    expect(screen.getByTestId('use-with-firm-flow-mock')).toBeInTheDocument();
  });

  it('hides the action for an active-seat firm user', () => {
    firm = { isSignedIn: true, hasActiveSeat: true, org: { name: 'Law Firm' } };
    render(<AccountWindow open={true} onOpenChange={() => {}} initialTab="firm" />);
    expect(screen.queryByTestId('use-with-firm-action')).not.toBeInTheDocument();
  });
});

describe('UseWithFirmPrompt', () => {
  it('renders for a solo user with an action that opens the flow', () => {
    render(<UseWithFirmPrompt />);
    expect(screen.getByTestId('use-with-firm-prompt')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('use-with-firm-prompt-action'));
    expect(screen.getByTestId('use-with-firm-flow-mock')).toBeInTheDocument();
  });

  it('does not render for an active-seat firm user', () => {
    firm = { isSignedIn: true, hasActiveSeat: true, org: { name: 'Law Firm' } };
    render(<UseWithFirmPrompt />);
    expect(screen.queryByTestId('use-with-firm-prompt')).not.toBeInTheDocument();
  });

  it('is dismissible: after dismiss it does not re-render in the same session', () => {
    render(<UseWithFirmPrompt />);
    expect(screen.getByTestId('use-with-firm-prompt')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('use-with-firm-prompt-dismiss'));
    expect(screen.queryByTestId('use-with-firm-prompt')).not.toBeInTheDocument();
  });
});
