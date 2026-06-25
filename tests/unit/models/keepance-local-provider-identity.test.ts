/**
 * Local-model initiative — Ticket 1 (provider identity).
 *
 * Proves the embedded "Keepance Local AI" engine ('keepance-local') is wired
 * into the provider type system AS A LOCAL PROVIDER before its implementation
 * lands (the Rust bridge + KeepanceLocalProvider arrive in a later ticket).
 * Until then `createProvider` must fail LOUDLY for it rather than silently
 * falling back to a cloud branch.
 */

import { describe, it, expect } from 'vitest';
import {
  isLocalProviderId,
  createProvider,
  KEEPANCE_LOCAL_DEFAULT_MODEL,
} from '@/platform/providers/providerFactory';

describe('keepance-local provider identity (Ticket 1)', () => {
  it('is recognised as a LOCAL provider', () => {
    expect(isLocalProviderId('keepance-local')).toBe(true);
  });

  it('does not regress the other local/cloud classifications', () => {
    expect(isLocalProviderId('ollama')).toBe(true);
    expect(isLocalProviderId('anthropic')).toBe(false);
    expect(isLocalProviderId('openai')).toBe(false);
    expect(isLocalProviderId('google')).toBe(false);
  });

  it('exposes the embedded engine default model', () => {
    expect(KEEPANCE_LOCAL_DEFAULT_MODEL).toBe('qwen3-4b-instruct-2507');
  });

  it('createProvider fails loudly (never silently cloud-falls-back) until the engine ships', () => {
    expect(() => createProvider({ provider: 'keepance-local' })).toThrow(/being wired up|not available/i);
  });
});
