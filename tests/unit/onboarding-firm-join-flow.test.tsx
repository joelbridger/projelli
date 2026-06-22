/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: () => false,
}));

vi.mock('@/features/onboarding/AiSetupStep', () => ({
  AiSetupStep: ({ onSkip }: { onSkip: () => void }) => (
    <div data-testid="ai-setup-step-stub">
      <button data-testid="stub-skip-ai" onClick={onSkip}>Skip AI</button>
    </div>
  ),
}));

vi.mock('@/features/settings/MailConnect', () => ({
  MailConnect: () => <div data-testid="mail-connect-stub">MailConnect</div>,
}));

vi.mock('@/features/settings/MailGmailConnect', () => ({
  MailGmailConnect: () => <div data-testid="mail-gmail-connect-stub">MailGmailConnect</div>,
}));

vi.mock('@/features/settings/MailImapConnect', () => ({
  MailImapConnect: () => <div data-testid="mail-imap-connect-stub">MailImapConnect</div>,
}));

vi.mock('@/features/firm/FirmAdminConsole', () => ({
  FirmAdminConsole: () => <div data-testid="firm-admin-console-stub">FirmAdminConsole</div>,
}));

vi.mock('@/platform/privacy/ui/DataMapDialog', () => ({
  DataMapContent: ({ variant }: { variant: string }) => (
    <div data-testid="data-map-content-stub" data-variant={variant}>DataMapContent</div>
  ),
  DataMapDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="data-map-dialog-stub">DataMapDialog</div> : null,
}));

const mockSignIn = vi.fn();

const mockFirmState = {
  isSignedIn: false,
  role: null,
  hasActiveSeat: false,
  email: null,
  org: null,
  seatId: null,
  entitlement: { state: 'no-license', reason: 'no-license' },
  isOffline: false,
  isLoading: false,
  error: null,
  assuredProviders: [],
  signIn: mockSignIn,
  signInSso: vi.fn(),
  claimOrg: vi.fn(),
  activateSeat: vi.fn(),
  signOut: vi.fn(),
};

vi.mock('@/platform/hooks/useFirm', () => ({
  useFirm: () => mockFirmState,
}));

vi.mock('@/platform/matter/samples', () => ({
  writeSampleFiles: vi.fn().mockResolvedValue(undefined),
  getSamplesForProfession: () => ['sample1.md', 'sample2.md'],
}));

vi.mock('@/platform/profile/professionModel', () => ({
  persistProfessionModelDefault: vi.fn(),
  getModelForProfession: () => ({ provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' }),
}));

vi.mock('@/features/onboarding/aiSetupState', () => ({
  markAiSetupDeferred: vi.fn(),
}));

import { GuidedOnboarding } from '@/features/onboarding/GuidedOnboarding';

function navigateToFirmStep() {
  fireEvent.click(screen.getByTestId('onboarding-next-welcome'));
  fireEvent.click(screen.getByTestId('onboarding-next-profession'));
  fireEvent.click(screen.getByTestId('onboarding-identity-next'));
  fireEvent.click(screen.getByTestId('onboarding-workspace-next'));
  fireEvent.click(screen.getByTestId('onboarding-data-continue'));
  // Personal install: the confidentiality choice screen shows first. "Decide later"
  // skips past the AI step without recording a choice.
  fireEvent.click(screen.getByTestId('confidentiality-choice-later'));
  fireEvent.click(screen.getByTestId('email-connect-later'));
}

describe('GuidedOnboarding firm join flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignIn.mockResolvedValue({ ok: true });
    localStorage.clear();
  });

  it('lets a user join their firm by signing in from the onboarding firm step', async () => {
    render(<GuidedOnboarding onSaveKey={vi.fn()} onComplete={vi.fn()} />);
    navigateToFirmStep();

    const joinCard = screen.getByTestId('firm-option-join');
    fireEvent.click(joinCard.querySelector('button')!);

    fireEvent.change(screen.getByTestId('firm-email'), {
      target: { value: 'jane@weston-llp.com' },
    });
    fireEvent.change(screen.getByTestId('firm-password'), {
      target: { value: 'correct-horse-password' },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('firm-signin-submit'));
    });

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith('jane@weston-llp.com', 'correct-horse-password');
    });
    expect(screen.getByTestId('firm-password')).toHaveValue('');
  });
});
