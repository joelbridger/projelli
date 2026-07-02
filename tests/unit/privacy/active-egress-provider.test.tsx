/**
 * useActiveEgressProvider / resolveActiveEgressProvider (UX-01).
 *
 * The always-visible trust badge is the product's #1 trust signal, so the
 * provider it names must be HONEST, REACTIVE, and resolved from the SAME key
 * source the real send uses (KeychainService) — on desktop the keys live in the
 * OS keychain, not localStorage, so a localStorage-only check would show
 * "No AI connected" while Ask happily sends with the keychain key.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  resolveActiveEgressProvider,
  resolveActiveEgressProviderSync,
  useActiveEgressProvider,
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
  it('local-only mode is always on-machine, regardless of saved keys', async () => {
    await setKey('anthropic');
    localStorage.setItem('lantern_default_provider', 'anthropic');
    expect(await resolveActiveEgressProvider('local-only')).toBe('ollama');
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
});
