/**
 * A1 (Codex QA, blocker): Local-only confidentiality mode must be ENFORCED at
 * the AI send points, not just shown in the indicator. Two paths bypassed it:
 *   - chat send (routes by the chat's stored provider) — now guarded.
 *   - Ask (buildProviderAsync, routes by key presence) — now forces Ollama.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ mode: 'direct' as string }));

vi.mock('@/platform/hooks/useConfidentialityMode', () => ({
  getConfidentialityMode: () => h.mode,
}));

// Stub providers so buildProviderAsync constructs identifiable instances.
vi.mock('@/platform/providers/ClaudeProvider', () => ({ ClaudeProvider: class { kind = 'anthropic'; } }));
vi.mock('@/platform/providers/OpenAIProvider', () => ({ OpenAIProvider: class { kind = 'openai'; } }));
vi.mock('@/platform/providers/GeminiProvider', () => ({ GeminiProvider: class { kind = 'google'; } }));
vi.mock('@/platform/providers/OllamaProvider', () => ({ OllamaProvider: class { kind = 'ollama'; } }));
vi.mock('@/platform/providers/KeychainService', () => ({
  // Always has an Anthropic cloud key available.
  KeychainService: vi.fn().mockImplementation(function () {
    return { getKey: (p: string) => Promise.resolve(p === 'anthropic' ? 'sk-ant-test' : null) };
  }),
}));

import {
  assertLocalOnlyAllowsSend,
  isLocalOnlyMode,
  LocalOnlyEgressError,
} from '@/platform/privacy/localOnlyGuard';
import { buildProviderAsync } from '@/features/ask/askHelpers';

describe('localOnlyGuard (A1)', () => {
  beforeEach(() => {
    h.mode = 'direct';
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
  });

  it('returns the LOCAL provider in local-only mode even when a cloud key exists', async () => {
    h.mode = 'local-only';
    const provider = (await buildProviderAsync()) as unknown as { kind: string };
    expect(provider.kind).toBe('ollama');
  });

  it('uses the cloud provider (key present) when not in local-only mode', async () => {
    h.mode = 'direct';
    const provider = (await buildProviderAsync()) as unknown as { kind: string };
    expect(provider.kind).toBe('anthropic');
  });
});
