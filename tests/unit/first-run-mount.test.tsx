/**
 * Advisor Prep Hero — OnboardingV2 mounted as the live first-run surface in App.
 *
 * These pin the App-level wiring that makes the 5-beat OnboardingV2 the real
 * first-run experience (the old 9-step GuidedOnboarding was retired 2026-06-30
 * and archived at src/features/onboarding/_archive/GuidedOnboarding.tsx; its
 * own App-mount coverage moved with it is no longer relevant since App no
 * longer renders it):
 *
 *   1. First run (no completed flag, no recent workspace) renders OnboardingV2,
 *      not the old WelcomeOnboardingDialog or GuidedOnboarding.
 *   2. Completing the flow sets `lantern_onboarding_complete` and it does not
 *      re-show on the next mount.
 *   3. Reaching the end without resolving the AI step leaves the AI-setup
 *      reminder active (deferred flag set, no model connected).
 *   4. A key entered during onboarding persists through the keychain path
 *      (KeychainService.setKey), the same save path Settings uses.
 *
 * We mount the real App so the wiring under test (gating + props + the embedded
 * real AiScene) is exercised end-to-end, and mock only the leaf side-effects
 * that would hit the network / a real keychain. App defers the onboarding mount
 * behind a 1200ms timer so the workspace selector paints first; we use real
 * timers and a generous findBy timeout for that first appearance.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

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

// AiScene live-validates a pasted key before saving it; keep that deterministic.
const validateApiKeyLive = vi.fn(async (..._args: unknown[]) => ({ outcome: 'ok' as const, message: 'ok' }));
vi.mock('@/platform/providers/apiKeyValidation', () => ({
  validateApiKeyLive: (...a: unknown[]) => validateApiKeyLive(...a),
}));

// IntroScene's flowchart loads Lottie JSON by fetch; stub the player.
vi.mock('@/features/onboarding/v2/LottiePlayer', () => ({
  LottiePlayer: () => <div data-testid="lottie-stub" />,
}));

// Workspace-first step: ChooseStartScene now sits between the intro and the AI
// scene and must establish a workspace before advancing. Stub the workspace
// machinery so the "Connect my own data" path resolves a fake workspace in
// jsdom (no real folder picker / FS) without switching App into the full main
// shell (we keep rootPath null so the overlay-over-selector layout is intact).
const fakeWorkspaceService = {
  initialize: vi.fn(async () => ({ rootPath: '/ws', name: 'ws' })),
  getRootPath: () => '/ws',
  writeFile: vi.fn(async () => {}),
  exists: vi.fn(async () => false),
  getFileTree: vi.fn(async () => []),
};
vi.mock('@/platform/fs/WorkspaceService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/fs/WorkspaceService')>();
  return { ...actual, createWorkspaceService: () => fakeWorkspaceService };
});
vi.mock('@/platform/fs/WebFSBackend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/fs/WebFSBackend')>();
  return {
    ...actual,
    createWebFSBackend: () => ({
      openDirectoryPicker: async () => ({ name: 'ws' }),
      setRootHandle: () => {},
    }),
  };
});
// handleWorkspaceSelected does heavy real work (audit/templates/file tree); the
// onboarding workspace-first step only needs it to not throw AND to report the
// switch committed (QA-93 round 3: a falsy result means "user stayed put" and
// onboarding treats it as a cancel), so stub it to succeed.
vi.mock('@/app/lifecycle/useWorkspaceLifecycle', () => ({
  useWorkspaceLifecycle: () => ({
    handleWorkspaceSelected: vi.fn(async () => true),
    handleOpenRecentProject: vi.fn(async () => {}),
  }),
}));

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
  migrateLocalStorageApiKeysToKeychain: vi.fn(async () => {}),
}));

import App from '@/App';
import { hasCompletedOnboarding } from '@/features/onboarding/onboardingState';
import { hasDeferredAiSetup } from '@/features/onboarding/aiSetupState';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';

const ONBOARDING_FLAG = 'lantern_onboarding_complete';

beforeEach(() => {
  vi.clearAllMocks();
  validateApiKeyLive.mockResolvedValue({ outcome: 'ok', message: 'ok' });
  localStorage.clear();
  sessionStorage.clear();
  // The workspace store is a module-level Zustand store: localStorage.clear()
  // does NOT reset its in-memory `recentWorkspaces`. Reset it here so a recent
  // registered by one test (the ChooseStart step now records the new workspace
  // in Recents) can't leak into the next test's first-run gate
  // (`recentWorkspaces.length === 0`) and suppress onboarding.
  useWorkspaceStore.setState({ recentWorkspaces: [], rootPath: null });
});

/**
 * Render App and wait for the onboarding intro scene (deferred behind a
 * 1200ms timer in App). Returns the RTL render result.
 */
