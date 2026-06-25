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
  type ChatProvider,
} from '@/features/ask/chat/providerModelResolution';

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
