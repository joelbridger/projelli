// BUG-012 — resolveInlineEditProvider: the markdown/text inline "Ask AI" edit
// provider resolution.
//
// MainPanel rendered <MarkdownEditor> WITHOUT a getAiProvider prop, so
// useInlineAiEdit.getProvider() always returned null and the inline "Ask AI"
// edit silently did nothing for EVERY user (worse than BUG-009, which only hit
// non-Anthropic users). This resolver turns the already-resolved provider id
// (from resolveRedlineProvider — same source the trust bar / redline use) plus
// the user's keys into a concrete Provider, or null when there is no usable key
// (so the surface degrades cleanly instead of constructing a keyless cloud
// provider that would 401 mid-stream).

import { describe, it, expect, vi } from 'vitest';
import { resolveInlineEditProvider } from '@/app/shell/layout/resolveInlineEditProvider';

// The personal-install choice gate (Task 1.3) lives in localOnlyGuard.
// Stub assertCloudGenerationAllowed as a no-op here — these tests focus on
// provider-key resolution logic (BUG-012), not the confidentiality gate.
vi.mock('@/platform/privacy/localOnlyGuard', async (orig) => {
  const real = await orig<typeof import('@/platform/privacy/localOnlyGuard')>();
  return {
    ...real,
    assertCloudGenerationAllowed: vi.fn(),
  };
});

const key = (provider: string, isValid: boolean) => ({ provider, key: 'sk-real', isValid });

describe('resolveInlineEditProvider (BUG-012)', () => {
  it('builds a streaming-capable provider when a valid cloud key exists (the original bug)', () => {
    const p = resolveInlineEditProvider({
      provider: 'openai',
      apiKeys: [key('openai', true)],
    });
    expect(p).not.toBeNull();
    expect(typeof p?.sendMessageStreaming).toBe('function');
    expect(p?.getMetadata().name).toMatch(/OpenAI/i);
  });

  it('returns null when the resolved cloud provider has NO valid key (clean no-op, not a keyless 401)', () => {
    expect(
      resolveInlineEditProvider({
        provider: 'openai',
        apiKeys: [key('openai', false)],
      }),
    ).toBeNull();
    expect(
      resolveInlineEditProvider({
        provider: 'anthropic',
        apiKeys: [],
      }),
    ).toBeNull();
  });

  it('uses the key that matches the resolved provider, not just any key', () => {
    const p = resolveInlineEditProvider({
      provider: 'openai',
      apiKeys: [key('anthropic', true), key('openai', true)],
    });
    expect(p?.getMetadata().name).toMatch(/OpenAI/i);
  });

  it('builds the local (ollama) provider with no key in Local-only mode', () => {
    const p = resolveInlineEditProvider({
      provider: 'ollama',
      apiKeys: [],
    });
    expect(p).not.toBeNull();
    expect(typeof p?.sendMessageStreaming).toBe('function');
  });

  it('threads a model override through to the provider when given', () => {
    const p = resolveInlineEditProvider({
      provider: 'openai',
      apiKeys: [key('openai', true)],
      model: 'gpt-4o-mini',
    });
    expect(p?.getMetadata().model).toBe('gpt-4o-mini');
  });
});
