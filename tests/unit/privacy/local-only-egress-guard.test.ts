/**
 * A1 (Codex QA, blocker): Local-only confidentiality mode must be ENFORCED at
 * the AI send points, not just shown in the indicator. Two paths bypassed it:
 *   - chat send (routes by the chat's stored provider) — now guarded.
 *   - Ask (buildProviderAsync, routes by key presence) — now forces Ollama.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  let _mode = 'direct';
  return {
    // `mode` is a getter/setter: assigning it drives BOTH the mocked
    // getConfidentialityMode (in-memory path) AND the raw persisted localStorage
    // value (the fail-closed cloud-send guard reads storage directly, bypassing
    // the in-memory mock), so the guards under test see a consistent mode.
    get mode() { return _mode; },
    set mode(m: string) {
      _mode = m;
      try {
        localStorage.setItem(
          'lantern:settings',
          JSON.stringify({ state: { values: { confidentialityMode: m } }, version: 1 }),
        );
      } catch {
        /* localStorage unavailable */
      }
    },
    defaultProvider: '',
    defaultModel: '',
    // Embedded Lantern Local AI status as local_llm_model_status() would report.
    localStatus: 'absent' as string,
    // Fix 2 (demo readiness): Local-only mode now falls back to Ollama ONLY
    // when it's provably reachable (detectOllama), never blindly — see
    // resolveLocalOnlyAskProvider. Tests that want the Ollama-fallback path
    // set this true; the default (false) proves the honest "still setting
    // up" failure instead of a guaranteed-broken OllamaProvider.
    ollamaReachable: false,
    keys: {
      anthropic: 'sk-ant-test' as string | null,
      openai: null as string | null,
      google: null as string | null,
    },
  };
});

vi.mock('@/platform/hooks/useConfidentialityMode', () => ({
  getConfidentialityMode: () => h.mode,
}));

// The personal-install choice gate (Task 1.3) reads firmStore + settingsStore.
// Stub both so assertCloudGenerationAllowed is a no-op here — these tests focus
// on local-only enforcement, not on the confidentiality-choice gate itself.
vi.mock('@/platform/firm/firmStore', () => ({
  useFirmStore: { getState: () => ({ session: { activated: true } }) },
}));
vi.mock('@/platform/settings/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      getSetting: (key: string) => {
        if (key === 'defaultProvider') return h.defaultProvider;
        if (key === 'defaultModel') return h.defaultModel;
        return true;
      },
    }),
  },
}));

// Stub providers so buildProviderAsync constructs identifiable instances.
vi.mock('@/platform/providers/ClaudeProvider', () => ({
  ClaudeProvider: class {
    kind = 'anthropic';
    model: string | undefined;
    constructor(config: { model?: string }) { this.model = config.model; }
    getMetadata() { return { model: this.model ?? 'claude-test' }; }
  },
}));
vi.mock('@/platform/providers/OpenAIProvider', () => ({
  OpenAIProvider: class {
    kind = 'openai';
    model: string | undefined;
    constructor(config: { model?: string }) { this.model = config.model; }
    getMetadata() { return { model: this.model ?? 'openai-test' }; }
  },
}));
vi.mock('@/platform/providers/GeminiProvider', () => ({
  GeminiProvider: class {
    kind = 'google';
    model: string | undefined;
    constructor(config: { model?: string }) { this.model = config.model; }
    getMetadata() { return { model: this.model ?? 'gemini-test' }; }
  },
}));
vi.mock('@/platform/providers/OllamaProvider', () => ({
  OllamaProvider: class {
    kind = 'ollama';
    getMetadata() { return { model: 'ollama-test' }; }
  },
  // Fix 2: resolveAvailableLocalGenerationProvider only falls back to Ollama
  // when it's provably reachable — drive that via h.ollamaReachable.
  detectOllama: () => Promise.resolve({ reachable: h.ollamaReachable, models: [] }),
}));
vi.mock('@/platform/providers/AppLocalProvider', () => ({
  AppLocalProvider: class {
    kind = 'lantern-local';
    getMetadata() { return { model: 'qwen3-4b' }; }
  },
}));
// Drive local_llm_model_status() per-test; keep every other tauri-command real.
vi.mock('@/platform/utils/tauri-commands', async (orig) => {
  const actual = await orig<typeof import('@/platform/utils/tauri-commands')>();
  return {
    ...actual,
    localLlmModelStatus: vi.fn(async () => h.localStatus),
  };
});
vi.mock('@/platform/providers/KeychainService', () => ({
  // Always has an Anthropic cloud key available.
  KeychainService: vi.fn().mockImplementation(function () {
    return {
      getKey: (p: string) =>
        Promise.resolve(h.keys[p as keyof typeof h.keys] ?? null),
      // Read-only presence check — the pre-send badge uses this (never getKey)
      // so it can't stamp 'last used' from a display-only effect.
      hasKey: (p: string) =>
        Promise.resolve(Boolean(h.keys[p as keyof typeof h.keys]?.trim())),
    };
  }),
}));