async function renderAppAndOpenOnboarding() {
  const utils = render(<App />);
  await screen.findByTestId('onboarding-v2-intro', {}, { timeout: 3000 });
  return utils;
}

/** Walk intro -> choose-start (own data) -> compliance -> ai scene. */
async function advanceToAiScene() {
  fireEvent.click(screen.getByTestId('onboarding-v2-go')); // intro -> choose-start
  await screen.findByTestId('choose-start-own');
  await act(async () => {
    fireEvent.click(screen.getByTestId('choose-start-own')); // establish workspace -> compliance
  });
  await screen.findByTestId('onboarding-v2-compliance');
  fireEvent.click(screen.getByTestId('onboarding-v2-continue')); // compliance -> ai
  await screen.findByTestId('onboarding-v2-ai');
}

/** From the ai scene onward (no AI resolved): connect -> firm -> finish. */
function finishWithoutAi() {
  fireEvent.click(screen.getByTestId('onboarding-v2-continue')); // ai -> connect
  fireEvent.click(screen.getByTestId('onboarding-v2-continue')); // connect -> firm
  fireEvent.click(screen.getByTestId('onboarding-v2-continue')); // firm -> finish
}

describe('App — OnboardingV2 as live first-run surface', () => {
  it('renders OnboardingV2 (not the old WelcomeOnboardingDialog or GuidedOnboarding) on first run', async () => {
    await renderAppAndOpenOnboarding();

    expect(screen.getByTestId('onboarding-v2-intro')).toBeInTheDocument();
    expect(screen.queryByTestId('welcome-onboarding-dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('onboarding-step-welcome')).not.toBeInTheDocument();
  });

  it('completing onboarding sets the flag and does not re-show on next mount', async () => {
    const first = await renderAppAndOpenOnboarding();

    await advanceToAiScene();
    finishWithoutAi();

    await waitFor(() => expect(hasCompletedOnboarding()).toBe(true));
    expect(localStorage.getItem(ONBOARDING_FLAG)).toBe('true');
    await waitFor(() =>
      expect(screen.queryByTestId('onboarding-v2-intro')).not.toBeInTheDocument(),
    );

    first.unmount();

    // Next launch: flag is set, so onboarding must NOT re-appear. Give the
    // deferred-mount timer time to (not) fire, then assert absence.
    render(<App />);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(screen.queryByTestId('onboarding-v2-intro')).not.toBeInTheDocument();
  });

  it('finishing without resolving the AI step leaves the AI-setup reminder active', async () => {
    await renderAppAndOpenOnboarding();
    await advanceToAiScene();

    // Continuing straight off the AI scene (no key, no local choice) marks AI
    // setup deferred.
    finishWithoutAi();

    await waitFor(() => expect(hasCompletedOnboarding()).toBe(true));
    expect(setKeySpy).not.toHaveBeenCalled();
    expect(hasDeferredAiSetup()).toBe(true);
  });

  it('saving a key during onboarding persists via the KeychainService path', async () => {
    await renderAppAndOpenOnboarding();
    await advanceToAiScene();

    const validKey = 'sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaa';
    fireEvent.change(screen.getByTestId('ai-key-input'), {
      target: { value: validKey },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('ai-connect'));
    });

    // The key routed through KeychainService.setKey (the canonical save path).
    await waitFor(() => expect(setKeySpy).toHaveBeenCalledWith('anthropic', validKey));

    // Saving a key clears the deferred flag — AI is now connected.
    expect(hasDeferredAiSetup()).toBe(false);
  });
});
