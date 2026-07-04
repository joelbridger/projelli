import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock, isTauriMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}));

import {
  createKeychainService,
  migrateLocalStorageApiKeysToKeychain,
} from './KeychainService';
import { SK_APIKEYS_MIGRATED_V1 } from '@/config/identity';

const MIGRATION_SENTINEL = 'lantern_apikeys_migrated_v2';
const KEYCHAIN_ID = 'com.lantern.app::bos_key_anthropic';
const LEGACY_KEY = 'apiKey_anthropic';
const MATERIAL_KEY = 'bos_key_anthropic';
const VALID_ANTHROPIC_KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwx';
const VALID_OPENAI_KEY = 'sk-proj-abcdefghijklmnopqrstuvwx';
const GOOGLE_LEGACY_KEY = 'apiKey_google';
const GOOGLE_KEYCHAIN_ID = 'com.lantern.app::bos_key_google';
// Real Google AI / Gemini keys start with "AIza".
const VALID_GOOGLE_KEY = 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345';

// Error shape the Tauri keychain backend treats as "no entry" (it checks
// `error.kind === 'notFound'`). Extends Error so Promise.reject is happy.
class KeychainNotFound extends Error {
  readonly kind = 'notFound';
  constructor() {
    super('no entry');
  }
}

const keychainStore = new Map<string, string>();

