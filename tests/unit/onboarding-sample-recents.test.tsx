/**
 * Regression: OnboardingV2 "sample practice" (and "own data") first-run path
 * must register the new workspace in Recents AND must not loop back to the intro
 * once a workspace loads.
 *
 * The BLOCKER (found on real-Windows QA): picking the recommended "Start with a
 * sample practice" created the workspace successfully, but
 *   1. the sample-flow creation path never added the workspace to
 *      `lantern_recent_workspaces`, so the App first-run gate
 *      (`!hasCompletedOnboarding() && recentWorkspaces.length === 0`) stayed
 *      true; and
 *   2. once the workspace loaded (rootPath set), App's top-level render flipped
 *      from the WorkspaceSelector branch to the main shell. The full-screen
 *      onboarding overlay renders in BOTH branches, so switching branches
 *      remounted OnboardingV2 and reset its internal `scene` back to the intro.
 *      The user oscillated intro ↔ choose-start forever, never reaching the
 *      next onboarding beat.
 *
 * These tests mount the REAL App so both the recents registration and the
 * branch-stability fix are exercised end-to-end. Note the existing
 * first-run-mount.test.tsx no-ops handleWorkspaceSelected (so rootPath never
 * gets set) — which is exactly why it never caught facet #2. Here we let a
 * test double set rootPath so the branch would flip in the buggy code.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

// --- Mocks (leaf side-effects only; mirrors first-run-mount.test.tsx) --------

vi.mock('@/platform/utils/telemetry', () => ({ sendEvent: vi.fn(async () => {}) }));
vi.mock('@/platform/utils/openExternal', () => ({ openExternal: vi.fn(async () => {}) }));
vi.mock('@/platform/providers/OllamaProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/providers/OllamaProvider')>();
  return { ...actual, detectOllama: vi.fn(async () => ({ reachable: false, models: [] })) };
});
const validateApiKeyLive = vi.fn(async (..._args: unknown[]) => ({ outcome: 'ok' as const, message: 'ok' }));
vi.mock('@/platform/providers/apiKeyValidation', () => ({
  validateApiKeyLive: (...a: unknown[]) => validateApiKeyLive(...a),
}));
vi.mock('@/features/onboarding/v2/LottiePlayer', () => ({
  LottiePlayer: () => <div data-testid="lottie-stub" />,
}));

// Fake WorkspaceService: initialize resolves a fake workspace; getRootPath
// returns it. writeFile/exists let the sample-seeding path run without a real FS.
const fakeWorkspaceService = {
  initialize: vi.fn(async () => ({ rootPath: '/ws', name: 'ws' })),
  getRootPath: () => '/ws',
  writeFile: vi.fn(async () => {}),
  exists: vi.fn(async () => false),
  getFileTree: vi.fn(async () => []),
  getBackend: () => null,
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

// handleWorkspaceSelected does heavy real work; drive it through a swappable
// impl so one test can no-op it (rootPath stays null) and another can faithfully
// simulate the real workspace load — which sets BOTH rootPath AND
// showWorkspaceSelector=false, the combination that flipped App's render branch
// (and, in the buggy build, remounted OnboardingV2 back to the intro). The mock
// receives the SAME options object the real hook gets, so it can drive App's
// setShowWorkspaceSelector / setRootPath exactly like production does.
type LifecycleOpts = {
  setShowWorkspaceSelector: (v: boolean) => void;
  setRootPath: (p: string) => void;
  workspaceServiceRef: { current: unknown };
};
// Faithful stand-in for the REAL handleWorkspaceSelected: it does exactly what
// the real hook does that matters to App's render + first-run gate — sets
// rootPath, clears the workspace selector, AND registers the workspace in
// Recents (the real registration now lives at that shared boundary; see
// useWorkspaceLifecycle-recents.test.tsx, which verifies it against the UNMOCKED
// hook). Because the hook is mocked here, THIS file's job is the App-level LOOP
// behaviour, not to prove the real registration. Setting rootPath + clearing the
// selector is the exact combination that flipped App's render branch and
// remounted OnboardingV2 at the intro in the buggy build.
const faithfulLifecycleImpl = async (svc: unknown, opts: LifecycleOpts) => {
  opts.workspaceServiceRef.current = svc;
  opts.setShowWorkspaceSelector(false);
  opts.setRootPath('/ws');
  useWorkspaceStore.getState().addRecentWorkspace({
    path: '/ws',
    name: 'ws',
    lastOpened: new Date(),
  });
  // The real handler reports whether the switch COMMITTED (QA-93 round 3);
  // callers treat a falsy result as "the user stayed put", so the faithful
  // stand-in must report success.
  return true;
};
let handleWorkspaceSelectedImpl: (svc: unknown, opts: LifecycleOpts) => Promise<boolean> =
  faithfulLifecycleImpl;
vi.mock('@/app/lifecycle/useWorkspaceLifecycle', () => ({
  useWorkspaceLifecycle: (opts: LifecycleOpts) => ({
    handleWorkspaceSelected: (svc: unknown) => handleWorkspaceSelectedImpl(svc, opts),
    handleOpenRecentProject: vi.fn(async () => {}),
  }),
}));

vi.mock('@/platform/providers/KeychainService', () => ({
  createKeychainService: () => ({
    setKey: vi.fn(async () => {}),
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
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';

const RECENTS_KEY = 'lantern_recent_workspaces';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  handleWorkspaceSelectedImpl = faithfulLifecycleImpl;
  // Reset the shared workspace store so recents/rootPath don't leak between tests.
  useWorkspaceStore.setState({ recentWorkspaces: [], rootPath: null });
});

/** Render App and wait for the onboarding intro (deferred behind a 1200ms timer). */
async function openOnboarding() {
  const utils = render(<App />);
  await screen.findByTestId('onboarding-v2-intro', {}, { timeout: 3000 });
  return utils;
}

