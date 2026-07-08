/**
 * resolveEmailProvider — "Draft with AI" provider resolution.
 *
 * Fix round 2:
 *   - item 1 (email side of the ruling): email PREFERS the firm Assured route
 *     over personal BYOK, so its action-time trust note reflects assured. The
 *     GLOBAL top-bar badge does NOT (it mirrors Ask/Workflows) — proven in
 *     single-source-egress.test.ts.
 *   - item 4: the local fallback uses the SAME STRICT reachability probe as Ask /
 *     the badge (`resolveAvailableLocalGenerationProvider`) and fails fast with an
 *     honest message instead of building a guaranteed-broken Ollama provider.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  mode: 'direct' as string,
  assuredProviders: [] as string[],
  keys: { anthropic: null as string | null, openai: null as string | null, google: null as string | null },
  localAvailable: null as { providerId: 'lantern-local' | 'ollama' } | null,
}));

vi.mock('@/platform/privacy/localOnlyGuard', () => ({
  isLocalOnlyMode: () => h.mode === 'local-only',
  assertCloudGenerationAllowed: () => {},
  assertLocalOnlyAllowsSend: () => {},
}));
vi.mock('@/platform/firm/resolveAssuredRoute', () => ({
  resolveAssuredRoute: (provider: string, model: string, stream = false) =>
    h.mode === 'assured' && h.assuredProviders.includes(provider)
      ? { provider, model, accessToken: 'a', seatToken: 's', stream }
      : undefined,
}));
vi.mock('@/platform/providers/KeychainService', () => ({
  createKeychainService: () => ({
    getKey: (p: string) => Promise.resolve(h.keys[p as keyof typeof h.keys] ?? null),
  }),
}));
vi.mock('@/platform/providers/providerFactory', () => ({
  createProvider: (opts: { provider: string; model?: string }) => ({
    getMetadata: () => ({ model: opts.model ?? `${opts.provider}-default` }),
  }),
}));
vi.mock('@/platform/providers/OpenAIProvider', () => ({ OPENAI_DEFAULT_MODEL: 'gpt-4o' }));
vi.mock('@/platform/providers/resolveLocalProvider', () => ({
  resolveAvailableLocalGenerationProvider: async () =>
    h.localAvailable
      ? { provider: { getMetadata: () => ({ model: 'local' }) }, providerId: h.localAvailable.providerId, model: 'local' }
      : null,
}));

import {
  resolveEmailProvider,
  EMAIL_LOCAL_AI_NOT_READY_MESSAGE,
  EMAIL_NO_PROVIDER_MESSAGE,
} from '@/features/email/resolveEmailProvider';

beforeEach(() => {
  h.mode = 'direct';
  h.assuredProviders = [];
  h.keys = { anthropic: null, openai: null, google: null };
  h.localAvailable = null;
});

describe('item 1 — email prefers the firm Assured route over personal BYOK', () => {
  it('assured mode + a firm managed OpenAI route + a leftover personal Anthropic key → assured OpenAI', async () => {
    h.mode = 'assured';
    h.assuredProviders = ['openai'];
    h.keys = { anthropic: 'sk-ant-leftover', openai: null, google: null };
    const resolved = await resolveEmailProvider();
    expect(resolved.providerId).toBe('openai');
    expect(resolved.assuredAvailable).toBe(true);
  });

  it('direct mode + a personal key → BYOK, assuredAvailable false', async () => {
    h.keys.anthropic = 'sk-ant';
    const resolved = await resolveEmailProvider();
    expect(resolved.providerId).toBe('anthropic');
    expect(resolved.assuredAvailable).toBe(false);
  });
});

describe('item 4 — the local fallback uses the strict reachability probe', () => {
  it('local-only with a usable engine → that engine', async () => {
    h.mode = 'local-only';
    h.localAvailable = { providerId: 'lantern-local' };
    const resolved = await resolveEmailProvider();
    expect(resolved.providerId).toBe('lantern-local');
  });

  it('local-only with NO usable engine → throws the honest "setting up" message, not a broken Ollama', async () => {
    h.mode = 'local-only';
    h.localAvailable = null;
    await expect(resolveEmailProvider()).rejects.toThrow(EMAIL_LOCAL_AI_NOT_READY_MESSAGE);
  });

  it('no cloud key and no reachable local engine → throws the honest "no provider" message', async () => {
    h.mode = 'direct';
    h.keys = { anthropic: null, openai: null, google: null };
    h.localAvailable = null;
    await expect(resolveEmailProvider()).rejects.toThrow(EMAIL_NO_PROVIDER_MESSAGE);
  });

  it('no cloud key but a reachable local engine → that engine (no throw)', async () => {
    h.mode = 'direct';
    h.localAvailable = { providerId: 'ollama' };
    const resolved = await resolveEmailProvider();
    expect(resolved.providerId).toBe('ollama');
  });
});
