/**
 * NO-SILENT-DEMOTION proof — KEYCHAIN backend picker + native HTTP picker
 * (Amplifier Phase-B, c34).
 *
 * Context: the `withGlobalTauri:false` flip (DEFERRED to the packaged bench —
 * NOT performed in this lane) removes `window.__TAURI__` but keeps
 * `window.__TAURI_INTERNALS__`. Before the durable-detection migration,
 * KeychainService's constructor default read ONLY `window.__TAURI__`, so the
 * flip would make it pick the `LocalStorageBackend` (base64-obfuscated
 * localStorage) instead of the OS keychain — API keys/secrets demoted to
 * browser-grade storage with NO crash. `shouldUseTauriHttp()` had the same
 * global-only read and would drop the CORS-bypassing native HTTP path.
 *
 * This suite pins that, AFTER the migration, both pickers resolve NATIVE in the
 * post-flip environment (only `__TAURI_INTERNALS__` present).
 *
 * NECESSARY-BUT-NOT-SUFFICIENT (HD-3): the injected globals are SIMULATED in
 * jsdom. FULL confirmation — that a secret lands in the real OS keychain and not
 * localStorage once `__TAURI__` is truly gone — is owed on the PACKAGED BINARY
 * at the bench.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const { invokeMock, isTauriMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(),
}));

// Mock the WHOLE core module (both exports) — a partial mock omitting `isTauri`
// makes vitest throw when unrelated code touches it (see AuditService note).
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock, isTauri: isTauriMock }));

import { KeychainService, isTauriRuntime } from './KeychainService';
import { isTauriProductionBuild } from './fetchUtils';

type MutWin = { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown };
const w = () => window as unknown as MutWin;

/** withGlobalTauri:false (the DEFERRED flip) → internals present, global absent. */
function setPostFlipTauriEnv() {
  w().__TAURI_INTERNALS__ = {};
  delete w().__TAURI__;
}
/** Browser → neither present. */
function setBrowserEnv() {
  delete w().__TAURI_INTERNALS__;
  delete w().__TAURI__;
}

// Error shape the Tauri keychain backend treats as "no entry" (it checks
// `error.kind === 'notFound'`). Extends Error so lint's only-throw-error is
// satisfied while still carrying the discriminant the backend reads.
class KeychainNotFound extends Error {
  readonly kind = 'notFound';
  constructor() {
    super('no entry');
  }
}

const keychainStore = new Map<string, string>();
function mockKeychainInvoke(): void {
  // Non-async so there's no dangling await; returns or rejects Promises to
  // mirror the real invoke() contract (reject on notFound, not a sync throw).
  invokeMock.mockImplementation((cmd: string, args: Record<string, unknown> = {}) => {
    const service = (args['service'] as string | undefined) ?? 'com.lantern.app';
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
  isTauriMock.mockReset().mockReturnValue(true);
  mockKeychainInvoke();
});

afterEach(() => {
  setBrowserEnv();
  vi.unstubAllEnvs();
});

describe('Keychain picker — isTauriRuntime() resolves NATIVE across the flip', () => {
  it('post-flip env (only __TAURI_INTERNALS__) → NATIVE keychain (true)', () => {
    setPostFlipTauriEnv();
    expect(isTauriRuntime()).toBe(true);
  });

  it('browser env (neither global) → localStorage (false)', () => {
    setBrowserEnv();
    expect(isTauriRuntime()).toBe(false);
  });
});

describe('Keychain service — new KeychainService() default picks the OS keychain across the flip', () => {
  it('post-flip env → secret read via the OS keychain (invoke), NOT localStorage', async () => {
    setPostFlipTauriEnv();
    // Seed a secret in the (mocked) OS keychain only.
    keychainStore.set('com.lantern.app::bos_key_anthropic', 'sk-ant-secret-native');

    const svc = new KeychainService(); // default backendType = isTauriRuntime() ? 'tauri' : 'localStorage'
    const key = await svc.getKey('anthropic');

    expect(key).toBe('sk-ant-secret-native');
    expect(invokeMock).toHaveBeenCalledWith('keychain_get', expect.objectContaining({ key: 'bos_key_anthropic' }));
    // Proof it did NOT read the browser fallback: nothing was placed there.
    expect(localStorage.getItem('bos_key_anthropic')).toBeNull();
  });

  it('browser env → secret read from localStorage (the demotion path, correct only in a real browser)', async () => {
    setBrowserEnv();
    // The base64-obfuscated browser fallback store.
    localStorage.setItem('bos_key_anthropic', btoa('sk-ant-secret-browser'));

    const svc = new KeychainService();
    const key = await svc.getKey('anthropic');

    expect(key).toBe('sk-ant-secret-browser');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('NEGATIVE CONTROL: pre-migration global-only predicate WOULD demote in the post-flip env', () => {
    setPostFlipTauriEnv();
    const legacyGlobalOnly = typeof window !== 'undefined' && '__TAURI__' in window;
    expect(legacyGlobalOnly).toBe(false); // old check → LocalStorageBackend (secrets in localStorage)
    expect(isTauriRuntime()).toBe(true); // migrated check → OS keychain preserved
  });
});

describe('Native HTTP picker — isTauriProductionBuild() resolves NATIVE across the flip', () => {
  it('post-flip env + production build → native Tauri HTTP (true)', () => {
    setPostFlipTauriEnv();
    vi.stubEnv('DEV', false);
    expect(isTauriProductionBuild()).toBe(true);
  });

  it('browser env + production build → browser fetch (false)', () => {
    setBrowserEnv();
    vi.stubEnv('DEV', false);
    expect(isTauriProductionBuild()).toBe(false);
  });
});
