/**
 * Keepance — GuidedOnboarding mounted as the live first-run surface in App.
 *
 * These pin the App-level wiring that makes the branded guided onboarding the
 * real first-run experience:
 *
 *   1. First run (no completed flag, no recent workspace) renders
 *      GuidedOnboarding, NOT the old WelcomeOnboardingDialog.
 *   2. Completing the flow sets `keepance_onboarding_complete` and it does not
 *      re-show on the next mount.
 *   3. The AI-step "Set this up later" path completes without a key and leaves
 *      the AI-setup reminder active (deferred flag set, no model connected).
 *   4. A key entered during onboarding persists through the keychain path
 *      (KeychainService.setKey), the same save path Settings uses.
 *
 * We mount the real App so the wiring under test (gating + props + the embedded
 * real AiSetupStep) is exercised end-to-end, and mock only the leaf side-effects
 * that would hit the network / a real keychain. App defers the onboarding mount
 * behind a 1200ms timer so the workspace selector paints first; we use real
 * timers and a generous findBy timeout for that first appearance.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// --- Mocks (leaf side-effects only) ----------------------------------------

// Telemetry must never hit the network in tests.
vi.mock('@/platform/utils/telemetry', () => ({
  sendEvent: vi.fn(async () => {}),
}));

// openExternal must never try to open a real URL in jsdom.
vi.mock('@/platform/utils/openExternal', () => ({
  openExternal: vi.fn(async () => {}),
}));

// Keep Ollama detection deterministic; these tests don't drive the local path.
vi.mock('@/platform/providers/OllamaProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/providers/OllamaProvider')>();
  return { ...actual, detectOllama: vi.fn(async () => ({ reachable: false, models: [] })) };
});

// Mock KeychainService so onSaveApiKey persistence is observable without a real
// keychain. `createKeychainService()` is what App calls; we return a stub whose
// setKey is a spy shared across the test via the module-level `setKeySpy`.
const setKeySpy = vi.fn(async () => {});
vi.mock('@/platform/providers/KeychainService', () => ({
  createKeychainService: () => ({
    setKey: setKeySpy,
    getKey: vi.fn(async () => null),
    deleteKey: vi.fn(async () => {}),
    hasKey: vi.fn(async () => false),
    getMaskedKey: vi.fn(async () => null),
    validateKey: vi.fn(async () => ({ valid: true })),
    isEnvKey: vi.fn(async () => false),
    getStoredKeys: vi.fn(() => []),
  }),
}));

import App from '@/App';
import { hasCompletedOnboarding } from '@/features/onboarding/onboardingState';
import { hasDeferredAiSetup } from '@/features/onboarding/aiSetupState';

const ONBOARDING_FLAG = 'keepance_onboarding_complete';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

/**
 * Render App and wait for the onboarding welcome step (deferred behind a 1200ms
 * timer in App). Returns the RTL render result.
 */
async function renderAppAndOpenOnboarding() {
  const utils = render(<App />);
  await screen.findByTestId('onboarding-step-welcome', {}, { timeout: 3000 });
  return utils;
}

/** Walk welcome -> profession(legal) -> workspace -> trust -> AI-key step. */
function advanceToAiSetup() {
  fireEvent.click(screen.getByTestId('onboarding-next-welcome'));
  fireEvent.click(screen.getByTestId('profession-card-legal'));
  fireEvent.click(screen.getByTestId('onboarding-next-profession'));
  fireEvent.click(screen.getByTestId('onboarding-identity-next'));
  fireEvent.click(screen.getByTestId('onboarding-workspace-next'));
  fireEvent.click(screen.getByTestId('onboarding-data-continue'));
}

/** From the AI step onward: email -> firm -> done -> finish. The step-footer
 *  Continue buttons live in GuidedOnboarding (outside the embedded components),
 *  so they work regardless of the email/firm components' jsdom state. */
async function finishFromEmailStep() {
  fireEvent.click(await screen.findByTestId('onboarding-email-continue'));
  fireEvent.click(await screen.findByTestId('onboarding-firm-continue'));
  fireEvent.click(await screen.findByTestId('onboarding-done-confirm'));
}

describe('App — GuidedOnboarding as live first-run surface', () => {
  it('renders GuidedOnboarding (not the old WelcomeOnboardingDialog) on first run', async () => {
    await renderAppAndOpenOnboarding();

    expect(screen.getByTestId('onboarding-step-welcome')).toBeInTheDocument();
    expect(screen.queryByTestId('welcome-onboarding-dialog')).not.toBeInTheDocument();
  });

  it('completing onboarding sets the flag and does not re-show on next mount', async () => {
    const first = await renderAppAndOpenOnboarding();

    advanceToAiSetup();
    fireEvent.click(screen.getByTestId('ai-path-later'));
    await finishFromEmailStep();

    await waitFor(() => expect(hasCompletedOnboarding()).toBe(true));
    expect(localStorage.getItem(ONBOARDING_FLAG)).toBe('true');
    await waitFor(() =>
      expect(screen.queryByTestId('onboarding-step-welcome')).not.toBeInTheDocument(),
    );

    first.unmount();

    // Next launch: flag is set, so onboarding must NOT re-appear. Give the
    // deferred-mount timer time to (not) fire, then assert absence.
    render(<App />);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(screen.queryByTestId('onboarding-step-welcome')).not.toBeInTheDocument();
  });

  it('"Set this up later" completes without a key and leaves the AI-setup reminder active', async () => {
    await renderAppAndOpenOnboarding();
    advanceToAiSetup();

    // Defer: no key entered. The deferred reminder flag is set immediately.
    fireEvent.click(screen.getByTestId('ai-path-later'));
    expect(hasDeferredAiSetup()).toBe(true);

    // The flow still finishes (never dead-ends on the key step).
    await finishFromEmailStep();
    await waitFor(() => expect(hasCompletedOnboarding()).toBe(true));

    // No key was persisted, and the reminder remains active for the AI pane.
    expect(setKeySpy).not.toHaveBeenCalled();
    expect(hasDeferredAiSetup()).toBe(true);
  });

  it('saving a key during onboarding persists via the KeychainService path', async () => {
    await renderAppAndOpenOnboarding();
    advanceToAiSetup();

    // Choose the "use your own account" path and paste a well-formed key.
    fireEvent.click(screen.getByTestId('ai-path-own-account'));
    const validKey = 'sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaa';
    fireEvent.change(screen.getByTestId('ai-setup-key-input'), {
      target: { value: validKey },
    });
    fireEvent.click(screen.getByTestId('ai-setup-save-key'));

    // The key routed through KeychainService.setKey (the canonical save path).
    await waitFor(() => expect(setKeySpy).toHaveBeenCalledWith('anthropic', validKey));

    // Saving a key clears the deferred flag — AI is now connected.
    expect(hasDeferredAiSetup()).toBe(false);
  });
});
