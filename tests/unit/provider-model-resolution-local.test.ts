/**
 * providerModelResolution — Lantern Local AI ('lantern-local') additions.
 *
 * The embedded engine serves whichever GGUF is loaded, so its model id is
 * cosmetic. Like ollama it carries no fallback model: the picker offers it as a
 * selectable provider with a "Default model" entry and the provider then uses
 * its own LANTERN_LOCAL_DEFAULT_MODEL. These tests lock that contract.
 */

import { describe, expect, it } from 'vitest';
import {
  FALLBACK_MODEL,
  resolveModelsForProvider,
  resolveModelForProvider,
  effectiveChatProvider,
  localModelAvailability,
  type ChatProvider,
} from '@/features/ask/chat/providerModelResolution';

describe('localModelAvailability — the tri-state behind the privacy fix', () => {
  it("is 'ready' whenever the model state is ready (regardless of probe)", () => {
    expect(localModelAvailability(true, true)).toBe('ready');
    expect(localModelAvailability(true, false)).toBe('ready');
  });

  it("is 'unknown' while the initial probe has NOT resolved (not-ready + unprobed)", () => {
    // This is the initial-load race window: we don't KNOW yet, so we must not
    // guess. It must never collapse to 'absent' (which would default to cloud).
    expect(localModelAvailability(false, false)).toBe('unknown');
  });

  it("is 'absent' only once the probe resolves to not-ready", () => {
    expect(localModelAvailability(false, true)).toBe('absent');
  });
});

describe('effectiveChatProvider — the privacy-badge fallback fix + its initial-load race', () => {
  it('returns the saved provider verbatim when one is set (never null)', () => {
    expect(effectiveChatProvider('openai', 'ready')).toBe('openai');
    expect(effectiveChatProvider('openai', 'absent')).toBe('openai');
    expect(effectiveChatProvider('openai', 'unknown')).toBe('openai');
    expect(effectiveChatProvider('lantern-local', 'absent')).toBe('lantern-local');
  });

  it("an UNSET chat resolves to 'lantern-local' when the embedded model is ready (NEVER a cloud fallback)", () => {
    // BLOCKER regression: this is the unset-provider state that made the egress
    // badge falsely claim "data leaves" for an on-device chat.
    expect(effectiveChatProvider(undefined, 'ready')).toBe('lantern-local');
    expect(effectiveChatProvider(undefined, 'ready')).not.toBe('anthropic');
  });

  it("an UNSET chat is UNRESOLVED (null), NOT 'anthropic', while the probe is pending", () => {
    // BLOCKER 2 regression (the initial-load race): before the probe resolves we
    // must not silently default to the cloud. null tells the UI to show
    // "Checking local AI" and DISABLE send until the status settles.
    expect(effectiveChatProvider(undefined, 'unknown')).toBeNull();
    expect(effectiveChatProvider(undefined, 'unknown')).not.toBe('anthropic');
  });

  it("an UNSET chat falls back to 'anthropic' only once we KNOW the local model is absent (legacy 2-arg)", () => {
    expect(effectiveChatProvider(undefined, 'absent')).toBe('anthropic');
  });

  // NEW-003: the key-aware 3-arg form. With it, an unset/absent chat names only a
  // provider the user can actually send to — or 'none' when there are no keys —
  // so the trust badge can't claim "Sent to your Anthropic account" with no key.
  it("an UNSET + absent chat resolves to 'none' when there are NO valid keys", () => {
    expect(effectiveChatProvider(undefined, 'absent', [])).toBe('none');
    expect(effectiveChatProvider(undefined, 'absent', [])).not.toBe('anthropic');
  });

  it('an UNSET + absent chat resolves to the first VALID-keyed provider (not a hardcoded anthropic)', () => {
    expect(effectiveChatProvider(undefined, 'absent', ['openai'])).toBe('openai');
    expect(effectiveChatProvider(undefined, 'absent', ['google', 'openai'])).toBe('google');
  });

  it('the on-device model still wins over the key list when it is ready', () => {
    expect(effectiveChatProvider(undefined, 'ready', [])).toBe('lantern-local');
    expect(effectiveChatProvider(undefined, 'unknown', [])).toBeNull();
  });
});

describe("providerModelResolution — 'lantern-local'", () => {
  it('is part of the ChatProvider union (assignable)', () => {
    const p: ChatProvider = 'lantern-local';
    expect(p).toBe('lantern-local');
  });

  it('has an empty fallback model (model id is cosmetic, like ollama)', () => {
    expect(FALLBACK_MODEL['lantern-local']).toBe('');
  });

  it('offers no concrete model list (so the picker shows a Default model)', () => {
    expect(resolveModelsForProvider('lantern-local')).toEqual([]);
  });

  it('resolves to an empty model, letting the provider use its own default', () => {
    expect(resolveModelForProvider('lantern-local')).toBe('');
    // A preferred model that does not exist for this provider is ignored.
    expect(resolveModelForProvider('lantern-local', 'qwen3-4b-instruct-2507')).toBe('');
  });
});
