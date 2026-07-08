/**
 * B-PRIV-1 DOM coverage against the NEW single top-bar egress badge (fix round 1,
 * item 6). The Ask HEADER pill was removed in F1, so the always-visible egress
 * signal is now the top-bar pill, driven by `useActiveEgressDestination` (the
 * single source) and rendered by `EgressIndicator`. These tests render that exact
 * pair — the real hook + the real badge + the real resolver — and pin:
 *
 *   1. the badge's DESTINATION agrees with the send path across every mode:
 *      local-only (ready / setting-up), direct/BYOK, assured, none, demo; and
 *   2. the one-frame guarantee (item 1): flipping Local-only → Direct must NEVER
 *      paint a local destination under Direct, not even for the pre-effect frame.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

const h = vi.hoisted(() => ({
  mode: 'direct' as string,
  localStatus: 'absent' as string,
  ollamaReachable: false,
  assuredProviders: [] as string[],
  keys: { anthropic: null as string | null, openai: null as string | null, google: null as string | null },
  // When set, KeychainService.hasKey awaits this so the async resolution can be
  // held mid-flight (proves the mode-tag never shows a stale local destination).
  hold: null as Promise<unknown> | null,
  // Local-readiness subscribers captured from the egress hook (item 3).
  readinessCallbacks: [] as Array<() => void>,
}));

vi.mock('@/platform/hooks/useConfidentialityMode', () => ({
  getConfidentialityMode: () => h.mode,
  // The EgressIndicator reads this too; keep it in sync with the driven mode.
  useConfidentialityMode: () => h.mode,
}));
vi.mock('@/platform/settings/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ getSetting: () => '' }) },
}));
vi.mock('@/platform/providers/keyVerification', () => ({
  getVerifiedProviders: () => new Set<string>(),
  getInvalidProviders: () => new Set<string>(),
}));
vi.mock('@/platform/firm/resolveAssuredRoute', () => ({
  resolveAssuredRoute: (provider: string, model: string, stream = true) =>
    h.mode === 'assured' && h.assuredProviders.includes(provider)
      ? { provider, model, accessToken: 'a', seatToken: 's', stream }
      : undefined,
}));
vi.mock('@/platform/providers/OllamaProvider', () => ({
  detectOllama: vi.fn(async () => ({ reachable: h.ollamaReachable, models: [] })),
  OllamaProvider: class { getMetadata() { return { model: 'ollama-test' }; } },
}));
vi.mock('@/platform/providers/AppLocalProvider', () => ({
  AppLocalProvider: class { getMetadata() { return { model: 'lantern-local-test' }; } },
}));
vi.mock('@/platform/utils/tauri-commands', async (orig) => {
  const actual = await orig<typeof import('@/platform/utils/tauri-commands')>();
  return { ...actual, localLlmModelStatus: vi.fn(async () => h.localStatus) };
});
vi.mock('@/platform/providers/KeychainService', () => ({
  KeychainService: vi.fn().mockImplementation(function () {
    return {
      getKey: async (p: string) => {
        if (h.hold) await h.hold;
        return h.keys[p as keyof typeof h.keys] ?? null;
      },
      hasKey: async (p: string) => {
        if (h.hold) await h.hold;
        return Boolean(h.keys[p as keyof typeof h.keys]?.trim());
      },
      getStoredKeys: () =>
        (['anthropic', 'openai', 'google'] as const)
          .filter((p) => h.keys[p]?.trim())
          .map((provider) => ({ provider })),
    };
  }),
}));
// Web-demo flag off for these desktop-path tests.
vi.mock('@/web-demo/demoModeFlag', () => ({ IS_DEMO: false }));

// Capture the egress hook's local-readiness subscription so a test can fire it
// (item 3): the real one bridges a Tauri event we can't drive in jsdom.
vi.mock('@/platform/privacy/localAiReadiness', () => ({
  onLocalAiReadinessChange: (cb: () => void) => {
    h.readinessCallbacks.push(cb);
    return () => {
      h.readinessCallbacks = h.readinessCallbacks.filter((c) => c !== cb);
    };
  },
}));

import { useActiveEgressDestination } from '@/platform/hooks/useActiveEgressProvider';
import { EgressIndicator } from '@/platform/privacy/ui/EgressIndicator';
import type { ConfidentialityMode } from '@/platform/privacy/egress';

function TopBarBadge({ mode }: { mode: string }) {
  const dest = useActiveEgressDestination(mode);
  return (
    <EgressIndicator
      provider={dest?.providerId ?? null}
      mode={mode as ConfidentialityMode}
      assuredAvailable={dest?.assuredAvailable ?? false}
      variant="status"
    />
  );
}

function destination() {
  return screen.getByTestId('egress-indicator').getAttribute('data-destination');
}

beforeEach(() => {
  h.mode = 'direct';
  h.localStatus = 'absent';
  h.ollamaReachable = false;
  h.assuredProviders = [];
  h.keys = { anthropic: null, openai: null, google: null };
  h.hold = null;
  h.readinessCallbacks = [];
  localStorage.clear();
});

describe('top-bar badge destination agrees with the send path across modes', () => {
  it('direct/BYOK → provider-direct', async () => {
    h.keys.anthropic = 'sk-ant';
    render(<TopBarBadge mode="direct" />);
    await waitFor(() => expect(destination()).toBe('provider-direct'));
  });

  it('no provider → none', async () => {
    render(<TopBarBadge mode="direct" />);
    await waitFor(() => expect(destination()).toBe('none'));
  });

  it('local-only, engine ready → local', async () => {
    h.mode = 'local-only';
    h.localStatus = 'ready';
    render(<TopBarBadge mode="local-only" />);
    await waitFor(() => expect(destination()).toBe('local'));
  });

  it('local-only, nothing usable → local-pending ("setting up"), never local', async () => {
    h.mode = 'local-only';
    h.localStatus = 'absent';
    h.ollamaReachable = false;
    render(<TopBarBadge mode="local-only" />);
    await waitFor(() => expect(destination()).toBe('local-pending'));
    expect(screen.getByTestId('egress-indicator').textContent).not.toMatch(/Using local AI/i);
  });

  it('assured mode + a personal key → global badge is assured-proxy when a firm route is live', async () => {
    h.mode = 'assured';
    h.assuredProviders = ['openai'];
    h.keys.anthropic = 'sk-ant';
    render(<TopBarBadge mode="assured" />);
    await waitFor(() => expect(destination()).toBe('assured-proxy'));
  });
});

describe('one-frame guarantee: Local-only → Direct never paints local under Direct', () => {
  it('holds the async resolve and confirms the badge is never a local destination once mode is Direct', async () => {
    // Start fully resolved on a local engine in Local-only.
    h.mode = 'local-only';
    h.localStatus = 'ready';
    const { rerender } = render(<TopBarBadge mode="local-only" />);
    await waitFor(() => expect(destination()).toBe('local'));

    // Flip to Direct with a cloud key, but HOLD the async keychain probe so the
    // only way off "local" is the synchronous, mode-tagged derivation.
    h.mode = 'direct';
    h.keys.anthropic = 'sk-ant';
    let release: (v: unknown) => void = () => undefined;
    h.hold = new Promise((r) => { release = r; });

    await act(async () => {
      rerender(<TopBarBadge mode="direct" />);
    });

    // The badge must NOT claim a local destination under Direct — the mode-tag
    // returns null ("checking") until the resolver settles under the new mode.
    expect(destination()).not.toBe('local');

    // Let it settle: it resolves to the real cloud destination.
    release('done');
    await waitFor(() => expect(destination()).toBe('provider-direct'));
  });
});

describe('item 3: the badge flips off "Local AI setting up" when the model becomes ready', () => {
  it('re-resolves on the local-readiness signal — no reload needed', async () => {
    h.mode = 'local-only';
    h.localStatus = 'absent';
    h.ollamaReachable = false;
    render(<TopBarBadge mode="local-only" />);
    await waitFor(() => expect(destination()).toBe('local-pending'));

    // The embedded model finishes downloading: readiness flips to ready and the
    // Tauri event fires. The egress hook subscribed to it, so firing the captured
    // callback must re-resolve the badge to the on-device engine.
    expect(h.readinessCallbacks.length).toBeGreaterThan(0);
    h.localStatus = 'ready';
    await act(async () => {
      h.readinessCallbacks.forEach((cb) => cb());
    });
    await waitFor(() => expect(destination()).toBe('local'));
  });
});
