/**
 * useActiveEgressProvider / resolveActiveEgressProvider (UX-01).
 *
 * The always-visible trust badge is the product's #1 trust signal, so the
 * provider it names must be HONEST and REACTIVE:
 *   - never claim a saved-default provider the user has no key for,
 *   - fall through to whichever provider actually has a key,
 *   - say "no AI connected" (sentinel 'none') when nothing is configured,
 *   - update mid-session the moment a key is added/removed (no stale badge).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  resolveActiveEgressProvider,
  notifyEgressConfigChange,
  useActiveEgressProvider,
} from '@/platform/hooks/useActiveEgressProvider';

beforeEach(() => {
  localStorage.clear();
});

describe('resolveActiveEgressProvider — honest provider resolution', () => {
  it('local-only mode is always on-machine, regardless of saved keys', () => {
    localStorage.setItem('apiKey_anthropic', 'sk-ant');
    localStorage.setItem('keepance_default_provider', 'anthropic');
    expect(resolveActiveEgressProvider('local-only')).toBe('ollama');
  });

  it('honors the saved default ONLY when that provider actually has a key', () => {
    localStorage.setItem('keepance_default_provider', 'anthropic');
    localStorage.setItem('apiKey_anthropic', 'sk-ant');
    expect(resolveActiveEgressProvider('direct')).toBe('anthropic');
  });

  it('does NOT claim a saved default that has no key — falls through to a keyed provider', () => {
    // The exact bug: default says anthropic, but the only key is OpenAI.
    localStorage.setItem('keepance_default_provider', 'anthropic');
    localStorage.setItem('apiKey_openai', 'sk-oai');
    expect(resolveActiveEgressProvider('direct')).toBe('openai');
  });

  it('with no saved default, uses the first provider that has a key', () => {
    localStorage.setItem('apiKey_openai', 'sk-oai');
    expect(resolveActiveEgressProvider('direct')).toBe('openai');
  });

  it('returns the "none" sentinel when no provider is configured', () => {
    expect(resolveActiveEgressProvider('direct')).toBe('none');
  });
});

describe('useActiveEgressProvider — reactive to mid-session key changes', () => {
  it('starts at "none" and updates when a key is added mid-session', () => {
    const { result } = renderHook(() => useActiveEgressProvider('direct'));
    expect(result.current).toBe('none');

    act(() => {
      localStorage.setItem('apiKey_openai', 'sk-oai');
      notifyEgressConfigChange();
    });
    expect(result.current).toBe('openai');
  });
});
