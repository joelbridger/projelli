/**
 * useActiveEgressProvider / resolveActiveEgressProvider (UX-01).
 *
 * The always-visible trust badge is the product's #1 trust signal, so the
 * provider it names must be HONEST, REACTIVE, and resolved from the SAME key
 * source the real send uses (KeychainService) — on desktop the keys live in the
 * OS keychain, not localStorage, so a localStorage-only check would show
 * "No AI connected" while Ask happily sends with the keychain key.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// F1: with no cloud key the resolver now falls back to the on-device engine when
// one is actually reachable (single-sourced with what Ask sends). Pin the local
// probes to "unavailable" so the "no provider configured" cases below are
// deterministic (they assert the none-sentinel, not a machine-dependent Ollama).
// The positive local-fallback path is proven in single-source-egress.test.ts.
vi.mock('@/platform/providers/OllamaProvider', async (orig) => {
  const actual = await orig<typeof import('@/platform/providers/OllamaProvider')>();
  return { ...actual, detectOllama: vi.fn(async () => ({ reachable: false, models: [] })) };
});
vi.mock('@/platform/utils/tauri-commands', async (orig) => {
  const actual = await orig<typeof import('@/platform/utils/tauri-commands')>();
  return { ...actual, localLlmModelStatus: vi.fn(async () => 'absent') };
});

import {
  resolveActiveEgressProvider,
  resolveActiveEgressProviderSync,
  useActiveEgressProvider,
  notifyEgressConfigChange,
} from '@/platform/hooks/useActiveEgressProvider';
import { KeychainService } from '@/platform/providers/KeychainService';

// Valid-format test keys (KeychainService.setKey validates the prefix/length).
const KEYS = {
  anthropic: 'sk-ant-test-00000000000000000000',
  openai: 'sk-test-00000000000000000000',
  google: 'AIza-test-key-00000000000000',
} as const;

async function setKey(provider: 'anthropic' | 'openai' | 'google'): Promise<void> {
  await new KeychainService().setKey(provider, KEYS[provider]);
}

beforeEach(() => {
  localStorage.clear();
});

describe('resolveActiveEgressProvider — honest, keychain-backed resolution', () => {
  it('local-only mode never picks a cloud key: with no usable on-device engine it is "local-pending", not the saved provider', async () => {
    // The local probes are pinned unavailable at the top of this file, so the
    // strict local-only resolution (item 3) is "setting up" — crucially NOT the
    // saved Anthropic key. Nothing leaves in local-only, ever.
    await setKey('anthropic');
    localStorage.setItem('lantern_default_provider', 'anthropic');
    expect(await resolveActiveEgressProvider('local-only')).toBe('local-pending');
  });

  it('honors the saved default ONLY when that provider actually has a key', async () => {
    localStorage.setItem('lantern_default_provider', 'anthropic');
    await setKey('anthropic');
    expect(await resolveActiveEgressProvider('direct')).toBe('anthropic');
  });

  it('does NOT claim a saved default that has no key — falls through to a keyed provider', async () => {
    localStorage.setItem('lantern_default_provider', 'anthropic');
    await setKey('openai');
    expect(await resolveActiveEgressProvider('direct')).toBe('openai');
  });

  it('resolves a key stored in the keychain even when NO legacy apiKey_* exists (UX-01 desktop fix)', async () => {
    // The exact desktop bug: the key lives in the keychain (KeychainService
    // backend), and the legacy apiKey_* localStorage key is gone after migration.
    // The badge must still name the provider, matching what Ask sends with.
    await setKey('openai');
    expect(localStorage.getItem('apiKey_openai')).toBeNull();
    expect(await resolveActiveEgressProvider('direct')).toBe('openai');
  });

  it('returns the "none" sentinel when no provider is configured', async () => {
    expect(await resolveActiveEgressProvider('direct')).toBe('none');
  });
});

describe('resolveActiveEgressProviderSync — flicker-free metadata mirror', () => {
  it('resolves from the key metadata mirror synchronously (present on desktop too)', async () => {
    await setKey('openai');
    expect(resolveActiveEgressProviderSync('direct')).toBe('openai');
  });

  it('returns "none" synchronously when nothing is configured', () => {
    expect(resolveActiveEgressProviderSync('direct')).toBe('none');
  });
});

describe('useActiveEgressProvider — reactive to mid-session key changes', () => {
  it('starts at "none" and updates when a key is added mid-session', async () => {
    const { result } = renderHook(() => useActiveEgressProvider('direct'));
    await waitFor(() => expect(result.current).toBe('none'));

    // setKey itself broadcasts the egress-config change, so the badge re-resolves.
    await act(async () => {
      await setKey('openai');
    });
    await waitFor(() => expect(result.current).toBe('openai'));
  });

  // R7 (trust review): the Privacy Center's "Current mode" pill must never
  // disagree with what a real send would use, across a genuine provider-to-
  // provider switch (not just none -> one). Regression for the exact bug
  // shape the review caught live: pill said "OpenAI" while real calls went
  // to Anthropic.
  it('flips from anthropic to openai when the saved default provider switches mid-session', async () => {
    await setKey('anthropic');
    await setKey('openai');
    localStorage.setItem('lantern_default_provider', 'anthropic');

    const { result, rerender } = renderHook(
      ({ mode }) => useActiveEgressProvider(mode),
      { initialProps: { mode: 'direct' } },
    );
    await waitFor(() => expect(result.current).toBe('anthropic'));

    await act(async () => {
      localStorage.setItem('lantern_default_provider', 'openai');
      notifyEgressConfigChange();
    });
    rerender({ mode: 'direct' });
    await waitFor(() => expect(result.current).toBe('openai'));
  });
});
