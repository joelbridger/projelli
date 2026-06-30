/**
 * Task 2.1 — Explicit informed confidentiality choice in first-run onboarding.
 *
 * Tests that the personal-install confidentiality choice screen:
 *   1. Choosing Local-only records mode 'local-only' + choiceMade=true and advances.
 *   2. Choosing Cloud records mode 'direct' + choiceMade=true and advances.
 *   3. "Decide later" advances WITHOUT recording (choiceMade stays false).
 *
 * Also pins the trust sentence in the Trust step.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Heavy leaf components that we do not want to render in jsdom.
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
  MailConnect: () => <div data-testid="mail-connect-stub" />,
}));
vi.mock('@/platform/connectors/email/MailGmailConnect', () => ({
  MailGmailConnect: () => <div data-testid="mail-gmail-connect-stub" />,
}));
vi.mock('@/platform/connectors/email/MailImapConnect', () => ({
  MailImapConnect: () => <div data-testid="mail-imap-connect-stub" />,
}));
vi.mock('@/features/firm/FirmAdminConsole', () => ({
  FirmAdminConsole: () => <div data-testid="firm-admin-console-stub" />,
}));
vi.mock('@/features/firm/FirmSignIn', () => ({
  FirmSignIn: () => <div data-testid="firm-sign-in-stub" />,
}));
vi.mock('@/platform/privacy/ui/DataMapDialog', () => ({
  DataMapContent: () => <div data-testid="data-map-content-stub" />,
  DataMapDialog: ({ open }: { open: boolean; onOpenChange: (v: boolean) => void }) =>
    open ? <div data-testid="data-map-dialog-stub" /> : null,
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

// Personal install (not a firm seat) — the choice screen shows.
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

// Spy on the settings store's setSetting to verify what gets recorded.
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { CONFIDENTIALITY_MODE_SETTING_KEY } from '@/platform/privacy/egress';
import { CONFIDENTIALITY_CHOICE_MADE_KEY } from '@/platform/privacy/resolvePersonalEgressDefault';

// ---------------------------------------------------------------------------
// Import the component under test AFTER mocks
// ---------------------------------------------------------------------------
import { GuidedOnboarding } from '@/features/onboarding/GuidedOnboarding';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultProps = {
  onSaveKey: vi.fn(),
  onComplete: vi.fn(),
};

/** Navigate from the Welcome step through to the AI-key / choice step. */
function navigateToChoiceStep() {
  fireEvent.click(screen.getByTestId('onboarding-next-welcome'));
  fireEvent.click(screen.getByTestId('onboarding-next-profession'));
  fireEvent.click(screen.getByTestId('onboarding-identity-next'));
  fireEvent.click(screen.getByTestId('onboarding-workspace-next'));
  fireEvent.click(screen.getByTestId('onboarding-data-continue'));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  useSettingsStore.getState().resetAll();
  // Default: personal install
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
  });
});

// ---------------------------------------------------------------------------
// Confidentiality choice screen — renders
// ---------------------------------------------------------------------------

describe('ConfidentialityChoiceStep — renders the informed choice screen', () => {
  it('shows the choice screen heading and both option cards for personal installs', () => {
    render(<GuidedOnboarding {...defaultProps} />);
    navigateToChoiceStep();

    expect(screen.getByTestId('onboarding-confidentiality-choice')).toBeInTheDocument();
    expect(screen.getByText(/How should Advisor Prep Hero handle your AI?/i)).toBeInTheDocument();
    expect(screen.getByTestId('confidentiality-choice-local')).toBeInTheDocument();
    expect(screen.getByTestId('confidentiality-choice-cloud')).toBeInTheDocument();
    expect(screen.getByTestId('confidentiality-choice-later')).toBeInTheDocument();
  });

  it('option A card reads "Local-only" and includes the verbatim copy', () => {
    render(<GuidedOnboarding {...defaultProps} />);
    navigateToChoiceStep();

    const card = screen.getByTestId('confidentiality-choice-local');
    expect(card.textContent).toMatch(/Local-only/i);
    expect(card.textContent).toMatch(/No AI prompt or file is ever sent to a cloud AI/i);
  });

  it('option B card reads "Cloud" with the bring your own key description', () => {
    render(<GuidedOnboarding {...defaultProps} />);
    navigateToChoiceStep();

    const card = screen.getByTestId('confidentiality-choice-cloud');
    expect(card.textContent).toMatch(/Cloud \(bring your own key\)/i);
    expect(card.textContent).toMatch(/OpenAI, Anthropic, or Google/i);
  });

  it('tertiary action reads "Decide later"', () => {
    render(<GuidedOnboarding {...defaultProps} />);
    navigateToChoiceStep();

    expect(screen.getByTestId('confidentiality-choice-later').textContent)
      .toMatch(/Decide later/i);
  });
});

// ---------------------------------------------------------------------------
// 1. Local-only records mode + choiceMade=true and advances
// ---------------------------------------------------------------------------

