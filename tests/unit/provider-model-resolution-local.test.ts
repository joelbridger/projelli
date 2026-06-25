/**
 * providerModelResolution — Keepance Local AI ('keepance-local') additions.
 *
 * The embedded engine serves whichever GGUF is loaded, so its model id is
 * cosmetic. Like ollama it carries no fallback model: the picker offers it as a
 * selectable provider with a "Default model" entry and the provider then uses
 * its own KEEPANCE_LOCAL_DEFAULT_MODEL. These tests lock that contract.
 */

import { describe, expect, it } from 'vitest';
import {
  FALLBACK_MODEL,
  resolveModelsForProvider,
  resolveModelForProvider,
  effectiveChatProvider,
  type ChatProvider,
} from '@/features/ask/chat/providerModelResolution';

describe('effectiveChatProvider — the privacy-badge fallback fix', () => {
  it('returns the saved provider verbatim when one is set', () => {
    expect(effectiveChatProvider('openai', true)).toBe('openai');
    expect(effectiveChatProvider('openai', false)).toBe('openai');
    expect(effectiveChatProvider('keepance-local', false)).toBe('keepance-local');
  });

  it("an UNSET chat resolves to 'keepance-local' when the embedded model is ready (NEVER a cloud fallback)", () => {
    // BLOCKER regression: this is the unset-provider state that made the egress
    // badge falsely claim "data leaves" for an on-device chat.
    expect(effectiveChatProvider(undefined, true)).toBe('keepance-local');
    expect(effectiveChatProvider(undefined, true)).not.toBe('anthropic');
  });

  it("an UNSET chat falls back to 'anthropic' only when no local model is available", () => {
    expect(effectiveChatProvider(undefined, false)).toBe('anthropic');
  });
});

describe("providerModelResolution — 'keepance-local'", () => {
  it('is part of the ChatProvider union (assignable)', () => {
    const p: ChatProvider = 'keepance-local';
    expect(p).toBe('keepance-local');
  });

  it('has an empty fallback model (model id is cosmetic, like ollama)', () => {
    expect(FALLBACK_MODEL['keepance-local']).toBe('');
  });

  it('offers no concrete model list (so the picker shows a Default model)', () => {
    expect(resolveModelsForProvider('keepance-local')).toEqual([]);
  });

  it('resolves to an empty model, letting the provider use its own default', () => {
    expect(resolveModelForProvider('keepance-local')).toBe('');
    // A preferred model that does not exist for this provider is ignored.
    expect(resolveModelForProvider('keepance-local', 'qwen3-4b-instruct-2507')).toBe('');
  });
});
