import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock, isTauriMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}));

import { createKeychainService } from '@/platform/providers/KeychainService';

const VALID_ANTHROPIC_KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwx';
const KEYCHAIN_ID = 'com.keepance.app::bos_key_anthropic';

const keychainStore = new Map<string, string>();

function setTauriRuntime(enabled: boolean): void {
  const win = window as Window & { __TAURI__?: unknown };
  if (enabled) {
    win.__TAURI__ = {};
  } else {
    delete win.__TAURI__;
  }
}

describe('KeychainService backend selection', () => {
  beforeEach(() => {
    localStorage.clear();
    keychainStore.clear();
    setTauriRuntime(false);
    isTauriMock.mockReturnValue(false);
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('VITE_ANTHROPIC_API_KEY', '');
    invokeMock.mockReset();
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
  });

  it('defaults to localStorage in browser mode', async () => {
    const keychain = createKeychainService();

    await keychain.setKey('anthropic', VALID_ANTHROPIC_KEY);

    expect(invokeMock).not.toHaveBeenCalled();
    expect(localStorage.getItem('bos_key_anthropic')).toBe(btoa(VALID_ANTHROPIC_KEY));
    expect(await keychain.getKey('anthropic')).toBe(VALID_ANTHROPIC_KEY);
    expect(await keychain.hasKey('anthropic')).toBe(true);
  });

  it('defaults to the Tauri OS keychain backend in desktop mode', async () => {
    setTauriRuntime(true);
    const keychain = createKeychainService();

    await keychain.setKey('anthropic', VALID_ANTHROPIC_KEY);

    expect(keychainStore.get(KEYCHAIN_ID)).toBe(VALID_ANTHROPIC_KEY);
    expect(localStorage.getItem('bos_key_anthropic')).toBeNull();
    expect(localStorage.getItem('bos_key_metadata')).toContain('"provider":"anthropic"');
    expect(invokeMock).toHaveBeenCalledWith('keychain_set', {
      service: undefined,
      key: 'bos_key_anthropic',
      value: VALID_ANTHROPIC_KEY,
    });

    expect(await keychain.getKey('anthropic')).toBe(VALID_ANTHROPIC_KEY);
    expect(await keychain.hasKey('anthropic')).toBe(true);

    await keychain.deleteKey('anthropic');
    expect(keychainStore.has(KEYCHAIN_ID)).toBe(false);
    expect(await keychain.hasKey('anthropic')).toBe(false);
  });

  it('supports explicitly selecting the Tauri backend for tests', async () => {
    const keychain = createKeychainService('tauri');

    await keychain.setKey('anthropic', VALID_ANTHROPIC_KEY);

    const reloaded = createKeychainService('tauri');
    expect(await reloaded.getKey('anthropic')).toBe(VALID_ANTHROPIC_KEY);
    expect(reloaded.getStoredKeys()).toEqual([
      expect.objectContaining({
        provider: 'anthropic',
        keyPrefix: VALID_ANTHROPIC_KEY.slice(0, 8),
      }),
    ]);
  });
});
