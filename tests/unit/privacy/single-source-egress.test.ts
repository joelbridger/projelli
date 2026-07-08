/**
 * F1 — single-source egress. The top-bar TrustBar (via
 * `resolveActiveEgressProvider` in useActiveEgressProvider) and Ask's pre-send
 * banner (via `resolveActiveAskProviderId` in askHelpers) used to compute the
 * egress provider INDEPENDENTLY and could contradict each other on ONE screen —
 * the top bar said "No AI connected" while Ask said "Using local AI" at the same
 * time, because only Ask fell back to the on-device engine when no cloud key was
 * present.
 *
 * These tests prove they now resolve through THE SAME source of truth
 * (activeEgressProvider.ts): identical output across the whole matrix, and in
 * particular identical output in the exact scenario that used to disagree.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  mode: 'direct' as string,
  localStatus: 'absent' as string,
  ollamaReachable: false,
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
  pickEgressProviderId,
  resolveActiveEgressProviderId,
} from '@/platform/privacy/activeEgressProvider';
import { resolveActiveEgressProvider } from '@/platform/hooks/useActiveEgressProvider';
import { resolveActiveAskProviderId } from '@/features/ask/askHelpers';

beforeEach(() => {
  h.mode = 'direct';
  h.localStatus = 'absent';
  h.ollamaReachable = false;
  h.keys = { anthropic: null, openai: null, google: null };
  localStorage.clear();
});

describe('pickEgressProviderId — the pure decision core', () => {
  const base = {
    localOnly: false,
    isDemo: false,
    cloudProvider: null,
    localOnlyEngineId: 'ollama' as const,
    availableLocalEngineId: null,
  };

  it('local-only always names the on-device engine, never a cloud key', () => {
    expect(pickEgressProviderId({ ...base, localOnly: true, cloudProvider: 'anthropic', localOnlyEngineId: 'lantern-local' })).toBe('lantern-local');
  });

  it('demo forwards to anthropic', () => {
    expect(pickEgressProviderId({ ...base, isDemo: true })).toBe('anthropic');
  });

  it('a usable cloud key wins over a local fallback', () => {
    expect(pickEgressProviderId({ ...base, cloudProvider: 'openai', availableLocalEngineId: 'lantern-local' })).toBe('openai');
  });

  it('no cloud key but a ready local engine names that engine (the F1 fix)', () => {
    expect(pickEgressProviderId({ ...base, cloudProvider: null, availableLocalEngineId: 'lantern-local' })).toBe('lantern-local');
  });

  it('nothing configured is the none sentinel', () => {
    expect(pickEgressProviderId(base)).toBe('none');
  });
});

describe('the two render paths resolve identically (single source)', () => {
  it('F1 scenario: no cloud key + embedded local ready — BOTH name the local engine (never a contradiction)', async () => {
    h.localStatus = 'ready';
    const topBar = await resolveActiveEgressProvider('direct');
    const askBanner = await resolveActiveAskProviderId();
    expect(topBar).toBe('lantern-local');
    expect(askBanner).toBe('lantern-local');
    expect(topBar).toBe(askBanner);
  });

  it('a cloud key resolves to the same cloud provider on both paths', async () => {
    h.keys.openai = 'sk-test-openai';
    const topBar = await resolveActiveEgressProvider('direct');
    const askBanner = await resolveActiveAskProviderId();
    expect(topBar).toBe('openai');
    expect(askBanner).toBe('openai');
  });

  it('no key and no reachable local engine is "none" on both paths', async () => {
    const topBar = await resolveActiveEgressProvider('direct');
    const askBanner = await resolveActiveAskProviderId();
    expect(topBar).toBe('none');
    expect(askBanner).toBe('none');
  });

  it('local-only mode names the on-device engine on both paths', async () => {
    h.mode = 'local-only';
    h.localStatus = 'ready';
    const topBar = await resolveActiveEgressProvider('local-only');
    const askBanner = await resolveActiveAskProviderId();
    expect(topBar).toBe('lantern-local');
    expect(askBanner).toBe('lantern-local');
  });

  it('resolveActiveEgressProviderId(mode) is the shared engine both delegate to', async () => {
    h.keys.anthropic = 'sk-ant-test';
    expect(await resolveActiveEgressProviderId('direct')).toBe('anthropic');
    expect(await resolveActiveEgressProvider('direct')).toBe('anthropic');
    expect(await resolveActiveAskProviderId()).toBe('anthropic');
  });
});