/** intro -> choose-start, then click the given start card. */
async function goToChooseStartAndPick(testId: 'choose-start-sample' | 'choose-start-own') {
  fireEvent.click(screen.getByTestId('onboarding-v2-go'));
  await screen.findByTestId(testId);
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
}

describe('OnboardingV2 sample/own start — recents + no intro loop', () => {
  it('sample start registers the workspace in Recents and advances to the compliance beat', async () => {
    await openOnboarding();
    await goToChooseStartAndPick('choose-start-sample');

    // Facet #1: workspace registered in recents via the shared store path, so
    // the first-run gate (recentWorkspaces.length === 0) is now false.
    const recents = useWorkspaceStore.getState().recentWorkspaces;
    expect(recents.some((w) => w.path === '/ws')).toBe(true);
    expect(localStorage.getItem(RECENTS_KEY)).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(RECENTS_KEY)!)).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: '/ws' })]),
    );

    // The wizard advanced past choose-start to the next beat. It did NOT loop
    // back to the intro.
    await screen.findByTestId('onboarding-v2-compliance');
    expect(screen.queryByTestId('onboarding-v2-intro')).not.toBeInTheDocument();
  });

  it('does NOT loop back to the intro once the workspace loads (rootPath set)', async () => {
    // Uses the faithful default impl (beforeEach): it sets rootPath AND clears
    // the workspace selector — the combination that, in the buggy build, flipped
    // App to the main shell and remounted OnboardingV2 at the intro — and also
    // registers the workspace in Recents (as the real hook now does).
    await openOnboarding();
    await goToChooseStartAndPick('choose-start-own');

    // rootPath is now set...
    expect(useWorkspaceStore.getState().rootPath).toBe('/ws');
    // ...and the workspace is in recents.
    expect(useWorkspaceStore.getState().recentWorkspaces.some((w) => w.path === '/ws')).toBe(true);

    // The wizard stays mounted and advances to the compliance beat; it does NOT
    // reset to the intro, and App does NOT flip to the main shell mid-onboarding.
    await screen.findByTestId('onboarding-v2-compliance');
    await waitFor(() =>
      expect(screen.queryByTestId('onboarding-v2-intro')).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId('app-container')).not.toBeInTheDocument();
  });
});