import {
  assertLocalOnlyAllowsSend,
  isLocalOnlyMode,
  LocalOnlyEgressError,
} from '@/platform/privacy/localOnlyGuard';
import {
  buildProviderAsync,
  buildResolvedAskProvider,
  resolveActiveAskProviderId,
} from '@/features/ask/askHelpers';

describe('localOnlyGuard (A1)', () => {
  beforeEach(() => {
    h.mode = 'direct';
    h.defaultProvider = '';
    h.defaultModel = '';
    h.localStatus = 'absent';
    h.keys = { anthropic: 'sk-ant-test', openai: null, google: null };
    localStorage.clear();
  });

  it('isLocalOnlyMode reflects the confidentiality mode', () => {
    h.mode = 'local-only';
    expect(isLocalOnlyMode()).toBe(true);
    h.mode = 'direct';
    expect(isLocalOnlyMode()).toBe(false);
  });

  it('blocks a cloud send in local-only mode', () => {
    h.mode = 'local-only';
    expect(() => assertLocalOnlyAllowsSend('openai')).toThrow(LocalOnlyEgressError);
    expect(() => assertLocalOnlyAllowsSend('anthropic')).toThrow(/Local-only/i);
    expect(() => assertLocalOnlyAllowsSend('google')).toThrow(LocalOnlyEgressError);
  });

  it('allows a local (ollama) send in local-only mode', () => {
    h.mode = 'local-only';
    expect(() => assertLocalOnlyAllowsSend('ollama')).not.toThrow();
  });

  it('allows the embedded Lantern Local AI send in local-only mode', () => {
    h.mode = 'local-only';
    expect(() => assertLocalOnlyAllowsSend('lantern-local')).not.toThrow();
  });

  it('allows cloud sends when NOT in local-only mode', () => {
    h.mode = 'direct';
    expect(() => assertLocalOnlyAllowsSend('openai')).not.toThrow();
    h.mode = 'assured';
    expect(() => assertLocalOnlyAllowsSend('anthropic')).not.toThrow();
  });
});