function mockKeychainInvoke(): void {
  invokeMock.mockImplementation(async (cmd: string, args: Record<string, unknown> = {}) => {
    const service = (args['service'] as string | undefined) ?? 'com.lantern.app';
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

  it('writes RAW legacy plaintext keys (the real-world format) to the OS keychain, then removes them', async () => {
    // The old useApiKeys hook stored the RAW key — NOT base64. This is the
    // case the v1 migration silently skipped (atob throws on the "-").
    localStorage.setItem(LEGACY_KEY, VALID_ANTHROPIC_KEY);

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
  });

  it('also migrates base64-encoded legacy values (older hypothetical build)', async () => {
    localStorage.setItem(LEGACY_KEY, btoa(VALID_ANTHROPIC_KEY));

    await migrateLocalStorageApiKeysToKeychain();

    expect(keychainStore.get(KEYCHAIN_ID)).toBe(VALID_ANTHROPIC_KEY);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(localStorage.getItem(MIGRATION_SENTINEL)).toBe('true');
    expect(invokeMock).toHaveBeenCalledWith('keychain_set', {
      service: undefined,
      key: 'bos_key_anthropic',
      value: VALID_ANTHROPIC_KEY,
    });
  });

  it('migrates raw plaintext to base64 localStorage in browser mode (no Tauri keychain)', async () => {
    isTauriMock.mockReturnValue(false);
    localStorage.setItem(LEGACY_KEY, VALID_ANTHROPIC_KEY);

    await migrateLocalStorageApiKeysToKeychain();

    // No OS keychain in the browser — material lands in base64 localStorage...
    expect(invokeMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(MATERIAL_KEY)).toBe(btoa(VALID_ANTHROPIC_KEY));
    // ...and the raw plaintext entry is gone.
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(localStorage.getItem(MIGRATION_SENTINEL)).toBe('true');
  });

  it('clears the obsolete v1 sentinel after a clean v2 run', async () => {
    localStorage.setItem(SK_APIKEYS_MIGRATED_V1, 'true');
    localStorage.setItem(LEGACY_KEY, VALID_ANTHROPIC_KEY);

    await migrateLocalStorageApiKeysToKeychain();

    expect(localStorage.getItem(SK_APIKEYS_MIGRATED_V1)).toBeNull();
    expect(localStorage.getItem(MIGRATION_SENTINEL)).toBe('true');
    expect(keychainStore.get(KEYCHAIN_ID)).toBe(VALID_ANTHROPIC_KEY);
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
    // No key yet (pre-write existing-check returns notFound), but the write's
    // read-back returns a different value → verification mismatch.
    let setCalled = false;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'keychain_set') {
        setCalled = true;
        return Promise.resolve(undefined);
      }
      if (cmd === 'keychain_get') {
        if (!setCalled) return Promise.reject(new KeychainNotFound());
        return Promise.resolve('not-the-same-key');
      }
      return Promise.reject(new Error(`unexpected invoke ${cmd}`));
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

  it('does not overwrite an existing keychain key with a stale legacy entry, but still removes the plaintext', async () => {
    // Upgrading user already has a GOOD key in the OS keychain (re-added via
    // Settings after upgrade) AND a STALE older plaintext entry the broken v1
    // migration left behind.
    keychainStore.set(KEYCHAIN_ID, VALID_ANTHROPIC_KEY);
    const STALE_OLD_KEY = 'sk-ant-api03-OLDOLDOLDOLDOLDOLDOLDOLD';
    localStorage.setItem(LEGACY_KEY, STALE_OLD_KEY);

    await migrateLocalStorageApiKeysToKeychain();

    // The good keychain key is preserved (NOT rolled back to the stale value)...
    expect(keychainStore.get(KEYCHAIN_ID)).toBe(VALID_ANTHROPIC_KEY);
    expect(invokeMock).not.toHaveBeenCalledWith('keychain_set', expect.anything());
    // ...and the stale plaintext is still cleaned up.
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(localStorage.getItem(MIGRATION_SENTINEL)).toBe('true');
  });

  it('a KeychainService created BEFORE the migration shows the migrated key in getStoredKeys (same session)', async () => {
    // Upgrading user: App constructs the shared service first; their only key is
    // still the legacy plaintext entry, so its metadata starts empty.
    const shared = createKeychainService('tauri');
    expect(shared.getStoredKeys()).toEqual([]);

    localStorage.setItem(LEGACY_KEY, VALID_ANTHROPIC_KEY);
    await migrateLocalStorageApiKeysToKeychain();

    // The SAME instance now reflects the migrated key — the "Manage AI Account
    // Keys" settings screen shows it without an app reload.
    expect(shared.getStoredKeys()).toEqual([
      expect.objectContaining({
        provider: 'anthropic',
        keyPrefix: VALID_ANTHROPIC_KEY.slice(0, 8),
      }),
    ]);
    expect(shared.getKeyMetadata('anthropic')).toMatchObject({ provider: 'anthropic' });
  });

  it('setKey on a pre-existing instance does not clobber a just-migrated key', async () => {
    // Stale-cache instance (constructed before any metadata existed).
    const shared = createKeychainService('tauri');

    // Migration adds anthropic to the metadata in localStorage.
    localStorage.setItem(LEGACY_KEY, VALID_ANTHROPIC_KEY);
    await migrateLocalStorageApiKeysToKeychain();

    // The stale instance now saves a DIFFERENT provider; anthropic must survive.
    await shared.setKey('openai', VALID_OPENAI_KEY);

    const providers = shared
      .getStoredKeys()
      .map((k) => k.provider)
      .sort();
    expect(providers).toEqual(['anthropic', 'openai']);
  });

  it('decodes a base64-encoded Google legacy key into the keychain (not the encoded blob)', async () => {
    localStorage.setItem(GOOGLE_LEGACY_KEY, btoa(VALID_GOOGLE_KEY));

    await migrateLocalStorageApiKeysToKeychain();

    // The decoded key — NOT the base64 blob — lands in the keychain.
    expect(keychainStore.get(GOOGLE_KEYCHAIN_ID)).toBe(VALID_GOOGLE_KEY);
    expect(localStorage.getItem(GOOGLE_LEGACY_KEY)).toBeNull();
    expect(localStorage.getItem(MIGRATION_SENTINEL)).toBe('true');
  });

  it('migrates a raw Google legacy key as-is', async () => {
    localStorage.setItem(GOOGLE_LEGACY_KEY, VALID_GOOGLE_KEY);

    await migrateLocalStorageApiKeysToKeychain();

    expect(keychainStore.get(GOOGLE_KEYCHAIN_ID)).toBe(VALID_GOOGLE_KEY);
    expect(localStorage.getItem(GOOGLE_LEGACY_KEY)).toBeNull();
  });
});
