/**
 * Keepance 3.0 — FirstRunWizard mounted as the live first-run surface in App.
 *
 * The rebuilt wizard exists but a prior task left App.tsx mounting only the old
 * WelcomeOnboardingDialog + FeatureTour. These tests pin the wiring that makes
 * the wizard the real first-run experience:
 *
 *   1. First run (no completed flag, no recent workspace) renders the
 *      FirstRunWizard, NOT the old WelcomeOnboardingDialog.
 *   2. Completing the wizard sets `keepance_onboarding_complete` and the wizard
 *      does not re-show on the next mount.
 *   3. The "Set this up later" path completes without a key and leaves the
 *      AI-setup reminder active (deferred flag set, no model connected).
 *   4. A key entered during onboarding persists through the keychain path
 *      (KeychainService.setKey), the same save path Settings uses.
 *
 * App is a large component that pulls in many heavy modules. We mount the real
 * App so the wiring under test (gating + props) is exercised end-to-end, and
 * mock only the leaf side-effects that would hit the network / a real keychain.
 *
 * App defers the wizard mount behind a 1200ms timer so the workspace selector
 * paints first; we use real timers and a generous findBy timeout for that first
 * appearance rather than fake timers (fake timers deadlock RTL's async helpers).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// --- Mocks (leaf side-effects only) ----------------------------------------

// Telemetry must never hit the network in tests.
vi.mock('@/utils/telemetry', () => ({
  sendEvent: vi.fn(async () => {}),
}));

// openExternal must never try to open a real URL in jsdom.
vi.mock('@/utils/openExternal', () => ({
  openExternal: vi.fn(async () => {}),
}));

// Keep Ollama detection deterministic; these tests don't drive the local path.
vi.mock('@/modules/models/OllamaProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/models/OllamaProvider')>();
  return { ...actual, detectOllama: vi.fn(async () => ({ reachable: false, models: [] })) };
});

// Mock KeychainService so onSaveApiKey persistence is observable without a real
// keychain. `createKeychainService()` is what App calls; we return a stub whose
// setKey is a spy shared across the test via the module-level `setKeySpy`.
const setKeySpy = vi.fn(async () => {});
vi.mock('@/modules/models/KeychainService', () => ({
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
import { hasCompletedOnboarding } from '@/components/onboarding/FirstRunWizard';
import { hasDeferredAiSetup } from '@/onboarding/aiSetupState';

const ONBOARDING_FLAG = 'keepance_onboarding_complete';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

/**
 * Render App and wait for the wizard's welcome step (deferred behind a 1200ms
 * timer in App). Returns the RTL render result.
 */
async function renderAppAndOpenWizard() {
  const utils = render(<App />);
  // Wizard appears after App's 1200ms deferred-mount timer.
  await screen.findByRole('button', { name: "Let's go" }, { timeout: 3000 });
  return utils;
}

/** Click welcome -> profession(legal) -> workspace -> data -> ai-setup. */
function advanceToAiSetup() {
  fireEvent.click(screen.getByRole('button', { name: "Let's go" }));
  fireEvent.click(screen.getByTestId('profession-card-legal'));
  fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
  fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
  fireEvent.click(screen.getByRole('button', { name: /connect an ai/i }));
}

describe('App — FirstRunWizard as live first-run surface', () => {
  it('renders FirstRunWizard (not the old WelcomeOnboardingDialog) on first run', async () => {
    await renderAppAndOpenWizard();

    // The rebuilt wizard's welcome step is shown...
    expect(screen.getByRole('button', { name: "Let's go" })).toBeInTheDocument();
    // ...and the superseded consent dialog is NOT mounted.
    expect(screen.queryByTestId('welcome-onboarding-dialog')).not.toBeInTheDocument();
  });

  it('completing the wizard sets the flag and does not re-show on next mount', async () => {
    const first = await renderAppAndOpenWizard();

    // Walk to the demo step via the no-shame skip, then finish.
    advanceToAiSetup();
    fireEvent.click(screen.getByTestId('ai-path-later'));
    fireEvent.click(await screen.findByRole('button', { name: 'Open my workspace' }));

    await waitFor(() => expect(hasCompletedOnboarding()).toBe(true));
    expect(localStorage.getItem(ONBOARDING_FLAG)).toBe('true');
    // Wizard closed itself on completion.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: "Let's go" })).not.toBeInTheDocument(),
    );

    first.unmount();

    // Next launch: flag is set, so the wizard must NOT re-appear. Give the
    // deferred-mount timer time to (not) fire, then assert absence.
    render(<App />);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(screen.queryByRole('button', { name: "Let's go" })).not.toBeInTheDocument();
  });

  it('"Set this up later" completes without a key and leaves the AI-setup reminder active', async () => {
    await renderAppAndOpenWizard();
    advanceToAiSetup();

    // Defer: no key entered.
    fireEvent.click(screen.getByTestId('ai-path-later'));
    // Deferred reminder flag is set immediately on skip.
    expect(hasDeferredAiSetup()).toBe(true);

    // The wizard still finishes (never dead-ends on the key step).
    fireEvent.click(await screen.findByRole('button', { name: 'Open my workspace' }));
    await waitFor(() => expect(hasCompletedOnboarding()).toBe(true));

    // No key was persisted, and the reminder remains active (deferred + no
    // model connected) for the AI pane to surface.
    expect(setKeySpy).not.toHaveBeenCalled();
    expect(hasDeferredAiSetup()).toBe(true);
  });

  it('onSaveApiKey persists an onboarding key via the KeychainService path', async () => {
    await renderAppAndOpenWizard();
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