describe('Ask buildProviderAsync honours local-only (A1)', () => {
  beforeEach(() => {
    h.mode = 'direct';
    h.defaultProvider = '';
    h.defaultModel = '';
    h.localStatus = 'absent';
    h.ollamaReachable = false;
    h.keys = { anthropic: 'sk-ant-test', openai: null, google: null };
    localStorage.clear();
  });

  it('returns the LOCAL provider in local-only mode even when a cloud key exists', async () => {
    h.mode = 'local-only';
    h.ollamaReachable = true;
    const provider = (await buildProviderAsync()) as unknown as { kind: string };
    expect(provider.kind).toBe('ollama');
  });

  it('prefers the EMBEDDED Lantern Local AI in local-only mode when the model is ready', async () => {
    // The live Windows-bench gap: a fresh install with the embedded model ready
    // must use it for Ask/Search, NOT route to an external Ollama that is not
    // installed (which failed with "I couldn't reach your AI provider").
    h.mode = 'local-only';
    h.localStatus = 'ready';
    const resolved = await buildResolvedAskProvider();
    expect(resolved.providerId).toBe('lantern-local');
    expect((resolved.provider as unknown as { kind: string }).kind).toBe('lantern-local');
  });

  it('falls back to Ollama in local-only mode ONLY when the embedded model is absent AND Ollama is provably reachable', async () => {
    h.mode = 'local-only';
    h.ollamaReachable = true;
    h.localStatus = 'absent';
    const resolved = await buildResolvedAskProvider();
    expect(resolved.providerId).toBe('ollama');
  });

  /**
   * Fix 2 (demo readiness) — the bug this test guards against: a fresh
   * install with the embedded model still downloading and NO Ollama running
   * used to silently construct an OllamaProvider anyway, guaranteeing a
   * confusing failure deep inside the send. It must instead fail honestly,
   * up front, with actionable copy — never a broken provider.
   */
  it('throws an honest "still setting up" error in local-only mode when neither the embedded model nor Ollama is available', async () => {
    h.mode = 'local-only';
    h.localStatus = 'absent';
    h.ollamaReachable = false;
    await expect(buildResolvedAskProvider()).rejects.toThrow(
      /Advisor Prep Hero Local AI is still downloading or setting up/,
    );
  });

  it('prefers the embedded model on a personal install with no cloud key (not local-only)', async () => {
    // The no-cloud-key fallback path must prefer the on-device model too.
    h.mode = 'direct';
    h.keys = { anthropic: null, openai: null, google: null };
    h.localStatus = 'ready';
    const resolved = await buildResolvedAskProvider();
    expect(resolved.providerId).toBe('lantern-local');
  });

  it('uses the cloud provider (key present) when not in local-only mode', async () => {
    h.mode = 'direct';
    const provider = (await buildProviderAsync()) as unknown as { kind: string };
    expect(provider.kind).toBe('anthropic');
  });

  it('honors the OpenAI default provider and model instead of Anthropic key order', async () => {
    h.mode = 'direct';
    h.defaultProvider = 'openai';
    h.defaultModel = 'gpt-4o';
    h.keys = { anthropic: 'stale-anthropic', openai: 'valid-openai', google: null };

    const provider = (await buildProviderAsync()) as unknown as {
      kind: string;
      model: string | undefined;
    };

    expect(provider.kind).toBe('openai');
    expect(provider.model).toBe('gpt-4o');
  });
});

// The pre-send egress badge derives its NAME from resolveActiveAskProviderId,
// which must name the SAME engine the send will use (no construction / no gate).
describe('resolveActiveAskProviderId names the real send engine (pre-send badge)', () => {
  beforeEach(() => {
    h.mode = 'direct';
    h.defaultProvider = '';
    h.defaultModel = '';
    h.localStatus = 'absent';
    h.keys = { anthropic: 'sk-ant-test', openai: null, google: null };
    localStorage.clear();
  });

  it('names the embedded model in local-only mode when ready (not a generic Ollama)', async () => {
    h.mode = 'local-only';
    h.localStatus = 'ready';
    expect(await resolveActiveAskProviderId()).toBe('lantern-local');
  });

  it('names Ollama in local-only mode when the embedded model is absent but Ollama is reachable', async () => {
    h.mode = 'local-only';
    h.localStatus = 'absent';
    h.ollamaReachable = true;
    expect(await resolveActiveAskProviderId()).toBe('ollama');
  });

  it('is "local-pending" (setting up) in local-only mode when NEITHER the embedded model nor Ollama is usable — never a false "ollama"', async () => {
    h.mode = 'local-only';
    h.localStatus = 'absent';
    h.ollamaReachable = false;
    expect(await resolveActiveAskProviderId()).toBe('local-pending');
  });

  it('names the cloud provider when a key exists and not local-only', async () => {
    h.mode = 'direct';
    expect(await resolveActiveAskProviderId()).toBe('anthropic');
  });

  it('names the SELECTED default cloud provider, not just the first key (anthropic+openai, default=openai)', async () => {
    // Codex catch: the badge must route through the same resolvePreferredCloudProvider
    // path as the send, so the user's chosen default wins over fixed key order.
    h.mode = 'direct';
    h.defaultProvider = 'openai';
    h.keys = { anthropic: 'sk-ant-test', openai: 'sk-openai-test', google: null };
    expect(await resolveActiveAskProviderId()).toBe('openai');
  });

  it('names the embedded model on a personal install with no cloud key when ready', async () => {
    h.mode = 'direct';
    h.keys = { anthropic: null, openai: null, google: null };
    h.localStatus = 'ready';
    expect(await resolveActiveAskProviderId()).toBe('lantern-local');
  });
});