describe('ConfidentialityChoiceStep — Local-only choice', () => {
  it('records mode=local-only and choiceMade=true, then advances the onboarding', () => {
    render(<GuidedOnboarding {...defaultProps} />);
    navigateToChoiceStep();

    fireEvent.click(screen.getByTestId('confidentiality-choice-local'));

    // Recorded in settings store
    const store = useSettingsStore.getState();
    expect(store.getSetting(CONFIDENTIALITY_MODE_SETTING_KEY)).toBe('local-only');
    expect(store.getSetting(CONFIDENTIALITY_CHOICE_MADE_KEY)).toBe(true);

    // Advanced past the AI step — email step is next
    expect(screen.getByTestId('onboarding-step-email')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 2. Cloud records mode + choiceMade=true and opens the cloud setup sub-flow
// ---------------------------------------------------------------------------

describe('ConfidentialityChoiceStep — Cloud choice', () => {
  it('records mode=direct and choiceMade=true, then shows the AiSetupStep stub', () => {
    render(<GuidedOnboarding {...defaultProps} />);
    navigateToChoiceStep();

    fireEvent.click(screen.getByTestId('confidentiality-choice-cloud'));

    // Recorded in settings store
    const store = useSettingsStore.getState();
    expect(store.getSetting(CONFIDENTIALITY_MODE_SETTING_KEY)).toBe('direct');
    expect(store.getSetting(CONFIDENTIALITY_CHOICE_MADE_KEY)).toBe(true);

    // Now shows the existing AiSetupStep sub-flow
    expect(screen.getByTestId('ai-setup-step-stub')).toBeInTheDocument();
  });

  it('advancing from AiSetupStep cloud flow continues past the AI step', () => {
    render(<GuidedOnboarding {...defaultProps} />);
    navigateToChoiceStep();

    fireEvent.click(screen.getByTestId('confidentiality-choice-cloud'));
    fireEvent.click(screen.getByTestId('stub-skip-ai'));

    // Email step is next after the AI step
    expect(screen.getByTestId('onboarding-step-email')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 3. Decide later does NOT record anything; choiceMade stays false
// ---------------------------------------------------------------------------

describe('ConfidentialityChoiceStep — Decide later', () => {
  it('advances WITHOUT recording a confidentiality choice (choiceMade stays false)', () => {
    render(<GuidedOnboarding {...defaultProps} />);
    navigateToChoiceStep();

    fireEvent.click(screen.getByTestId('confidentiality-choice-later'));

    // The key invariant: choiceMade must NOT be written. This is what the gate
    // checks in resolveEffectiveEgress — absence of this flag keeps cloud
    // generation blocked on personal installs.
    const store = useSettingsStore.getState();
    const choiceValue = store.getSetting(CONFIDENTIALITY_CHOICE_MADE_KEY);
    expect(choiceValue).toBeFalsy();

    // The mode key in the values map must not have been explicitly written
    // (the schema default of 'direct' is allowed to exist, but it was not an
    // informed user choice — the gate distinguishes these via choiceMade).
    const rawValues = (store as unknown as { values: Record<string, unknown> }).values;
    expect(rawValues[CONFIDENTIALITY_MODE_SETTING_KEY]).toBeUndefined();
    expect(rawValues[CONFIDENTIALITY_CHOICE_MADE_KEY]).toBeUndefined();

    // Advanced past the AI step (to email)
    expect(screen.getByTestId('onboarding-step-email')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 4. Firm installs skip the choice screen entirely
// ---------------------------------------------------------------------------

describe('ConfidentialityChoiceStep — firm installs bypass the choice screen', () => {
  it('firm admin sees the existing AiSetupStep stub, not the choice screen', () => {
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
    });

    render(<GuidedOnboarding {...defaultProps} />);
    navigateToChoiceStep();

    // Firm install: no choice screen, straight to AiSetupStep
    expect(screen.queryByTestId('onboarding-confidentiality-choice')).not.toBeInTheDocument();
    expect(screen.getByTestId('ai-setup-step-stub')).toBeInTheDocument();
  });

  it('firm member also bypasses the choice screen', () => {
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
    });

    render(<GuidedOnboarding {...defaultProps} />);
    navigateToChoiceStep();

    expect(screen.queryByTestId('onboarding-confidentiality-choice')).not.toBeInTheDocument();
    expect(screen.getByTestId('ai-setup-step-stub')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 5. Trust sentence is present in the Trust step
// ---------------------------------------------------------------------------

describe('TrustStep — trust sentence', () => {
  it('renders the verbatim trust sentence near the data map link', () => {
    render(<GuidedOnboarding {...defaultProps} />);
    fireEvent.click(screen.getByTestId('onboarding-next-welcome'));
    fireEvent.click(screen.getByTestId('onboarding-next-profession'));
    fireEvent.click(screen.getByTestId('onboarding-identity-next'));
    fireEvent.click(screen.getByTestId('onboarding-workspace-next'));

    expect(screen.getByTestId('onboarding-trust-sentence')).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-trust-sentence').textContent)
      .toMatch(/Advisor Prep Hero runs on your computer/i);
    expect(screen.getByTestId('onboarding-trust-sentence').textContent)
      .toMatch(/In Local-only mode/i);
    expect(screen.getByTestId('onboarding-trust-sentence').textContent)
      .toMatch(/nothing about your clients leaves this device/i);
  });

  it('trust sentence contains no em dashes', () => {
    render(<GuidedOnboarding {...defaultProps} />);
    fireEvent.click(screen.getByTestId('onboarding-next-welcome'));
    fireEvent.click(screen.getByTestId('onboarding-next-profession'));
    fireEvent.click(screen.getByTestId('onboarding-identity-next'));
    fireEvent.click(screen.getByTestId('onboarding-workspace-next'));

    const sentence = screen.getByTestId('onboarding-trust-sentence');
    expect(sentence.textContent).not.toContain('—');
  });

  it('choice screen heading + body contains no em dashes', () => {
    render(<GuidedOnboarding {...defaultProps} />);
    navigateToChoiceStep();

    const choiceScreen = screen.getByTestId('onboarding-confidentiality-choice');
    expect(choiceScreen.textContent).not.toContain('—');
  });
});
