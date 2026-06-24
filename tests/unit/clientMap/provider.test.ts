// tests/unit/clientMap/provider.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const cmode = vi.hoisted(() => ({
  mode: 'direct' as string,
  keys: {
    anthropic: 'test-key' as string | null,
    openai: null as string | null,
    google: null as string | null,
  },
}));
vi.mock('@/platform/hooks/useConfidentialityMode', () => ({
  getConfidentialityMode: () => cmode.mode,
}));
vi.mock('@/platform/privacy/localOnlyGuard', async (orig) => {
  const real = await orig<typeof import('@/platform/privacy/localOnlyGuard')>();
  return { ...real, assertCloudGenerationAllowed: vi.fn() };
});
vi.mock('@/platform/providers/KeychainService', () => ({
  KeychainService: class {
    async getKey(provider: string) {
      return cmode.keys[provider as keyof typeof cmode.keys] ?? null;
    }
  },
}));
vi.mock('@/platform/providers/ClaudeProvider', () => ({
  ClaudeProvider: class {
    private readonly model: string | undefined;
    constructor(config: { model?: string }) { this.model = config.model; }
    getMetadata() { return { model: this.model ?? 'claude-default' }; }
  },
}));
vi.mock('@/platform/providers/OpenAIProvider', () => ({
  OpenAIProvider: class {
    private readonly model: string | undefined;
    constructor(config: { model?: string }) { this.model = config.model; }
    getMetadata() { return { model: this.model ?? 'openai-default' }; }
  },
}));
vi.mock('@/platform/providers/GeminiProvider', () => ({
  GeminiProvider: class {
    private readonly model: string | undefined;
    constructor(config: { model?: string }) { this.model = config.model; }
    getMetadata() { return { model: this.model ?? 'gemini-default' }; }
  },
}));
vi.mock('@/platform/providers/OllamaProvider', () => ({ OllamaProvider: class { getMetadata() { return { model: 'llama3' }; } } }));

import { buildProviderForClientMap, hasCloudKeyForClientMap } from '@/platform/clientMap/provider';

beforeEach(() => {
  cmode.mode = 'direct';
  cmode.keys = { anthropic: 'test-key', openai: null, google: null };
  localStorage.clear();
});

describe('clientMap/provider', () => {
  it('uses the cloud provider when a key exists and a choice was made', async () => {
    const p = await buildProviderForClientMap();
    expect(p.getMetadata().model).toBe('claude-sonnet-4-6');
  });
  it('honors the OpenAI default provider and model instead of Anthropic key order', async () => {
    cmode.keys = { anthropic: 'stale-anthropic', openai: 'valid-openai', google: null };
    localStorage.setItem('keepance_default_provider', 'openai');
    localStorage.setItem('keepance_default_model', 'gpt-4o');

    const p = await buildProviderForClientMap();

    expect(p.getMetadata().model).toBe('gpt-4o');
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
