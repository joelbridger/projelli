/**
 * useApiKeys — security-focused unit tests.
 *
 * The central trust promise is "your AI provider keys live in the OS keychain,
 * never in plain browser storage". These tests pin that down:
 *   - on desktop (Tauri), a saved key goes to the OS keychain and the raw key
 *     is NEVER written to localStorage (neither the legacy `apiKey_<provider>`
 *     plaintext entry nor the `bos_key_<provider>` material entry);
 *   - in browser-only mode the documented fallback is base64-obfuscated
 *     localStorage (`bos_key_<provider>`), and the raw `apiKey_<provider>`
 *     plaintext entry is never written;
 *   - keys are loaded from the keychain on mount (not from `apiKey_`);
 *   - deleting a key removes it from the keychain and from in-memory state.
 */
import { describe, beforeEach, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const { invokeMock, isTauriMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}));

import { useApiKeys } from './useApiKeys';
import { createKeychainService } from '@/platform/providers/KeychainService';

const VALID_KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwx';
const LEGACY_PLAINTEXT = 'apiKey_anthropic';
const MATERIAL_KEY = 'bos_key_anthropic';

// Error shape the Tauri keychain backend recognizes as "no entry" (it checks
// `error.kind === 'notFound'`). Extends Error so it satisfies only-throw-error.
class KeychainNotFound extends Error {
  readonly kind = 'notFound';
  constructor() {
    super('no entry');
  }
}

// A Map-backed fake OS keychain so the Tauri backend round-trips in jsdom.
const keychainStore = new Map<string, string>();
function mockKeychainInvoke(): void {
  invokeMock.mockImplementation((cmd: string, args: Record<string, unknown> = {}) => {
    const service = (args['service'] as string | undefined) ?? 'com.keepance.app';
    const key = args['key'] as string;
    const id = `${service}::${key}`;
    if (cmd === 'keychain_set') {
      keychainStore.set(id, args['value'] as string);
      return Promise.resolve(undefined);
    }
    if (cmd === 'keychain_get') {
      if (!keychainStore.has(id)) return Promise.reject(new KeychainNotFound());
      return Promise.resolve(keychainStore.get(id));
    }
    if (cmd === 'keychain_delete') {
      keychainStore.delete(id);
      return Promise.resolve(undefined);
    }
    return Promise.reject(new Error(`unexpected invoke ${cmd}`));
  });
}

beforeEach(() => {
  localStorage.clear();
  keychainStore.clear();
  invokeMock.mockReset();
  isTauriMock.mockReturnValue(false);
  mockKeychainInvoke();
});

describe('useApiKeys — desktop (OS keychain)', () => {
  it('saves the key to the OS keychain and never writes the raw key to localStorage', async () => {
    const keychain = createKeychainService('tauri');
    const { result } = renderHook(() => useApiKeys(keychain));

    await act(async () => {
      await result.current.handleSaveApiKey('anthropic', VALID_KEY);
    });

    // The key is retrievable from the keychain...
    await expect(keychain.getKey('anthropic')).resolves.toBe(VALID_KEY);
    // ...and the OS keychain backend was actually used.
    expect(invokeMock).toHaveBeenCalledWith('keychain_set', {
      service: undefined,
      key: 'bos_key_anthropic',
      value: VALID_KEY,
    });

    // The raw key must NOT be mirrored into localStorage in any form.
    expect(localStorage.getItem(LEGACY_PLAINTEXT)).toBeNull();
    expect(localStorage.getItem(MATERIAL_KEY)).toBeNull();

    // In-memory session state reflects the connected provider.
    expect(result.current.apiKeys).toEqual([
      expect.objectContaining({ provider: 'anthropic', key: VALID_KEY, isValid: true }),
    ]);
  });
});

describe('useApiKeys — browser fallback (documented residual limitation)', () => {
  it('stores the key as base64-obfuscated localStorage, never as raw plaintext', async () => {
    const keychain = createKeychainService('localStorage');
    const { result } = renderHook(() => useApiKeys(keychain));

    await act(async () => {
      await result.current.handleSaveApiKey('anthropic', VALID_KEY);
    });

    // Residual web limitation: obfuscated (base64), recoverable, but NOT raw.
    const material = localStorage.getItem(MATERIAL_KEY);
    expect(material).toBe(btoa(VALID_KEY));
    expect(atob(material ?? '')).toBe(VALID_KEY);

    // The legacy raw-plaintext entry is never written.
    expect(localStorage.getItem(LEGACY_PLAINTEXT)).toBeNull();
    await expect(keychain.getKey('anthropic')).resolves.toBe(VALID_KEY);
  });
});

describe('useApiKeys — load on mount', () => {
  it('loads existing keys from the keychain (not from apiKey_ plaintext)', async () => {
    const keychain = createKeychainService('memory');
    await keychain.setKey('anthropic', VALID_KEY);

    const { result } = renderHook(() => useApiKeys(keychain));

    await waitFor(() => {
      expect(result.current.apiKeys).toEqual([
        expect.objectContaining({ provider: 'anthropic', key: VALID_KEY, isValid: true }),
      ]);
    });
  });

  it('does NOT read the legacy apiKey_ plaintext entry', async () => {
    localStorage.setItem(LEGACY_PLAINTEXT, VALID_KEY);
    const keychain = createKeychainService('memory'); // empty keychain
    const { result } = renderHook(() => useApiKeys(keychain));

    // Give the mount load a chance to run; it must find nothing.
    await act(async () => { await Promise.resolve(); });
    expect(result.current.apiKeys).toEqual([]);
  });
});

describe('useApiKeys — delete', () => {
  it('removes the key from the keychain and from in-memory state', async () => {
    const keychain = createKeychainService('memory');
    const { result } = renderHook(() => useApiKeys(keychain));

    await act(async () => {
      await result.current.handleSaveApiKey('anthropic', VALID_KEY);
    });
    expect(result.current.apiKeys).toHaveLength(1);

    await act(async () => {
      await result.current.handleDeleteApiKey('anthropic');
    });

    expect(result.current.apiKeys).toEqual([]);
    await expect(keychain.getKey('anthropic')).resolves.toBeNull();
    expect(localStorage.getItem(LEGACY_PLAINTEXT)).toBeNull();
  });
});
