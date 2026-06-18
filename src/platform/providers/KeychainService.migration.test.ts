import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock, isTauriMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}));

import { migrateLocalStorageApiKeysToKeychain } from './KeychainService';

const MIGRATION_SENTINEL = 'keepance_apikeys_migrated_v1';
const KEYCHAIN_ID = 'com.keepance.app::bos_key_anthropic';
const LEGACY_KEY = 'apiKey_anthropic';
const VALID_ANTHROPIC_KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwx';

const keychainStore = new Map<string, string>();

function mockKeychainInvoke(): void {
  invokeMock.mockImplementation(async (cmd: string, args: Record<string, unknown> = {}) => {
    const service = (args['service'] as string | undefined) ?? 'com.keepance.app';
    const key = args['key'] as string;
    const id = `${service}::${key}`;

    if (cmd === 'keychain_set') {
      keychainStore.set(id, args['value'] as string);
      return undefined;
    }
    if (cmd === 'keychain_get') {
      if (!keychainStore.has(id)) throw { kind: 'notFound', message: 'no entry' };
      return keychainStore.get(id);
    }
    if (cmd === 'keychain_delete') {
      keychainStore.delete(id);
      return undefined;
    }
    throw new Error(`unexpected invoke ${cmd}`);
  });
}

describe('migrateLocalStorageApiKeysToKeychain', () => {
  beforeEach(() => {
    localStorage.clear();
    keychainStore.clear();
    invokeMock.mockReset();
    isTauriMock.mockReturnValue(true);
    mockKeychainInvoke();
  });

  it('writes legacy localStorage API keys to the OS keychain, verifies them, then removes localStorage copies', async () => {
    localStorage.setItem(LEGACY_KEY, btoa(VALID_ANTHROPIC_KEY));

    await migrateLocalStorageApiKeysToKeychain();

    expect(keychainStore.get(KEYCHAIN_ID)).toBe(VALID_ANTHROPIC_KEY);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(localStorage.getItem(MIGRATION_SENTINEL)).toBe('true');
    expect(localStorage.getItem('bos_key_metadata')).toContain('"provider":"anthropic"');
    expect(invokeMock).toHaveBeenCalledWith('keychain_set', {
      service: undefined,
      key: 'bos_key_anthropic',
      value: VALID_ANTHROPIC_KEY,
    });
    expect(invokeMock).toHaveBeenCalledWith('keychain_get', {
      service: undefined,
      key: 'bos_key_anthropic',
    });
  });

  it('is a no-op after the migration sentinel is set', async () => {
    localStorage.setItem(MIGRATION_SENTINEL, 'true');
    localStorage.setItem(LEGACY_KEY, btoa(VALID_ANTHROPIC_KEY));

    await migrateLocalStorageApiKeysToKeychain();

    expect(invokeMock).not.toHaveBeenCalled();
    expect(keychainStore.has(KEYCHAIN_ID)).toBe(false);
    expect(localStorage.getItem(LEGACY_KEY)).toBe(btoa(VALID_ANTHROPIC_KEY));
  });

  it('keeps the localStorage entry and retries next run when keychain verification fails', async () => {
    localStorage.setItem(LEGACY_KEY, btoa(VALID_ANTHROPIC_KEY));
    invokeMock.mockImplementation(async (cmd: string, args: Record<string, unknown> = {}) => {
      const service = (args['service'] as string | undefined) ?? 'com.keepance.app';
      const key = args['key'] as string;
      const id = `${service}::${key}`;

      if (cmd === 'keychain_set') {
        keychainStore.set(id, args['value'] as string);
        return undefined;
      }
      if (cmd === 'keychain_get') {
        return 'not-the-same-key';
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await migrateLocalStorageApiKeysToKeychain();

    expect(localStorage.getItem(LEGACY_KEY)).toBe(btoa(VALID_ANTHROPIC_KEY));
    expect(localStorage.getItem(MIGRATION_SENTINEL)).toBeNull();

    invokeMock.mockReset();
    mockKeychainInvoke();
    await migrateLocalStorageApiKeysToKeychain();

    expect(keychainStore.get(KEYCHAIN_ID)).toBe(VALID_ANTHROPIC_KEY);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(localStorage.getItem(MIGRATION_SENTINEL)).toBe('true');
  });
});
