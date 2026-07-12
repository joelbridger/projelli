/**
 * OnboardingV2 — scene navigation + REAL-functionality wiring.
 *
 * Heavy leaf components and platform hooks are mocked so the flow renders in
 * jsdom, but the wiring under test is the real component code:
 *   - AiScene live-validates then persists the key via onSaveKey
 *   - "Try Local AI" starts the real local-model download + switches mode
 *   - ConnectScene mounts the real connector components
 *   - FirmSetupScene derives bars from useSetupProgress
 *   - "Continue to the app" completes onboarding
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { EMPTY_SETUP_PROGRESS } from '@/platform/utils/setup-progress-commands';
import type { SetupProgress } from '@/platform/utils/setup-progress-commands';
import { hasDeferredAiSetup } from '@/features/onboarding/aiSetupState';
import { markKeyVerified, isKeyVerified } from '@/platform/providers/keyVerification';
import { useOAuthPendingStore } from '@/platform/connectors/oauthPending';
import { ONB_COPY } from '@/features/onboarding/v2/copy';

const h = vi.hoisted(() => ({
  validate: vi.fn(),
  start: vi.fn(),
  recordChoice: vi.fn(),
  openExternal: vi.fn(),
  retryFailedModelDownloads: vi.fn(),
  progress: null as SetupProgress | null,
  localState: 'absent' as string,
}));

// --- Leaf components stubbed (real Tauri/network avoided) ---
vi.mock('@/features/onboarding/v2/LottiePlayer', () => ({
  LottiePlayer: () => <div data-testid="lottie-stub" />,
}));
vi.mock('@/platform/connectors/email/MailConnect', () => ({
  MailConnect: () => <div data-testid="mail-connect-stub" />,
}));
vi.mock('@/platform/connectors/email/MailGmailConnect', () => ({
  MailGmailConnect: () => <div data-testid="mail-gmail-stub" />,
}));
vi.mock('@/platform/connectors/email/MailImapConnect', () => ({
  MailImapConnect: () => <div data-testid="mail-imap-stub" />,
}));
vi.mock('@/platform/connectors/onedrive/OneDriveConnect', () => ({
  OneDriveConnect: () => <div data-testid="onedrive-stub" />,
}));
vi.mock('@/platform/connectors/crm/WealthboxConnect', () => ({
  WealthboxConnect: () => <div data-testid="wealthbox-stub" />,
}));
vi.mock('@/features/onboarding/AiSetupHelpLink', () => ({
  AiSetupHelpLink: () => <div data-testid="help-link-stub" />,
}));
vi.mock('@/features/onboarding/ApiKeyTester', () => ({
  ApiKeyTester: () => <div data-testid="tester-stub" />,
}));
vi.mock('@/platform/utils/setup-progress-commands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/utils/setup-progress-commands')>();
  return {
    ...actual,
    retryFailedModelDownloads: (...a: unknown[]) => h.retryFailedModelDownloads(...a),
  };
});

// --- Platform hooks / functions controllable from tests ---
vi.mock('@/platform/utils/openExternal', () => ({
  openExternal: (...a: unknown[]) => h.openExternal(...a),
}));
vi.mock('@/platform/providers/apiKeyValidation', () => ({
  validateApiKeyLive: (...a: unknown[]) => h.validate(...a),
}));
vi.mock('@/platform/hooks/useSetupProgress', () => ({
  useSetupProgress: () => h.progress,
}));
vi.mock('@/platform/hooks/useConfidentialityMode', () => ({
  useRecordConfidentialityChoice: () => h.recordChoice,
  snapshotConfidentialityChoice: () => ({ mode: undefined, choiceMade: undefined }),
  restoreConfidentialityChoice: () => {},
}));
vi.mock('@/platform/hooks/useLocalLlmModelStatus', () => ({
  useLocalLlmModelStatus: () => ({
    state: h.localState,
    bytesDone: 0,
    bytesTotal: null,
    message: null,
    stalled: false,
    probed: true,
    start: h.start,
    retry: h.start,
  }),
}));

import { OnboardingV2 } from '@/features/onboarding/v2/OnboardingV2';

function makeProgress(overrides: Partial<SetupProgress> = {}): SetupProgress {
  return { ...EMPTY_SETUP_PROGRESS, ...overrides };
}

function renderFlow() {
  const onSaveKey = vi.fn().mockResolvedValue(undefined);
  const onComplete = vi.fn();
  render(<OnboardingV2 onSaveKey={onSaveKey} onComplete={onComplete} />);
  return { onSaveKey, onComplete };
}

const goToCompliance = () => {
  fireEvent.click(screen.getByTestId('onboarding-v2-go'));
  fireEvent.click(screen.getByTestId('choose-start-own'));
};
const goToAi = () => {
  goToCompliance();
  fireEvent.click(screen.getByTestId('onboarding-v2-continue'));
};
const clickContinue = () => fireEvent.click(screen.getByTestId('onboarding-v2-continue'));

describe('OnboardingV2 navigation', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    h.progress = null;
    h.localState = 'absent';
    h.retryFailedModelDownloads.mockResolvedValue(undefined);
    useOAuthPendingStore.setState({ count: 0 });
  });

  it('opens on the restored intro, then advances through the setup choice to the compliance beat', () => {
    renderFlow();
    expect(screen.getByText(ONB_COPY.intro.headline)).toBeTruthy();
    fireEvent.click(screen.getByTestId('onboarding-v2-go'));
    expect(screen.getByTestId('onboarding-v2-choose-start')).toBeTruthy();
    fireEvent.click(screen.getByTestId('choose-start-own'));
    expect(screen.getByTestId('onboarding-v2-compliance')).toBeTruthy();
    expect(screen.getByText(ONB_COPY.compliance.headline)).toBeTruthy();
  });

  it('opens the compliance officer placeholder from the compliance beat', () => {
    renderFlow();
    goToCompliance();
    fireEvent.click(screen.getByTestId('onboarding-compliance-officer-cta'));
    expect(screen.getByTestId('onboarding-compliance-security-modal')).toBeTruthy();
    expect(screen.getByText(ONB_COPY.compliance.modalTitle)).toBeTruthy();
    expect(screen.getByText(ONB_COPY.compliance.modalBody)).toBeTruthy();
  });

  it('loop-proof: mounting with a workspace already open starts past the intro, never on it', () => {
    // Belt-and-suspenders for the "sample practice → back to the intro forever"
    // BLOCKER. If the overlay is ever remounted AFTER a workspace loads (any
    // cause), it must NOT show the intro again. With a workspace present the user
    // has already passed intro + ChooseStart, so we start on the compliance
    // beat.
    render(
      <OnboardingV2 onSaveKey={vi.fn()} onComplete={vi.fn()} hasWorkspace={true} />,
    );
    expect(screen.getByTestId('onboarding-v2-compliance')).toBeTruthy();
    expect(screen.queryByTestId('onboarding-v2-intro')).not.toBeInTheDocument();
    expect(screen.queryByTestId('onboarding-v2-choose-start')).not.toBeInTheDocument();
  });

  it('walks intro -> compliance -> ai -> connect -> firm and completes onboarding', () => {
    const { onComplete } = renderFlow();
    goToAi();
    clickContinue(); // ai -> connect
    expect(screen.getByText(ONB_COPY.connect.headline)).toBeTruthy();
    clickContinue(); // connect -> firm
    expect(screen.getByText(ONB_COPY.firm.headline)).toBeTruthy();
    // Last scene: button reads "Continue to the app" and completes.
    expect(screen.getByTestId('onboarding-v2-continue').textContent).toContain('Continue to the app');
    clickContinue();
    expect(localStorage.getItem('lantern_onboarding_complete')).toBe('true');
    expect(onComplete).toHaveBeenCalledWith({ writeSamples: false });
  });

  it('Back returns to the previous scene', () => {
    renderFlow();
    goToAi();
    clickContinue(); // connect
    fireEvent.click(screen.getByTestId('onboarding-v2-back'));
    expect(screen.getByText(ONB_COPY.ai.headline)).toBeTruthy();
  });

  it('marks AI setup deferred when Continue skips the AI screen unresolved', () => {
    expect(hasDeferredAiSetup()).toBe(false);
    renderFlow();
    goToAi();
    clickContinue(); // ai -> connect with no key and no local choice
    expect(hasDeferredAiSetup()).toBe(true);
  });
});

describe('AiScene real key wiring', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    h.progress = null;
    h.localState = 'absent';
  });

  it('validates then persists a pasted key via onSaveKey, and marks it verified', async () => {
    h.validate.mockResolvedValue({ outcome: 'ok', message: 'ok' });
    const { onSaveKey } = renderFlow();
    goToAi();
    fireEvent.change(screen.getByTestId('ai-key-input'), { target: { value: 'sk-ant-test123' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('ai-connect'));
    });
    // Records the cloud choice BEFORE validating (un-gates real validation +
    // unlocks cloud generation post-onboarding).
    expect(h.recordChoice).toHaveBeenCalledWith('direct');
    expect(h.validate).toHaveBeenCalledWith('anthropic', 'sk-ant-test123', expect.anything());
    expect(onSaveKey).toHaveBeenCalledWith('anthropic', 'sk-ant-test123');
    expect(await screen.findByTestId('ai-connected')).toBeTruthy();
    // A real live check passed -> the key is now genuinely verified.
    expect(isKeyVerified('anthropic')).toBe(true);
  });

  it('labels providers with the names advisors recognize', () => {
    renderFlow();
    goToAi();
    expect(screen.getByTestId('ai-provider-openai').textContent).toBe(ONB_COPY.ai.providers.openai);
    expect(screen.getByTestId('ai-provider-anthropic').textContent).toBe(ONB_COPY.ai.providers.anthropic);
    expect(screen.getByTestId('ai-provider-google').textContent).toBe(ONB_COPY.ai.providers.google);
    expect(screen.getByText(ONB_COPY.ai.modeNote)).toBeTruthy();
  });

  it('on a NETWORK failure saves the key, does NOT mark verified, and clears a stale verified marker', async () => {
    // A PRIOR key for this provider was verified; saving a new key that can't be
    // live-checked must not let the new (unverified) key inherit that status.
    markKeyVerified('anthropic');
    expect(isKeyVerified('anthropic')).toBe(true);

    h.validate.mockResolvedValue({ outcome: 'network', message: 'could not reach provider' });
    const { onSaveKey } = renderFlow();
    goToAi();
    fireEvent.change(screen.getByTestId('ai-key-input'), { target: { value: 'sk-ant-net' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('ai-connect'));
    });
    // The key is saved (it looks valid)...
    expect(onSaveKey).toHaveBeenCalledWith('anthropic', 'sk-ant-net');
    // ...but we must NOT claim "connected" — it's only "saved, not verified".
    expect(screen.queryByTestId('ai-connected')).toBeNull();
    expect(screen.getByTestId('ai-saved-unverified')).toBeTruthy();
    // The stale verified marker is cleared so the new unverified key can't
    // inherit it (Codex P2).
    expect(isKeyVerified('anthropic')).toBe(false);
  });

  it('does NOT save a rejected key and surfaces the error', async () => {
    h.validate.mockResolvedValue({ outcome: 'rejected', message: 'That key was refused.' });
    const { onSaveKey } = renderFlow();
    goToAi();
    fireEvent.change(screen.getByTestId('ai-key-input'), { target: { value: 'sk-bad' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('ai-connect'));
    });
    expect(onSaveKey).not.toHaveBeenCalled();
    expect(screen.getByTestId('ai-error').textContent).toContain('refused');
  });

  it('"Try Local AI" starts the real download, records local-only, and advances', () => {
    renderFlow();
    goToAi();
    fireEvent.click(screen.getByTestId('ai-try-local'));
    expect(h.start).toHaveBeenCalledTimes(1);
    expect(h.recordChoice).toHaveBeenCalledWith('local-only');
    // advanced to the connect scene
    expect(screen.getByText(ONB_COPY.connect.headline)).toBeTruthy();
    // a real choice was made, so AI setup is NOT marked deferred
    expect(hasDeferredAiSetup()).toBe(false);
  });

  it('opens the provider console via the real openExternal', () => {
    renderFlow();
    goToAi();
    fireEvent.click(screen.getByTestId('ai-open-console'));
    expect(h.openExternal).toHaveBeenCalledWith('https://console.anthropic.com/settings/keys');
  });

  it('a dot jump cannot skip past Connect while an OAuth sign-in is pending (even after Back)', () => {
    renderFlow();
    goToAi(); // intro -> choose-start(own) -> compliance -> AI
    fireEvent.click(screen.getByTestId('onboarding-v2-continue')); // AI -> Connect
    expect(screen.getByTestId('onboarding-v2-connect')).toBeTruthy();

    // A Microsoft/Gmail/OneDrive sign-in starts (pending)...
    act(() => { useOAuthPendingStore.getState().begin(); });
    // ...the user clicks Back to the AI scene...
    fireEvent.click(screen.getByTestId('onboarding-v2-back')); // Connect -> AI
    expect(screen.getByTestId('onboarding-v2-ai')).toBeTruthy();

    // ...then tries to dot-jump straight to Firm setup (step 5). The forward
    // lock must hold from this earlier scene too, NOT just on the Connect step.
    fireEvent.click(screen.getByRole('button', { name: ONB_COPY.nav.goToStep(5) }));
    expect(screen.queryByTestId('onboarding-v2-firm')).toBeNull();
    expect(screen.getByTestId('onboarding-v2-ai')).toBeTruthy();

    // Once the sign-in settles, navigation is allowed again.
    act(() => { useOAuthPendingStore.getState().end(); });
    fireEvent.click(screen.getByRole('button', { name: ONB_COPY.nav.goToStep(5) }));
    expect(screen.getByTestId('onboarding-v2-firm')).toBeTruthy();
  });
});

describe('ConnectScene mounts real connectors', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    h.progress = null;
  });

  it('renders the primary branded connectors, and reveals IMAP as the extra email option', () => {
    renderFlow();
    goToAi();
    clickContinue(); // -> connect
    expect(screen.getByTestId('mail-connect-stub')).toBeTruthy();
    expect(screen.getByTestId('mail-gmail-stub')).toBeTruthy();
    expect(screen.getByTestId('onedrive-stub')).toBeTruthy();
    expect(screen.getByTestId('wealthbox-stub')).toBeTruthy();
    expect(screen.getByAltText('Microsoft Outlook logo')).toBeTruthy();
    expect(screen.getByLabelText('Gmail logo')).toBeTruthy();
    expect(screen.getByAltText('OneDrive logo')).toBeTruthy();
    expect(screen.getByAltText('Wealthbox logo')).toBeTruthy();
    expect(screen.queryByTestId('mail-imap-stub')).toBeNull();
    fireEvent.click(screen.getByTestId('connect-more-email'));
    expect(screen.getByTestId('mail-imap-stub')).toBeTruthy();
  });
});

describe('FirmSetupScene drives bars from useSetupProgress', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    h.localState = 'absent';
  });

  function gotoFirm() {
    renderFlow();
    goToAi();
    clickContinue(); // connect
    clickContinue(); // firm
  }

  it('shows an idle state when progress is null (off-desktop)', () => {
    h.progress = null;
    gotoFirm();
    expect(screen.getByTestId('firm-progress-idle')).toBeTruthy();
  });

  it('renders a ready cloud AI row (verified key) and a syncing email row from real progress', () => {
    // A cloud key only reads as "ready" once it has passed a real live check.
    markKeyVerified('anthropic');
    h.progress = makeProgress({
      ai: {
        mode: 'cloud',
        state: 'ready',
        percent: null,
        cloudKeyPresent: true,
        localLlm: { state: 'none', percent: null },
        searchModel: { state: 'ready', percent: null },
      },
      email: { connected: true, credentialsAvailable: true, accounts: [{ provider: 'm365', label: 'Microsoft 365' }], syncing: true, messagesImported: 128 },
    });
    gotoFirm();
    const aiRow = screen.getByTestId('firm-row-ai');
    expect(aiRow.textContent).toContain('Your AI provider is connected');
    expect(aiRow.querySelector('[data-testid="progress-status"]')?.textContent).toBe('Done');

    const emailRow = screen.getByTestId('firm-row-email');
    expect(emailRow.textContent).toContain('128 imported');
    expect(emailRow.querySelector('[data-testid="progress-status"]')?.textContent).toBe('Working');
  });

  it('shows OneDrive import progress in the shared setup progress list', () => {
    h.progress = makeProgress({
      oneDrive: { syncing: true, status: 'syncing', itemsChecked: 42, itemsImported: 7 },
    });
    gotoFirm();
    const oneDriveRow = screen.getByTestId('firm-row-onedrive');
    expect(oneDriveRow.textContent).toContain('OneDrive');
    expect(oneDriveRow.textContent).toContain('7 imported');
    expect(oneDriveRow.querySelector('[data-testid="progress-status"]')?.textContent).toBe('Working');
  });

  it('does not call computer-wide connector credentials done in a brand-new workspace', () => {
    // The credential can be reused on this computer, but this workspace has
    // not received any email or Wealthbox data yet. Only the workspace state
    // may drive the green Done status.
    h.progress = makeProgress({
      email: { connected: false, credentialsAvailable: true, accounts: [], syncing: false, messagesImported: null },
      crm: { connected: false, credentialsAvailable: true, syncing: false, householdsProcessed: 0, recordsIndexed: 0 },
    });
    gotoFirm();

    expect(screen.getByTestId('firm-row-email').querySelector('[data-testid="progress-status"]')?.textContent).toBe('Not started');
    expect(screen.getByTestId('firm-row-crm').querySelector('[data-testid="progress-status"]')?.textContent).toBe('Not started');
  });

  it('shows "not verified" for a cloud key that was saved but never live-checked', () => {
    // No verified marker in localStorage: cloudKeyPresent but unverified (e.g.
    // saved while the provider was unreachable). We must NOT claim "ready".
    h.progress = makeProgress({
      ai: {
        mode: 'cloud',
        state: 'ready',
        percent: null,
        cloudKeyPresent: true,
        localLlm: { state: 'none', percent: null },
        searchModel: { state: 'ready', percent: null },
      },
    });
    gotoFirm();
    const aiRow = screen.getByTestId('firm-row-ai');
    expect(aiRow.textContent).toContain('AI key saved');
    expect(aiRow.textContent).toContain('not verified yet');
    expect(aiRow.querySelector('[data-testid="progress-status"]')?.textContent).toBe('Not verified');
  });

  it('shows a failed AI setup row and retries failed model downloads', () => {
    h.progress = makeProgress({
      ai: {
        mode: 'local',
        state: 'failed',
        percent: null,
        cloudKeyPresent: false,
        localLlm: { state: 'failed', percent: null },
        searchModel: { state: 'failed', percent: null },
      },
    });
    gotoFirm();
    const aiRow = screen.getByTestId('firm-row-ai');
    expect(aiRow.textContent).toContain('AI setup needs a retry');
    expect(aiRow.querySelector('[data-testid="progress-status"]')?.textContent).toBe('Failed');

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(h.retryFailedModelDownloads).toHaveBeenCalledWith(h.progress);
  });
});
