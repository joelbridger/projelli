/**
 * F1 — single-source egress. The top-bar TrustBar (via
 * `resolveActiveEgressProvider`) and Ask's pre-send banner (via
 * `resolveActiveAskProviderId`) used to compute the egress destination
 * INDEPENDENTLY and could contradict each other on ONE screen. They now resolve
 * through THE SAME source of truth (activeEgressProvider.ts).
 *
 * Fix round 1 widened the matrix to the columns the badge must never get wrong:
 * assured (fix round 2 ruling: the GLOBAL badge is BYOK-first, mirroring what Ask/Workflows actually send; email stays assured-honest at action time) and local-pending ("setting up", never a
 * false "Using local AI").
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  mode: 'direct' as string,
  localStatus: 'absent' as string,
  ollamaReachable: false,
  assuredProviders: [] as string[],
  keys: {
    anthropic: null as string | null,
    openai: null as string | null,
    google: null as string | null,
  },
}));

vi.mock('@/platform/hooks/useConfidentialityMode', () => ({
  getConfidentialityMode: () => h.mode,
}));

vi.mock('@/platform/settings/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ getSetting: () => '' }),
  },
}));

vi.mock('@/platform/providers/keyVerification', () => ({
  getVerifiedProviders: () => new Set<string>(),
  getInvalidProviders: () => new Set<string>(),
}));

// Assured route: available only for providers the firm has "managed keys" for,
// and only in assured mode (mirrors the real resolveAssuredRoute policy).
vi.mock('@/platform/firm/resolveAssuredRoute', () => ({
  resolveAssuredRoute: (provider: string, model: string, stream = true) =>
    h.mode === 'assured' && h.assuredProviders.includes(provider)
      ? { provider, model, accessToken: 'a', seatToken: 's', stream }
      : undefined,
}));

vi.mock('@/platform/providers/OllamaProvider', () => ({
  detectOllama: vi.fn(async () => ({ reachable: h.ollamaReachable, models: [] })),
  OllamaProvider: class {
    getMetadata() {
      return { model: 'ollama-test' };
    }
  },
}));

vi.mock('@/platform/providers/AppLocalProvider', () => ({
  AppLocalProvider: class {
    getMetadata() {
      return { model: 'lantern-local-test' };
    }
  },
}));

vi.mock('@/platform/utils/tauri-commands', async (orig) => {
  const actual = await orig<typeof import('@/platform/utils/tauri-commands')>();
  return { ...actual, localLlmModelStatus: vi.fn(async () => h.localStatus) };
});

vi.mock('@/platform/providers/KeychainService', () => ({
  KeychainService: vi.fn().mockImplementation(function () {
    return {
      getKey: (p: string) =>
        Promise.resolve(h.keys[p as keyof typeof h.keys] ?? null),
      hasKey: (p: string) =>
        Promise.resolve(Boolean(h.keys[p as keyof typeof h.keys]?.trim())),
      getStoredKeys: () =>
        (['anthropic', 'openai', 'google'] as const)
          .filter((p) => h.keys[p]?.trim())
          .map((provider) => ({ provider })),
    };
  }),
}));

import {
  pickEgressDestination,
  resolveActiveEgressDestination,
  resolveActiveEgressProviderId,
  toRealProviderId,
} from '@/platform/privacy/activeEgressProvider';
import { resolveActiveEgressProvider } from '@/platform/hooks/useActiveEgressProvider';
import { resolveActiveAskProviderId } from '@/features/ask/askHelpers';

beforeEach(() => {
  h.mode = 'direct';
  h.localStatus = 'absent';
  h.ollamaReachable = false;
  h.assuredProviders = [];
  h.keys = { anthropic: null, openai: null, google: null };
  localStorage.clear();
});

describe('pickEgressDestination — the pure decision core', () => {
  const base = {
    localOnly: false,
    isDemo: false,
    assuredProvider: null,
    cloudProvider: null,
    localOnlyEngineId: null,
    availableLocalEngineId: null,
  } as const;

  it('local-only with a usable engine names that engine, nothing leaves', () => {
    expect(pickEgressDestination({ ...base, localOnly: true, localOnlyEngineId: 'lantern-local' })).toEqual({
      providerId: 'lantern-local',
      assuredAvailable: false,
    });
  });

  it('local-only with NO usable engine is "local-pending" (setting up), never a cloud key', () => {
    expect(pickEgressDestination({ ...base, localOnly: true, cloudProvider: 'anthropic', localOnlyEngineId: null })).toEqual({
      providerId: 'local-pending',
      assuredAvailable: false,
    });
  });

  it('demo forwards to anthropic', () => {
    expect(pickEgressDestination({ ...base, isDemo: true })).toEqual({ providerId: 'anthropic', assuredAvailable: false });
  });

  it('an assured route WINS over a personal BYOK key', () => {
    expect(pickEgressDestination({ ...base, assuredProvider: 'openai', cloudProvider: 'anthropic' })).toEqual({
      providerId: 'openai',
      assuredAvailable: true,
    });
  });

  it('a usable cloud key wins over a local fallback', () => {
    expect(pickEgressDestination({ ...base, cloudProvider: 'openai', availableLocalEngineId: 'lantern-local' })).toEqual({
      providerId: 'openai',
      assuredAvailable: false,
    });
  });

  it('no cloud key but a ready local engine names that engine (the F1 fix)', () => {
    expect(pickEgressDestination({ ...base, availableLocalEngineId: 'lantern-local' })).toEqual({
      providerId: 'lantern-local',
      assuredAvailable: false,
    });
  });

  it('nothing configured is the none sentinel', () => {
    expect(pickEgressDestination(base)).toEqual({ providerId: 'none', assuredAvailable: false });
  });
});

describe('the two render paths resolve identically (single source)', () => {
  it('F1 scenario: no cloud key + embedded local ready — BOTH name the local engine', async () => {
    h.localStatus = 'ready';
    const topBar = await resolveActiveEgressProvider('direct');
    const askBanner = await resolveActiveAskProviderId();
    expect(topBar).toBe('lantern-local');
    expect(askBanner).toBe('lantern-local');
  });

  it('a cloud key resolves to the same cloud provider on both paths', async () => {
    h.keys.openai = 'sk-test-openai';
    expect(await resolveActiveEgressProvider('direct')).toBe('openai');
    expect(await resolveActiveAskProviderId()).toBe('openai');
  });

  it('no key and no reachable local engine is "none" on both paths', async () => {
    expect(await resolveActiveEgressProvider('direct')).toBe('none');
    expect(await resolveActiveAskProviderId()).toBe('none');
  });

  it('local-only with no usable engine is "local-pending" on both paths (never a false local)', async () => {
    h.mode = 'local-only';
    h.localStatus = 'absent';
    h.ollamaReachable = false;
    expect(await resolveActiveEgressProvider('local-only')).toBe('local-pending');
    expect(await resolveActiveAskProviderId()).toBe('local-pending');
  });

  it('local-only with a reachable engine names it on both paths', async () => {
    h.mode = 'local-only';
    h.localStatus = 'ready';
    expect(await resolveActiveEgressProvider('local-only')).toBe('lantern-local');
    expect(await resolveActiveAskProviderId()).toBe('lantern-local');
  });

  it('assured mode + a personal key → global badge = the firm assured provider, not the BYOK key', async () => {
    h.mode = 'assured';
    h.assuredProviders = ['openai'];
    h.keys = { anthropic: 'sk-ant', openai: null, google: null };
    expect(await resolveActiveEgressProvider('assured')).toBe('openai');
    expect(await resolveActiveAskProviderId()).toBe('openai');
    await expect(resolveActiveEgressDestination('assured')).resolves.toEqual({
      providerId: 'openai',
      assuredAvailable: true,
    });
  });

  it('assured mode + NO personal key → global badge still names the firm assured provider', async () => {
    h.mode = 'assured';
    h.assuredProviders = ['openai'];
    h.keys = { anthropic: null, openai: null, google: null };
    expect(await resolveActiveEgressProvider('assured')).toBe('openai');
    expect(await resolveActiveAskProviderId()).toBe('openai');
    await expect(resolveActiveEgressDestination('assured')).resolves.toEqual({
      providerId: 'openai',
      assuredAvailable: true,
    });
  });
});

describe('the destination carries assuredAvailable for the badge', () => {
  it('resolveActiveEgressProviderId is the shared engine both delegate to', async () => {
    h.keys.anthropic = 'sk-ant-test';
    expect(await resolveActiveEgressProviderId('direct')).toBe('anthropic');
    expect(await resolveActiveEgressProvider('direct')).toBe('anthropic');
    expect(await resolveActiveAskProviderId()).toBe('anthropic');
  });
});

describe('toRealProviderId — badge sentinels never leak into provider code (item 2)', () => {
  it('passes real provider ids through unchanged', () => {
    expect(toRealProviderId('anthropic')).toBe('anthropic');
    expect(toRealProviderId('ollama')).toBe('ollama');
    expect(toRealProviderId('lantern-local')).toBe('lantern-local');
  });

  it('maps every badge sentinel (and null) to null', () => {
    expect(toRealProviderId('none')).toBeNull();
    expect(toRealProviderId('local-pending')).toBeNull();
    expect(toRealProviderId(null)).toBeNull();
    expect(toRealProviderId(undefined)).toBeNull();
  });
});
