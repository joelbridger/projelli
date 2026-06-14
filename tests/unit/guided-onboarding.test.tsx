/**
 * GuidedOnboarding — unit tests.
 *
 * Each step is rendered in isolation via mocked dependencies so the tests
 * run entirely in jsdom without a Tauri runtime.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock heavy leaf components so the orchestrator tree renders without real
// Tauri / network dependencies.
// ---------------------------------------------------------------------------

vi.mock('@/components/onboarding/AiSetupStep', () => ({
  AiSetupStep: ({
    onSaveKey,
    onUseLocal,
    onSkip,
    onBack,
  }: {
    onSaveKey: (p: string, k: string) => void;
    onUseLocal: () => void;
    onSkip: () => void;
    onBack: () => void;
  }) => (
    <div data-testid="ai-setup-step-stub">
      <button data-testid="stub-save-key" onClick={() => onSaveKey('anthropic', 'sk-test')}>Save key</button>
      <button data-testid="stub-use-local" onClick={onUseLocal}>Use local</button>
      <button data-testid="stub-skip-ai" onClick={onSkip}>Skip AI</button>
      <button data-testid="stub-ai-back" onClick={onBack}>Back</button>
    </div>
  ),
}));

vi.mock('@/components/settings/MailConnect', () => ({
  MailConnect: () => <div data-testid="mail-connect-stub">MailConnect</div>,
}));

vi.mock('@/components/settings/MailGmailConnect', () => ({
  MailGmailConnect: () => <div data-testid="mail-gmail-connect-stub">MailGmailConnect</div>,
}));

vi.mock('@/components/settings/MailImapConnect', () => ({
  MailImapConnect: () => <div data-testid="mail-imap-connect-stub">MailImapConnect</div>,
}));

vi.mock('@/components/firm/FirmAdminConsole', () => ({
  FirmAdminConsole: () => <div data-testid="firm-admin-console-stub">FirmAdminConsole</div>,
}));

vi.mock('@/components/firm/FirmSignIn', () => ({
  FirmSignIn: () => <div data-testid="firm-sign-in-stub">FirmSignIn</div>,
}));

vi.mock('@/components/privacy/DataMapDialog', () => ({
  DataMapContent: ({ variant }: { variant: string }) => (
    <div data-testid="data-map-content-stub" data-variant={variant}>DataMapContent</div>
  ),
}));

// useFirm default: not signed in
const mockUseFirm = vi.fn(() => ({
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
  signIn: vi.fn(),
  signInSso: vi.fn(),
  claimOrg: vi.fn(),
  activateSeat: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@/hooks/useFirm', () => ({
  useFirm: () => mockUseFirm(),
}));

vi.mock('@/onboarding/samples', () => ({
  writeSampleFiles: vi.fn().mockResolvedValue(undefined),
  getSamplesForProfession: () => ['sample1.md', 'sample2.md'],
}));

vi.mock('@/onboarding/professionModel', () => ({
  persistProfessionModelDefault: vi.fn(),
  getModelForProfession: () => ({ provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' }),
}));

vi.mock('@/onboarding/aiSetupState', () => ({
  markAiSetupDeferred: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import the component under test AFTER mocks are set up.
// ---------------------------------------------------------------------------
import { GuidedOnboarding } from '@/components/onboarding/GuidedOnboarding';
import * as onboardingState from '@/components/onboarding/onboardingState';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const defaultProps = {
  onSaveKey: vi.fn(),
  onComplete: vi.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GuidedOnboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  // 1. Welcome step renders; Next advances to Profession
  it('renders the Welcome step and Next advances to Profession', () => {
    render(<GuidedOnboarding {...defaultProps} />);

    expect(screen.getByTestId('onboarding-step-welcome')).toBeInTheDocument();
    expect(screen.getByText(/your private intelligence layer/i)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('onboarding-next-welcome'));
    expect(screen.getByTestId('onboarding-step-profession')).toBeInTheDocument();
  });

  // 2. Profession step: Next is always available (skip-for-now); selection highlights card
  it('profession step shows "Skip for now" before selection and enables Continue after', () => {
    render(<GuidedOnboarding {...defaultProps} />);
    fireEvent.click(screen.getByTestId('onboarding-next-welcome'));

    // Before selection the CTA reads "Skip for now"
    const nextBtn = screen.getByTestId('onboarding-next-profession');
    expect(nextBtn).toHaveTextContent(/skip for now/i);

    // Select a profession
    fireEvent.click(screen.getByTestId('profession-card-legal'));

    // Now reads "Continue"
    expect(nextBtn).toHaveTextContent(/continue/i);
  });

  // 3. Profession selection — advance through each real step embedding check
  it('AI key step embeds the AiSetupStep stub', async () => {
    render(<GuidedOnboarding {...defaultProps} />);
    // 0 -> 1 (welcome -> profession)
    fireEvent.click(screen.getByTestId('onboarding-next-welcome'));
    // 1 -> 2 (profession -> workspace)
    fireEvent.click(screen.getByTestId('onboarding-next-profession'));
    // 2 -> 3 (workspace -> trust)
    fireEvent.click(screen.getByTestId('onboarding-workspace-next'));
    // 3 -> 4 (trust -> AI key)
    fireEvent.click(screen.getByTestId('onboarding-data-continue'));

    expect(screen.getByTestId('ai-setup-step-stub')).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-step-ai-key')).toBeInTheDocument();
  });

  it('DataMapContent is embedded in the Trust step', async () => {
    render(<GuidedOnboarding {...defaultProps} />);
    fireEvent.click(screen.getByTestId('onboarding-next-welcome'));
    fireEvent.click(screen.getByTestId('onboarding-next-profession'));
    fireEvent.click(screen.getByTestId('onboarding-workspace-next'));

    expect(screen.getByTestId('onboarding-step-trust')).toBeInTheDocument();
    expect(screen.getByTestId('data-map-content-stub')).toBeInTheDocument();
  });

  it('MailConnect is embedded in the Email step (M365 tab default)', async () => {
    render(<GuidedOnboarding {...defaultProps} />);
    fireEvent.click(screen.getByTestId('onboarding-next-welcome'));
    fireEvent.click(screen.getByTestId('onboarding-next-profession'));
    fireEvent.click(screen.getByTestId('onboarding-workspace-next'));
    fireEvent.click(screen.getByTestId('onboarding-data-continue'));
    fireEvent.click(screen.getByTestId('stub-skip-ai'));

    expect(screen.getByTestId('onboarding-step-email')).toBeInTheDocument();
    expect(screen.getByTestId('mail-connect-stub')).toBeInTheDocument();
  });

  // 4. AI key step: onSaveKey + advance
  it('saving an AI key advances past the AI key step', async () => {
    const onSaveKey = vi.fn().mockResolvedValue(undefined);
    render(<GuidedOnboarding {...defaultProps} onSaveKey={onSaveKey} />);
    fireEvent.click(screen.getByTestId('onboarding-next-welcome'));
    fireEvent.click(screen.getByTestId('onboarding-next-profession'));
    fireEvent.click(screen.getByTestId('onboarding-workspace-next'));
    fireEvent.click(screen.getByTestId('onboarding-data-continue'));

    expect(screen.getByTestId('ai-setup-step-stub')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId('stub-save-key'));
    });

    expect(onSaveKey).toHaveBeenCalledWith('anthropic', 'sk-test');
    // After async save resolves, should show email step
    expect(screen.getByTestId('onboarding-step-email')).toBeInTheDocument();
  });

  // AI skip also advances
  it('skipping the AI key step advances to email step', () => {
    render(<GuidedOnboarding {...defaultProps} />);
    fireEvent.click(screen.getByTestId('onboarding-next-welcome'));
    fireEvent.click(screen.getByTestId('onboarding-next-profession'));
    fireEvent.click(screen.getByTestId('onboarding-workspace-next'));
    fireEvent.click(screen.getByTestId('onboarding-data-continue'));
    fireEvent.click(screen.getByTestId('stub-skip-ai'));
    expect(screen.getByTestId('onboarding-step-email')).toBeInTheDocument();
  });

  // 5. Email step: "Connect later" advances
  it('"Connect later" advances from email step to firm step', () => {
    render(<GuidedOnboarding {...defaultProps} />);
    fireEvent.click(screen.getByTestId('onboarding-next-welcome'));
    fireEvent.click(screen.getByTestId('onboarding-next-profession'));
    fireEvent.click(screen.getByTestId('onboarding-workspace-next'));
    fireEvent.click(screen.getByTestId('onboarding-data-continue'));
    fireEvent.click(screen.getByTestId('stub-skip-ai'));
    fireEvent.click(screen.getByTestId('email-connect-later'));
    expect(screen.getByTestId('onboarding-step-firm')).toBeInTheDocument();
  });

  // 6. Firm step — admin
  it('firm step shows FirmAdminConsole for signed-in admin', () => {
    mockUseFirm.mockReturnValue({
      isSignedIn: true,
      role: 'admin',
      hasActiveSeat: true,
      email: 'admin@firm.com',
      org: null,
      seatId: null,
      entitlement: { state: 'subscription-active', reason: 'firm-seat' },
      isOffline: false,
      isLoading: false,
      error: null,
      assuredProviders: [],
      signIn: vi.fn(),
      signInSso: vi.fn(),
      claimOrg: vi.fn(),
      activateSeat: vi.fn(),
      signOut: vi.fn(),
    } as ReturnType<typeof mockUseFirm>);

    render(<GuidedOnboarding {...defaultProps} />);
    fireEvent.click(screen.getByTestId('onboarding-next-welcome'));
    fireEvent.click(screen.getByTestId('onboarding-next-profession'));
    fireEvent.click(screen.getByTestId('onboarding-workspace-next'));
    fireEvent.click(screen.getByTestId('onboarding-data-continue'));
    fireEvent.click(screen.getByTestId('stub-skip-ai'));
    fireEvent.click(screen.getByTestId('email-connect-later'));

    expect(screen.getByTestId('firm-admin-content')).toBeInTheDocument();
    expect(screen.getByTestId('firm-admin-console-stub')).toBeInTheDocument();
  });

  // 7. Firm step — member
  it('firm step shows member note for signed-in non-admin', () => {
    mockUseFirm.mockReturnValue({
      isSignedIn: true,
      role: 'member',
      hasActiveSeat: true,
      email: 'member@firm.com',
      org: null,
      seatId: null,
      entitlement: { state: 'subscription-active', reason: 'firm-seat' },
      isOffline: false,
      isLoading: false,
      error: null,
      assuredProviders: [],
      signIn: vi.fn(),
      signInSso: vi.fn(),
      claimOrg: vi.fn(),
      activateSeat: vi.fn(),
      signOut: vi.fn(),
    } as ReturnType<typeof mockUseFirm>);

    render(<GuidedOnboarding {...defaultProps} />);
    fireEvent.click(screen.getByTestId('onboarding-next-welcome'));
    fireEvent.click(screen.getByTestId('onboarding-next-profession'));
    fireEvent.click(screen.getByTestId('onboarding-workspace-next'));
    fireEvent.click(screen.getByTestId('onboarding-data-continue'));
    fireEvent.click(screen.getByTestId('stub-skip-ai'));
    fireEvent.click(screen.getByTestId('email-connect-later'));

    expect(screen.getByTestId('firm-member-note')).toBeInTheDocument();
    expect(screen.getByText(/your firm admin manages members/i)).toBeInTheDocument();
  });

  // 8. Firm step — solo (not signed in)
  it('firm step shows FirmSignIn + solo skip when not signed in', () => {
    mockUseFirm.mockReturnValue({
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
      signIn: vi.fn(),
      signInSso: vi.fn(),
      claimOrg: vi.fn(),
      activateSeat: vi.fn(),
      signOut: vi.fn(),
    } as ReturnType<typeof mockUseFirm>);

    render(<GuidedOnboarding {...defaultProps} />);
    fireEvent.click(screen.getByTestId('onboarding-next-welcome'));
    fireEvent.click(screen.getByTestId('onboarding-next-profession'));
    fireEvent.click(screen.getByTestId('onboarding-workspace-next'));
    fireEvent.click(screen.getByTestId('onboarding-data-continue'));
    fireEvent.click(screen.getByTestId('stub-skip-ai'));
    fireEvent.click(screen.getByTestId('email-connect-later'));

    expect(screen.getByTestId('firm-signin-content')).toBeInTheDocument();
    expect(screen.getByTestId('firm-sign-in-stub')).toBeInTheDocument();
    expect(screen.getByTestId('firm-solo-skip')).toBeInTheDocument();
  });

  // 9. Skip (top-right) marks complete and calls onComplete
  it('global skip button marks onboarding complete and calls onComplete', () => {
    const markSpy = vi.spyOn(onboardingState, 'markOnboardingComplete');
    const onComplete = vi.fn();

    render(<GuidedOnboarding {...defaultProps} onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('onboarding-skip-btn'));

    expect(markSpy).toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ writeSamples: false }));
  });

  // 10. Done step: confirm sets keepance_onboarding_complete in localStorage
  it('Done step confirm sets keepance_onboarding_complete in localStorage', async () => {
    const onComplete = vi.fn();
    render(<GuidedOnboarding {...defaultProps} onComplete={onComplete} />);

    // Navigate to Done step (index 7): welcome -> profession -> workspace ->
    // trust -> ai-skip -> email-skip -> firm-skip -> done
    fireEvent.click(screen.getByTestId('onboarding-next-welcome'));
    fireEvent.click(screen.getByTestId('onboarding-next-profession'));
    fireEvent.click(screen.getByTestId('onboarding-workspace-next'));
    fireEvent.click(screen.getByTestId('onboarding-data-continue'));
    fireEvent.click(screen.getByTestId('stub-skip-ai'));
    fireEvent.click(screen.getByTestId('email-connect-later'));
    fireEvent.click(screen.getByTestId('onboarding-firm-continue'));

    expect(screen.getByTestId('onboarding-step-done')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('onboarding-done-confirm'));

    // Allow async writeSampleFiles mock to settle
    await vi.runAllTimersAsync().catch(() => {});

    expect(localStorage.getItem('keepance_onboarding_complete')).toBe('true');
    expect(onComplete).toHaveBeenCalled();
  });
});
