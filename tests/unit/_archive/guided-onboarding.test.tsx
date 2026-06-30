/**
 * GuidedOnboarding — unit tests for the ARCHIVED 9-step flow.
 *
 * Retired 2026-06-30 (superseded by OnboardingV2 / tests/unit/onboarding-v2.test.tsx).
 * Moved here alongside `src/features/onboarding/_archive/GuidedOnboarding.tsx`
 * — kept passing so the archived component doesn't bitrot, but no longer part
 * of the live first-run surface.
 *
 * Each step is rendered in isolation via mocked dependencies so the tests
 * run entirely in jsdom without a Tauri runtime.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useProfessionStore } from '@/platform/profile/professionStore';

// ---------------------------------------------------------------------------
// Mock heavy leaf components so the orchestrator tree renders without real
// Tauri / network dependencies.
// ---------------------------------------------------------------------------

vi.mock('@/features/onboarding/AiSetupStep', () => ({
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

vi.mock('@/platform/connectors/email/MailConnect', () => ({
  MailConnect: () => <div data-testid="mail-connect-stub">MailConnect</div>,
}));

vi.mock('@/platform/connectors/email/MailGmailConnect', () => ({
  MailGmailConnect: () => <div data-testid="mail-gmail-connect-stub">MailGmailConnect</div>,
}));

vi.mock('@/platform/connectors/email/MailImapConnect', () => ({
  MailImapConnect: () => <div data-testid="mail-imap-connect-stub">MailImapConnect</div>,
}));

vi.mock('@/features/firm/FirmAdminConsole', () => ({
  FirmAdminConsole: () => <div data-testid="firm-admin-console-stub">FirmAdminConsole</div>,
}));

vi.mock('@/features/firm/FirmSignIn', () => ({
  FirmSignIn: () => <div data-testid="firm-sign-in-stub">FirmSignIn</div>,
}));

vi.mock('@/platform/privacy/ui/DataMapDialog', () => ({
  DataMapContent: ({ variant }: { variant: string }) => (
    <div data-testid="data-map-content-stub" data-variant={variant}>DataMapContent</div>
  ),
  DataMapDialog: ({ open }: { open: boolean; onOpenChange: (v: boolean) => void }) =>
    open ? <div data-testid="data-map-dialog-stub">DataMapDialog</div> : null,
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

vi.mock('@/platform/hooks/useFirm', () => ({
  useFirm: () => mockUseFirm(),
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

// ---------------------------------------------------------------------------
// Import the component under test AFTER mocks are set up.
// ---------------------------------------------------------------------------
import { GuidedOnboarding } from '@/features/onboarding/_archive/GuidedOnboarding';
import * as onboardingState from '@/features/onboarding/onboardingState';

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
    // Selecting a profession card now syncs the reactive profession store
    // (NEW-001), a module-level singleton that survives between tests — reset it
    // to the app default so a prior test's pick can't leak into the CTA labels.
    useProfessionStore.getState().setProfession('advisor');
  });

  afterEach(() => {
    localStorage.clear();
    useProfessionStore.getState().setProfession('advisor');
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

  // 2b. Make-it-yours step: name input + photo upload, then advances to workspace
  it('identity step collects a name and advances to the workspace step', () => {
    render(<GuidedOnboarding {...defaultProps} />);
    fireEvent.click(screen.getByTestId('onboarding-next-welcome'));
    fireEvent.click(screen.getByTestId('onboarding-next-profession'));

    // On the identity step: name field + upload control are present.
    expect(screen.getByTestId('onboarding-step-identity')).toBeInTheDocument();
    const nameInput = screen.getByTestId('onboarding-identity-name');
    expect(screen.getByTestId('onboarding-identity-upload')).toBeInTheDocument();

    // Typing a name persists to the profile store (the rail/account read it).
    fireEvent.change(nameInput, { target: { value: 'Jane Attorney' } });
    expect(nameInput).toHaveValue('Jane Attorney');

    // Continue lands on the workspace step.
    fireEvent.click(screen.getByTestId('onboarding-identity-next'));
    expect(screen.getByTestId('onboarding-step-workspace')).toBeInTheDocument();
  });

  // 3. Profession selection — advance through each real step embedding check
  it('AI key step embeds the AiSetupStep stub (after choosing Cloud on the choice screen)', async () => {
    render(<GuidedOnboarding {...defaultProps} />);
    // 0 -> 1 (welcome -> profession)
    fireEvent.click(screen.getByTestId('onboarding-next-welcome'));
    // 1 -> 2 (profession -> workspace)
    fireEvent.click(screen.getByTestId('onboarding-next-profession'));
    fireEvent.click(screen.getByTestId('onboarding-identity-next'));
    // 2 -> 3 (workspace -> trust)
    fireEvent.click(screen.getByTestId('onboarding-workspace-next'));
    // 3 -> 4 (trust -> AI key: confidentiality choice screen)
    fireEvent.click(screen.getByTestId('onboarding-data-continue'));
    // On the choice screen, pick Cloud to reach the existing AiSetupStep sub-flow.
    fireEvent.click(screen.getByTestId('confidentiality-choice-cloud'));

    expect(screen.getByTestId('ai-setup-step-stub')).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-step-ai-key')).toBeInTheDocument();
  });

  it('Trust step renders with three plain-language bullets (no inline data-map accordion)', async () => {
    render(<GuidedOnboarding {...defaultProps} />);
    fireEvent.click(screen.getByTestId('onboarding-next-welcome'));
    fireEvent.click(screen.getByTestId('onboarding-next-profession'));
    fireEvent.click(screen.getByTestId('onboarding-identity-next'));
    fireEvent.click(screen.getByTestId('onboarding-workspace-next'));

    expect(screen.getByTestId('onboarding-step-trust')).toBeInTheDocument();
    // Full data-map accordion is NOT embedded — only the three summary bullets + a link.
    expect(screen.queryByTestId('data-map-content-stub')).not.toBeInTheDocument();
    expect(screen.getByTestId('onboarding-trust-open-data-map')).toBeInTheDocument();
  });

  it('MailConnect is embedded in the Email step (M365 tab default)', async () => {
    render(<GuidedOnboarding {...defaultProps} />);
    fireEvent.click(screen.getByTestId('onboarding-next-welcome'));
    fireEvent.click(screen.getByTestId('onboarding-next-profession'));
    fireEvent.click(screen.getByTestId('onboarding-identity-next'));
    fireEvent.click(screen.getByTestId('onboarding-workspace-next'));
    fireEvent.click(screen.getByTestId('onboarding-data-continue'));
    // "Decide later" advances past the AI step without recording a choice.
    fireEvent.click(screen.getByTestId('confidentiality-choice-later'));

    expect(screen.getByTestId('onboarding-step-email')).toBeInTheDocument();
    expect(screen.getByTestId('mail-connect-stub')).toBeInTheDocument();
  });

  // 4. AI key step: onSaveKey + advance
  it('saving an AI key advances past the AI key step', async () => {
    const onSaveKey = vi.fn().mockResolvedValue(undefined);
    render(<GuidedOnboarding {...defaultProps} onSaveKey={onSaveKey} />);
    fireEvent.click(screen.getByTestId('onboarding-next-welcome'));
    fireEvent.click(screen.getByTestId('onboarding-next-profession'));
    fireEvent.click(screen.getByTestId('onboarding-identity-next'));
    fireEvent.click(screen.getByTestId('onboarding-workspace-next'));
    fireEvent.click(screen.getByTestId('onboarding-data-continue'));
    // On the choice screen, pick Cloud to reach the AiSetupStep sub-flow.
    fireEvent.click(screen.getByTestId('confidentiality-choice-cloud'));

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
    fireEvent.click(screen.getByTestId('onboarding-identity-next'));
    fireEvent.click(screen.getByTestId('onboarding-workspace-next'));
    fireEvent.click(screen.getByTestId('onboarding-data-continue'));
    // "Decide later" advances without recording a choice.
    fireEvent.click(screen.getByTestId('confidentiality-choice-later'));
    expect(screen.getByTestId('onboarding-step-email')).toBeInTheDocument();
  });

  // 5. Email step: "Connect later" advances
  it('"Connect later" advances from email step to firm step', () => {
    render(<GuidedOnboarding {...defaultProps} />);
    fireEvent.click(screen.getByTestId('onboarding-next-welcome'));
    fireEvent.click(screen.getByTestId('onboarding-next-profession'));
    fireEvent.click(screen.getByTestId('onboarding-identity-next'));
    fireEvent.click(screen.getByTestId('onboarding-workspace-next'));
    fireEvent.click(screen.getByTestId('onboarding-data-continue'));
    fireEvent.click(screen.getByTestId('confidentiality-choice-later'));
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
    fireEvent.click(screen.getByTestId('onboarding-identity-next'));
    fireEvent.click(screen.getByTestId('onboarding-workspace-next'));
    fireEvent.click(screen.getByTestId('onboarding-data-continue'));
    fireEvent.click(screen.getByTestId('stub-skip-ai'));
    fireEvent.click(screen.getByTestId('email-connect-later'));

    expect(screen.getByTestId('firm-admin-content')).toBeInTheDocument();
    expect(screen.getByTestId('firm-admin-console-stub')).toBeInTheDocument();
    // Admins can brand the firm (name + uploadable logo) right here.
    expect(screen.getByTestId('firm-branding')).toBeInTheDocument();
    expect(screen.getByTestId('firm-branding-upload')).toBeInTheDocument();
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
    fireEvent.click(screen.getByTestId('onboarding-identity-next'));
    fireEvent.click(screen.getByTestId('onboarding-workspace-next'));
    fireEvent.click(screen.getByTestId('onboarding-data-continue'));
    fireEvent.click(screen.getByTestId('stub-skip-ai'));
    fireEvent.click(screen.getByTestId('email-connect-later'));

    expect(screen.getByTestId('firm-member-note')).toBeInTheDocument();
    expect(screen.getByText(/your firm admin manages members/i)).toBeInTheDocument();
  });

  // 8. Firm step — three options (not signed in): Create, Join, and solo cards are all shown
  it('firm step shows three option cards when not signed in', () => {
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
    fireEvent.click(screen.getByTestId('onboarding-identity-next'));
    fireEvent.click(screen.getByTestId('onboarding-workspace-next'));
    fireEvent.click(screen.getByTestId('onboarding-data-continue'));
    fireEvent.click(screen.getByTestId('confidentiality-choice-later'));
    fireEvent.click(screen.getByTestId('email-connect-later'));

    expect(screen.getByTestId('firm-signin-content')).toBeInTheDocument();
    // All three option cards are present
    expect(screen.getByTestId('firm-option-create')).toBeInTheDocument();
    expect(screen.getByTestId('firm-option-join')).toBeInTheDocument();
    expect(screen.getByTestId('firm-option-solo')).toBeInTheDocument();
    // The solo card button carries the firm-solo-skip testid for backwards compat
    const soloBtn = screen.getByTestId('firm-solo-skip');
    expect(soloBtn).toBeInTheDocument();
    expect(soloBtn).toHaveTextContent(/continue solo/i);
    // Heading reflects the step copy
    expect(screen.getByText(/how do you practice\?/i)).toBeInTheDocument();
  });

  // 8b. Firm step — clicking "Join your firm" expands the FirmSignIn sub-form
  it('firm step expands FirmSignIn when "Join your firm" is clicked', () => {
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
    fireEvent.click(screen.getByTestId('onboarding-identity-next'));
    fireEvent.click(screen.getByTestId('onboarding-workspace-next'));
    fireEvent.click(screen.getByTestId('onboarding-data-continue'));
    fireEvent.click(screen.getByTestId('confidentiality-choice-later'));
    fireEvent.click(screen.getByTestId('email-connect-later'));

    // Before expanding, FirmSignIn is not shown
    expect(screen.queryByTestId('firm-sign-in-stub')).not.toBeInTheDocument();
    // Expand Join your firm
    const joinCard = screen.getByTestId('firm-option-join').querySelector('button')!;
    fireEvent.click(joinCard);
    // Now FirmSignIn appears
    expect(screen.getByTestId('firm-sign-in-stub')).toBeInTheDocument();
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
    // trust -> ai-choice(decide later) -> email-skip -> firm-skip -> done
    fireEvent.click(screen.getByTestId('onboarding-next-welcome'));
    fireEvent.click(screen.getByTestId('onboarding-next-profession'));
    fireEvent.click(screen.getByTestId('onboarding-identity-next'));
    fireEvent.click(screen.getByTestId('onboarding-workspace-next'));
    fireEvent.click(screen.getByTestId('onboarding-data-continue'));
    fireEvent.click(screen.getByTestId('confidentiality-choice-later'));
    fireEvent.click(screen.getByTestId('email-connect-later'));
    fireEvent.click(screen.getByTestId('onboarding-firm-continue'));

    expect(screen.getByTestId('onboarding-step-done')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('onboarding-done-confirm'));

    // Allow async writeSampleFiles mock to settle
    await vi.runAllTimersAsync().catch(() => {});

    expect(localStorage.getItem('keepance_onboarding_complete')).toBe('true');
    expect(onComplete).toHaveBeenCalled();
  });

  // Helper: navigate to Done step
  function navigateToDoneStep() {
    fireEvent.click(screen.getByTestId('onboarding-next-welcome'));
    fireEvent.click(screen.getByTestId('onboarding-next-profession'));
    fireEvent.click(screen.getByTestId('onboarding-identity-next'));
    fireEvent.click(screen.getByTestId('onboarding-workspace-next'));
    fireEvent.click(screen.getByTestId('onboarding-data-continue'));
    // "Decide later" skips the AI setup without recording a confidentiality choice.
    fireEvent.click(screen.getByTestId('confidentiality-choice-later'));
    fireEvent.click(screen.getByTestId('email-connect-later'));
    fireEvent.click(screen.getByTestId('onboarding-firm-continue'));
  }

  // 11. Done step: primary CTA reflects sample toggle
  it('Done step CTA reads "Explore the sample client" when samples toggle is ON (default)', () => {
    render(<GuidedOnboarding {...defaultProps} />);
    navigateToDoneStep();

    // Default is populateSamples=true; default profession is advisor, so the unit label is "client".
    expect(screen.getByTestId('onboarding-done-confirm')).toHaveTextContent(/explore the sample client/i);
  });

  it('Done step CTA reads "Create your first client" when samples toggle is OFF', () => {
    render(<GuidedOnboarding {...defaultProps} />);
    navigateToDoneStep();

    // Uncheck the samples toggle
    const toggle = screen.getByTestId('onboarding-samples-toggle');
    fireEvent.click(toggle);

    expect(screen.getByTestId('onboarding-done-confirm')).toHaveTextContent(/create your first client/i);
  });

  // 12. Done step: shows no-AI note when AI was skipped; hides it when AI was connected
  it('Done step shows the no-AI note after AI was skipped', () => {
    render(<GuidedOnboarding {...defaultProps} />);
    fireEvent.click(screen.getByTestId('onboarding-next-welcome'));
    fireEvent.click(screen.getByTestId('onboarding-next-profession'));
    fireEvent.click(screen.getByTestId('onboarding-identity-next'));
    fireEvent.click(screen.getByTestId('onboarding-workspace-next'));
    fireEvent.click(screen.getByTestId('onboarding-data-continue'));
    fireEvent.click(screen.getByTestId('confidentiality-choice-later'));
    fireEvent.click(screen.getByTestId('email-connect-later'));
    fireEvent.click(screen.getByTestId('onboarding-firm-continue'));

    expect(screen.getByTestId('onboarding-done-no-ai-note')).toBeInTheDocument();
  });

  it('Done step hides the no-AI note when AI was connected via local model (through Cloud sub-flow)', () => {
    render(<GuidedOnboarding {...defaultProps} />);
    fireEvent.click(screen.getByTestId('onboarding-next-welcome'));
    fireEvent.click(screen.getByTestId('onboarding-next-profession'));
    fireEvent.click(screen.getByTestId('onboarding-identity-next'));
    fireEvent.click(screen.getByTestId('onboarding-workspace-next'));
    fireEvent.click(screen.getByTestId('onboarding-data-continue'));
    // Pick Cloud to enter the AiSetupStep sub-flow, then use local within it.
    fireEvent.click(screen.getByTestId('confidentiality-choice-cloud'));
    fireEvent.click(screen.getByTestId('stub-use-local'));
    fireEvent.click(screen.getByTestId('email-connect-later'));
    fireEvent.click(screen.getByTestId('onboarding-firm-continue'));

    expect(screen.queryByTestId('onboarding-done-no-ai-note')).not.toBeInTheDocument();
  });

  // 13. Trust step: shows 3 bullets + link; no full accordion embedded
  it('Trust step shows plain-language bullets and no data-map accordion by default', () => {
    render(<GuidedOnboarding {...defaultProps} />);
    fireEvent.click(screen.getByTestId('onboarding-next-welcome'));
    fireEvent.click(screen.getByTestId('onboarding-next-profession'));
    fireEvent.click(screen.getByTestId('onboarding-identity-next'));
    fireEvent.click(screen.getByTestId('onboarding-workspace-next'));

    expect(screen.getByTestId('onboarding-step-trust')).toBeInTheDocument();
    expect(screen.queryByTestId('data-map-content-stub')).not.toBeInTheDocument();
    expect(screen.getByTestId('onboarding-trust-open-data-map')).toBeInTheDocument();
    expect(screen.getByText(/Read the full data map/i)).toBeInTheDocument();
    expect(screen.getByText(/your files and notes stay on your computer/i)).toBeInTheDocument();
  });

  it('Trust step opens the DataMapDialog when "Read the full data map" is clicked', () => {
    render(<GuidedOnboarding {...defaultProps} />);
    fireEvent.click(screen.getByTestId('onboarding-next-welcome'));
    fireEvent.click(screen.getByTestId('onboarding-next-profession'));
    fireEvent.click(screen.getByTestId('onboarding-identity-next'));
    fireEvent.click(screen.getByTestId('onboarding-workspace-next'));

    expect(screen.queryByTestId('data-map-dialog-stub')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('onboarding-trust-open-data-map'));
    expect(screen.getByTestId('data-map-dialog-stub')).toBeInTheDocument();
  });
});
