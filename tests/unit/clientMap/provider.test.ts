// tests/unit/clientMap/provider.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const cmode = vi.hoisted(() => ({ mode: 'direct' as string }));
vi.mock('@/platform/hooks/useConfidentialityMode', () => ({
  getConfidentialityMode: () => cmode.mode,
}));
vi.mock('@/platform/privacy/localOnlyGuard', async (orig) => {
  const real = await orig<typeof import('@/platform/privacy/localOnlyGuard')>();
  return { ...real, assertCloudGenerationAllowed: vi.fn() };
});
vi.mock('@/platform/providers/KeychainService', () => ({
  KeychainService: class {
    async getKey(provider: string) { return provider === 'anthropic' ? 'test-key' : null; }
  },
}));
vi.mock('@/platform/providers/ClaudeProvider', () => ({
  ClaudeProvider: class { getMetadata() { return { model: 'claude-3-haiku-20240307' }; } },
}));
vi.mock('@/platform/providers/OpenAIProvider', () => ({ OpenAIProvider: class { getMetadata() { return { model: 'gpt-4o' }; } } }));
vi.mock('@/platform/providers/GeminiProvider', () => ({ GeminiProvider: class { getMetadata() { return { model: 'gemini' }; } } }));
vi.mock('@/platform/providers/OllamaProvider', () => ({ OllamaProvider: class { getMetadata() { return { model: 'llama3' }; } } }));

import { buildProviderForClientMap, hasCloudKeyForClientMap } from '@/platform/clientMap/provider';

beforeEach(() => { cmode.mode = 'direct'; });

describe('clientMap/provider', () => {
  it('uses the cloud provider when a key exists and a choice was made', async () => {
    const p = await buildProviderForClientMap();
    expect(p.getMetadata().model).toBe('claude-3-haiku-20240307');
  });
  it('forces the on-device model in Local-only mode (never egresses)', async () => {
    cmode.mode = 'local-only';
    const p = await buildProviderForClientMap();
    expect(p.getMetadata().model).toBe('llama3');
  });
  it('reports a cloud key is present', async () => {
    expect(await hasCloudKeyForClientMap()).toBe(true);
  });
});
