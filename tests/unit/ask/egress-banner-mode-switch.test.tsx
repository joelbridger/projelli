/**
 * B-PRIV-1 regression — the inline Search/Ask egress banner must NEVER lie about
 * where the next AI request goes. It is the product's flagship "honest egress
 * indicator", so a banner saying "No prompt or file is sent over the network"
 * while the query goes to OpenAI is a correctness defect.
 *
 * The reported bug (Windows-bench, 2026-06-26): start a search in "On this
 * computer only" (local-only) mode — banner correctly reads "Nothing leaves …".
 * Switch to Cloud (direct) mode in Settings, then run another query in the SAME
 * session: the banner KEPT saying "nothing leaves / local" while the query went
 * to the cloud.
 *
 * Codex re-review found two further holes after the first fix; this suite pins
 * BOTH, driving the REAL resolver (resolveActiveAskProviderId) + the REAL
 * EgressIndicator + the REAL egress logic + the REAL (reactive) settings store:
 *
 *   1. DISPLAY race on mode-switch — resolution is async; until it finishes the
 *      stale local provider + the new Direct mode still rendered as "nothing
 *      leaves". Fixed by blanking the badge to a neutral "checking" state for the
 *      whole async window (tests 1 & 2, and the pending assertion in test 3).
 *   2. SEND-TIME race — the badge must reflect the REAL destination BEFORE the
 *      network call begins, even if it was still "checking" at click time. Fixed
 *      with flushSync at send (test 3: a spy on sendMessageStreaming reads the
 *      banner DOM at the instant the send begins).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Ask } from '@/features/ask/Ask';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { CONFIDENTIALITY_MODE_SETTING_KEY } from '@/platform/privacy/egress';
import type { ConfidentialityMode } from '@/platform/privacy/egress';

// Control object for the REAL resolver's dependencies + the send spy. Driven
// per-test; the confidentiality mode itself uses the real (reactive) settings
// store so the component genuinely re-renders on a mode flip.
const h = vi.hoisted(() => ({
  keys: { anthropic: false, openai: false, google: false } as Record<string, boolean>,
  localStatus: 'absent' as string,
  memoryEnabled: false,
  hits: [] as unknown[],
  // When set to a pending Promise, KeychainService.hasKey awaits it — this holds
  // the REAL resolver mid-flight so we can prove the badge is "checking" (never a
  // stale destination) and that the send-time pin still names the real engine.
  resolverHold: null as Promise<unknown> | null,
  // Number of times each provider's send was actually invoked. The send-side
  // privacy test asserts the CLOUD send is never called once Local-only is on.
  sendCalled: 0, // cloud provider (from buildResolvedAskProvider)
  localSendCalled: 0, // on-device provider (from resolveLocalOnlyAskProvider re-resolve)
  // Optional hook run INSIDE buildResolvedAskProvider to model the user flipping
  // the confidentiality mode DURING the resolver's keychain await.
  onBuildResolve: null as (() => void) | null,
}));

function setMode(mode: ConfidentialityMode) {
  act(() => {
    useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, mode);
  });
}

// ---- standard Ask store mocks ----------------------------------------------
vi.mock('@/platform/client-context', () => ({
  useSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
  readSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
}));
vi.mock('@/platform/matter/matterStore', () => ({
  useActiveMatter: () => null,
  SAMPLE_MATTER_ID: 'matter_sample_garcia_v_meridian',
}));
vi.mock('@/platform/fs/workspaceStore', () => {
  const wsState = { rootPath: '/workspace' };
  const useWorkspaceStore = (selector: (s: { rootPath: string | null }) => unknown) => selector(wsState);
  useWorkspaceStore.getState = () => wsState;
  return { useWorkspaceStore };
});
vi.mock('@/platform/matter/samples/sampleMatterDemo', () => ({
  getDemoAnswerForWorkspace: () => null,
  getDemoQuestions: () => ['A', 'B', 'C', 'D'] as [string, string, string, string],
  DEMO_QUESTIONS: ['A', 'B', 'C', 'D'],
}));
vi.mock('@/platform/profile/professionStore', () => ({
  useProfessionStore: (selector: (s: { profession: string }) => unknown) =>
    selector({ profession: 'advisor' }),
  getProfession: () => 'advisor',
}));
vi.mock('@/platform/rag/matterResolver', () => ({
  matterLabel: (m: unknown) => String(m),
}));
vi.mock('@/platform/rag/MemoryService', () => ({
  MemoryService: { retrieve: vi.fn(async () => h.hits) },
  isMemoryEnabled: () => h.memoryEnabled,
}));
vi.mock('@/platform/rag/workspaceCommand', async (orig) => {
  const actual = await orig<typeof import('@/platform/rag/workspaceCommand')>();
  return { ...actual, DEFAULT_WORKSPACE_TOP_K: 5, buildWorkspaceContextBlock: () => '' };
});
vi.mock('@/platform/state/aiChatStore', () => {
  const state = {
    initSession: vi.fn(),
    setSessionWorkspaceRoot: vi.fn(),
    addMessage: vi.fn(),
    updateLastMessage: vi.fn(),
    sessions: {} as Record<string, unknown>,
  };
  const hook = (selector: (s: unknown) => unknown) => selector(state);
  hook.getState = () => state;
  return {
    useAIChatStore: hook,
    // F2.5 — Ask reads per-conversation file-access consent; granted (all-clients)
    // here so these tests still exercise the consented retrieval path.
    useFileAccessConsent: () => ({ state: "granted", grantedScope: { kind: "allMatters" } }),
    getFileAccessConsent: () => ({ state: "granted", grantedScope: { kind: "allMatters" } }),
  };
});

// ---- REAL resolver, mocked dependencies ------------------------------------
// hasKey can be held mid-flight (h.resolverHold) so we can observe the badge
// while resolution is in progress. getKey is unused on the badge path.
vi.mock('@/platform/providers/KeychainService', () => ({
  KeychainService: vi.fn().mockImplementation(function () {
    return {
      getKey: async (p: string) => (h.keys[p] ? 'sk-test' : null),
      hasKey: async (p: string) => {
        if (h.resolverHold) await h.resolverHold;
        return Boolean(h.keys[p]);
      },
    };
  }),
}));
vi.mock('@/platform/utils/tauri-commands', async (orig) => {
  const actual = await orig<typeof import('@/platform/utils/tauri-commands')>();
  return { ...actual, localLlmModelStatus: vi.fn(async () => h.localStatus) };
});

// Spy on the REAL resolveEgress (wrap the real impl — behaviour unchanged) so we
// can assert the indicator is never even ASKED to render a local provider under
// Direct mode, not even for the one pre-effect frame. EgressIndicator returns its
// neutral "checking" badge for a null provider BEFORE calling resolveEgress, so a
// recorded {local provider, direct} call can only come from a stale render.
vi.mock('@/platform/privacy/egress', async (orig) => {
  const actual = await orig<typeof import('@/platform/privacy/egress')>();
  return { ...actual, resolveEgress: vi.fn(actual.resolveEgress) };
});

// Keep the REAL resolveActiveAskProviderId (what drives the badge). Override the
// SEND path: buildResolvedAskProvider returns a CLOUD spy provider (and can flip
// the mode mid-resolve via h.onBuildResolve to model the race), and
// resolveLocalOnlyAskProvider returns an on-device spy. The send-side guard in
// useAsk must route to the local spy (never the cloud spy) once Local-only is on.
vi.mock('@/features/ask/askHelpers', async (orig) => {
  const actual = await orig<typeof import('@/features/ask/askHelpers')>();
  return {
    ...actual,
    buildResolvedAskProvider: vi.fn(async () => {
      // Model the user switching mode DURING the resolver's (awaited) keychain reads.
      h.onBuildResolve?.();
      return {
        provider: {
          sendMessageStreaming: async () => {
            h.sendCalled += 1;
            return { content: 'Answer.', usage: {}, cost: 0 };
          },
          getMetadata: () => ({ provider: 'openai', model: 'gpt-4o' }),
        },
        providerId: 'openai',
        model: 'gpt-4o',
      };
    }),
    resolveLocalOnlyAskProvider: vi.fn(async () => ({
      provider: {
        sendMessageStreaming: async () => {
          h.localSendCalled += 1;
          return { content: 'Local answer.', usage: {}, cost: 0 };
        },
        getMetadata: () => ({ provider: 'lantern-local', model: 'kp' }),
      },
      providerId: 'lantern-local',
      model: 'kp',
    })),
  };
});

describe('B-PRIV-1: Search egress banner is honest across mode-switch AND at send time', () => {
  beforeEach(() => {
    useSettingsStore.setState({ values: {} });
    h.keys = { anthropic: false, openai: false, google: false };
    h.localStatus = 'absent';
    h.memoryEnabled = false;
    h.hits = [];
    h.resolverHold = null;
    h.sendCalled = 0;
    h.localSendCalled = 0;
    h.onBuildResolve = null;
    try {
      localStorage.clear();
    } catch {
      /* jsdom always has localStorage */
    }
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // NOTE (F1 — single-source egress): the Ask/Search HEADER egress PILL was
  // removed. Egress status is now single-sourced in the top-bar TrustBar, and the
  // badge-DOM honesty these four cases used to assert on that pill moved with it:
  //   - the badge flips honestly local <-> cloud when the mode switches, and the
  //     pending ("checking") + data-leaves states — now covered against the ONE
  //     source in tests/unit/privacy/active-egress-provider.test.tsx and
  //     tests/unit/privacy/single-source-egress.test.ts;
  //   - the provider the badge names across every mode — covered against the real
  //     resolver in tests/unit/privacy/local-only-egress-guard.test.ts.
  // What remains UNIQUE and load-bearing here is the SEND-SIDE privacy race
  // below: it exercises the REAL <Ask> send path, which no resolver-level test
  // does. So this file keeps that one case.

  it('SEND-SIDE PRIVACY GUARANTEE: flipping to Local-only DURING the resolve await never sends to the cloud provider', async () => {
    // The deeper hole: buildResolvedAskProvider checks the mode only at its START,
    // then awaits keychain reads. If the user switches to Local-only during those
    // awaits it can still return a CLOUD provider — and without the final
    // synchronous send guard the query would actually go to OpenAI while
    // Local-only is on. That is a real privacy violation (local-only's whole
    // guarantee is that NOTHING is ever sent to the cloud), not just a display lie.
    h.keys['openai'] = true;
    h.memoryEnabled = true;
    h.hits = [{ path: '/workspace/doc.pdf', chunkText: 'text', score: 0.9, paragraphIndex: 0 }];
    setMode('direct');

    // Model the race: flip to Local-only WHILE buildResolvedAskProvider is resolving.
    h.onBuildResolve = () => {
      useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, 'local-only');
    };

    render(<Ask />);
    const input = screen.getByTestId('ask-composer-input');
    fireEvent.change(input, { target: { value: 'What is the portfolio value?' } });
    fireEvent.click(screen.getByRole('button', { name: /^Ask$/i }));

    // The send guard must re-resolve to the on-device engine and answer locally...
    await waitFor(() => {
      expect(h.localSendCalled).toBe(1);
    });
    // ...and the CLOUD provider must NEVER have been sent to. This is the
    // load-bearing privacy assertion: local-only never leaks to the cloud, even
    // when the mode flips mid-resolve.
    expect(h.sendCalled).toBe(0);
  });
});
