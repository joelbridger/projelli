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
import {
  CONFIDENTIALITY_MODE_SETTING_KEY,
  resolveEgress,
  isLocalProvider,
} from '@/platform/privacy/egress';
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
  // Recorded by the send spy: the banner's data-destination at the instant the
  // network call begins. This is the load-bearing send-time honesty assertion.
  bannerAtSend: undefined as string | null | undefined,
  // Number of times each provider's send was actually invoked. The send-side
  // privacy test asserts the CLOUD send is never called once Local-only is on.
  sendCalled: 0, // cloud provider (from buildResolvedAskProvider)
  localSendCalled: 0, // on-device provider (from resolveLocalAskProvider re-resolve)
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
vi.mock('@/platform/rag/workspaceCommand', () => ({
  DEFAULT_WORKSPACE_TOP_K: 5,
  buildWorkspaceContextBlock: () => '',
}));
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
// resolveLocalAskProvider returns an on-device spy. The send-side guard in
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
            h.bannerAtSend = document
              .querySelector('[data-testid="egress-indicator"]')
              ?.getAttribute('data-destination') ?? null;
            h.sendCalled += 1;
            return { content: 'Answer.', usage: {}, cost: 0 };
          },
          getMetadata: () => ({ provider: 'openai', model: 'gpt-4o' }),
        },
        providerId: 'openai',
        model: 'gpt-4o',
      };
    }),
    resolveLocalAskProvider: vi.fn(async () => ({
      provider: {
        sendMessageStreaming: async () => {
          h.localSendCalled += 1;
          return { content: 'Local answer.', usage: {}, cost: 0 };
        },
        getMetadata: () => ({ provider: 'keepance-local', model: 'kp' }),
      },
      providerId: 'keepance-local',
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
    h.bannerAtSend = undefined;
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

  it('flips from "nothing leaves" (local-only) to a cloud destination when the mode switches', async () => {
    h.localStatus = 'ready'; // local-only resolves to the embedded Keepance Local AI
    h.keys['openai'] = true; // present for the post-switch cloud resolution
    setMode('local-only');
    render(<Ask />);

    await waitFor(() => {
      expect(screen.getByTestId('egress-indicator').getAttribute('data-destination')).toBe('local');
    });
    expect(screen.getByTestId('egress-indicator').getAttribute('data-data-leaves')).toBe('false');
    // The header pill (status variant) is short ("Using local AI"); the full
    // honest note now lives in its title tooltip, not a visible note span.
    expect(screen.getByTestId('egress-indicator').getAttribute('title')).toMatch(
      /no AI prompt or file is sent to a cloud AI/i,
    );

    // User switches to Cloud (direct) mode in Settings — same search session.
    setMode('direct');

    await waitFor(() => {
      expect(screen.getByTestId('egress-indicator').getAttribute('data-destination')).toBe(
        'provider-direct',
      );
    });
    const cloudEl = screen.getByTestId('egress-indicator');
    expect(cloudEl.getAttribute('data-data-leaves')).toBe('true');
    const cloudNote = cloudEl.getAttribute('title') ?? '';
    expect(cloudNote).not.toMatch(/no AI prompt or file is sent to a cloud AI/i);
    expect(cloudNote).toMatch(/receives the prompt/i);
  });

  it('flips back to "nothing leaves" when the user returns to local-only mode', async () => {
    h.keys['openai'] = true;
    h.localStatus = 'ready';
    setMode('direct');
    render(<Ask />);

    await waitFor(() => {
      expect(screen.getByTestId('egress-indicator').getAttribute('data-destination')).toBe(
        'provider-direct',
      );
    });

    setMode('local-only');

    await waitFor(() => {
      expect(screen.getByTestId('egress-indicator').getAttribute('data-destination')).toBe('local');
    });
    expect(screen.getByTestId('egress-indicator').getAttribute('data-data-leaves')).toBe('false');
  });

  it('ONE-FRAME GUARANTEE: switching Local-only → Direct never renders a local provider under Direct mode, even before the async effect runs', async () => {
    // Start from a fully RESOLVED local badge.
    h.localStatus = 'ready'; // local-only resolves to keepance-local
    h.keys['openai'] = true;
    setMode('local-only');
    render(<Ask />);
    await waitFor(() => {
      expect(screen.getByTestId('egress-indicator').getAttribute('data-destination')).toBe('local');
    });

    // Hold the re-resolution so the badge can ONLY move off "local" via the
    // synchronous, mode-tagged render derivation — not via the async effect.
    let release: (v: unknown) => void = () => undefined;
    h.resolverHold = new Promise((r) => { release = r; });
    vi.mocked(resolveEgress).mockClear();

    try {
      // Flip to Direct. act() flushes the render AND the (now-held) effect.
      setMode('direct');

      // The user-visible banner must no longer claim a local destination.
      expect(screen.getByTestId('egress-indicator').getAttribute('data-destination')).not.toBe(
        'local',
      );

      // The load-bearing check: the indicator must NEVER have been asked to render
      // a LOCAL provider while the mode is Direct — not even for the single
      // pre-effect frame. Without the mode-tagged synchronous derivation, the
      // stale {keepance-local, direct} render fires before the effect blanks it.
      const lyingCall = vi.mocked(resolveEgress).mock.calls.find(
        ([arg]) => arg.mode === 'direct' && isLocalProvider(arg.provider),
      );
      expect(lyingCall).toBeUndefined();
    } finally {
      release('done');
    }
  });

  it('SEND-TIME GUARANTEE: the banner shows the real cloud destination before the network call — even when the badge was still "checking" at click time', async () => {
    // Direct mode + a cloud key => the send goes to OpenAI. Memory is on with a
    // hit so the query reaches the provider (no decline).
    h.keys['openai'] = true;
    h.memoryEnabled = true;
    h.hits = [{ path: '/workspace/doc.pdf', chunkText: 'text', score: 0.9, paragraphIndex: 0 }];
    setMode('direct');

    // HOLD the real resolver mid-flight: the badge cannot resolve, so at click
    // time it is the neutral "checking" (pending) state — NOT a stale "local"
    // banner and NOT yet the cloud banner. This is the worst case for honesty.
    let release: (v: unknown) => void = () => undefined;
    h.resolverHold = new Promise((r) => { release = r; });

    try {
      render(<Ask />);

      // HOLE #1 proof: while resolving, the banner is neutral "pending" — it never
      // shows a concrete (and possibly stale) destination.
      await waitFor(() => {
        expect(screen.getByTestId('egress-indicator').getAttribute('data-destination')).toBe(
          'pending',
        );
      });
      expect(screen.getByTestId('egress-indicator').getAttribute('data-data-leaves')).toBe('false');

      // Send anyway, while the badge is still "checking".
      const input = screen.getByTestId('ask-composer-input');
      fireEvent.change(input, { target: { value: 'What is the portfolio value?' } });
      fireEvent.click(screen.getByRole('button', { name: /^Ask$/i }));

      // HOLE #2 proof: at the instant sendMessageStreaming runs, the banner DOM
      // already reflects the REAL destination (provider-direct / data leaves) —
      // not "pending" and never "local". flushSync guarantees the repaint before
      // the network call.
      await waitFor(() => {
        expect(h.sendCalled).toBe(1);
      });
      expect(h.bannerAtSend).toBe('provider-direct');
    } finally {
      release('done'); // let the held resolver settle so no promise dangles
    }

    // And after everything settles the badge stays on the real destination.
    await waitFor(() => {
      expect(screen.getByTestId('egress-indicator').getAttribute('data-destination')).toBe(
        'provider-direct',
      );
    });
  });

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

    // The banner reflects the local destination at the (local) send too.
    await waitFor(() => {
      expect(screen.getByTestId('egress-indicator').getAttribute('data-destination')).toBe('local');
    });
  });
});
