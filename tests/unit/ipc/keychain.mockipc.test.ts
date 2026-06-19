/**
 * keychain.mockipc.test.ts
 *
 * IPC boundary tests for the keychain commands (keychain_set / keychain_get /
 * keychain_delete).  Uses Tauri's `mockIPC` to intercept the real `invoke()`
 * call without a Rust build or an OS keychain.
 *
 * ## What is tested
 *   - The front-end wrappers in `TauriKeychainBackend` (used by `KeychainService`)
 *     and the thin functions in `tauri-commands.ts` send the EXACT command name
 *     and EXACT arg shape that the Rust side expects.
 *   - The wrappers correctly return / propagate the reply that Rust sends back.
 *
 * ## Why these tests would FAIL on wrong wiring
 *   - If the command string is wrong (e.g. "keychain_store" instead of
 *     "keychain_set") the mockIPC handler throws "unexpected command" and the
 *     test fails.
 *   - If the arg keys are wrong (e.g. "apiKey" instead of "value") the
 *     `seen` capture records the real shape, and the `toMatchObject` assertion
 *     fails on exact key names.
 *   - If the wrapper returns something other than what the mock returns, the
 *     return-value assertion fails.
 *
 * ## TauriKeychainBackend arg shape (from KeychainService.ts)
 *   keychain_set:    { service: undefined, key: string, value: string }
 *   keychain_get:    { service: undefined, key: string }
 *   keychain_delete: { service: undefined, key: string }
 *
 *   The `key` sent is prefixed with 'bos_key_' + provider
 *   (e.g. 'bos_key_anthropic').
 *
 * ## tauri-commands.ts wrappers arg shape
 *   keychainSet(key, value, service?)  -> invoke('keychain_set',    { service, key, value })
 *   keychainGet(key, service?)         -> invoke('keychain_get',    { service, key })
 *   keychainDelete(key, service?)      -> invoke('keychain_delete', { service, key })
 *
 *   The `service` param is optional; when not passed it is `undefined`.
 *   These functions guard with `isTauri()` which checks `globalThis.isTauri`
 *   (a boolean) -- tests must set that to `true` before calling them.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mockIPC, clearMocks } from '@tauri-apps/api/mocks';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Shape of a captured IPC call. */
interface Captured {
  cmd: string;
  args: unknown;
}

// ── TauriKeychainBackend (via KeychainService) ────────────────────────────────

// KeychainService is imported AFTER mockIPC sets up `window.__TAURI_INTERNALS__`
// in beforeEach, so the dynamic `isTauriRuntime()` guard in the constructor
// (which reads `window.__TAURI__`) is bypassed by passing 'tauri' explicitly.
// The TauriKeychainBackend methods themselves do NOT have an isTauri() guard --
// they call invoke() directly -- so mockIPC intercepts them cleanly.

describe('IPC boundary: TauriKeychainBackend (KeychainService internals)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let KeychainServiceClass: any;

  beforeEach(async () => {
    // Set up the Tauri IPC internals so invoke() can find the mock.
    mockIPC(() => undefined); // placeholder; tests set their own mockIPC per-call
    // Dynamic import after mockIPC is wired up.
    const mod = await import('@/platform/providers/KeychainService');
    KeychainServiceClass = mod.KeychainService;
  });

  afterEach(() => {
    clearMocks();
  });

  // ── keychain_set ────────────────────────────────────────────────────────────

  describe('keychain_set', () => {
    it('sends the exact command name and arg shape, returns void on success', async () => {
      const captured: Captured[] = [];

      mockIPC((cmd, args) => {
        captured.push({ cmd, args });
        if (cmd === 'keychain_set') return undefined; // Rust returns void
        throw new Error(`unexpected command: ${cmd}`);
      });

      // Force 'tauri' backend so TauriKeychainBackend is used.
      const svc = new KeychainServiceClass('tauri');
      // setKey validates format -- use a valid Anthropic key-shaped string.
      await svc.setKey('anthropic', 'sk-ant-' + 'x'.repeat(30));

      // Exactly one keychain_set call should have been made.
      const setCall = captured.find((c) => c.cmd === 'keychain_set');
      expect(setCall, 'keychain_set was not invoked').toBeDefined();

      // Arg keys must match exactly what the Rust command declares.
      expect(setCall!.args).toMatchObject({
        service: undefined,
        key: 'bos_key_anthropic',
        value: 'sk-ant-' + 'x'.repeat(30),
      });
    });

    it('test validity: only keychain_set is sent (not a renamed command)', async () => {
      const captured: Captured[] = [];

      mockIPC((cmd, args) => {
        captured.push({ cmd, args });
        return undefined;
      });

      const svc = new KeychainServiceClass('tauri');
      await svc.setKey('anthropic', 'sk-ant-' + 'x'.repeat(30));

      // The real wrapper sends 'keychain_set'. If it sent 'keychain_store' this
      // would be undefined and the test would fail -- proving the test catches
      // wrong command names.
      const setCall = captured.find((c) => c.cmd === 'keychain_set');
      expect(setCall).toBeDefined();

      const wrongCall = captured.find((c) => c.cmd === 'keychain_store');
      expect(wrongCall).toBeUndefined();
    });
  });

  // ── keychain_get ────────────────────────────────────────────────────────────

  describe('keychain_get', () => {
    it('sends the exact command name and arg shape, returns the Rust reply', async () => {
      const captured: Captured[] = [];
      const FAKE_KEY = 'sk-ant-fake-returned-key-abc';

      mockIPC((cmd, args) => {
        captured.push({ cmd, args });
        if (cmd === 'keychain_get') return FAKE_KEY;
        throw new Error(`unexpected command: ${cmd}`);
      });

      const svc = new KeychainServiceClass('tauri');
      const result = await svc.getKey('openai');

      const getCall = captured.find((c) => c.cmd === 'keychain_get');
      expect(getCall, 'keychain_get was not invoked').toBeDefined();

      // Exact arg shape: service + key (no 'value' on a read).
      expect(getCall!.args).toMatchObject({
        service: undefined,
        key: 'bos_key_openai',
      });

      // The wrapper should return exactly what the mock (simulated Rust) returned.
      expect(result).toBe(FAKE_KEY);
    });

    it('returns null when Rust signals key-not-found', async () => {
      mockIPC((cmd) => {
        if (cmd === 'keychain_get') {
          // Tauri keychain_get throws a structured error when key is missing.
          // TauriKeychainBackend catches it via isKeychainNotFound() and returns null.
          throw { kind: 'notFound' };
        }
        throw new Error(`unexpected command: ${cmd}`);
      });

      const svc = new KeychainServiceClass('tauri');
      const result = await svc.getKey('google');

      // The wrapper must translate notFound into null, not propagate the error.
      expect(result).toBeNull();
    });

    it('propagates non-notFound errors from the keychain', async () => {
      mockIPC((cmd) => {
        if (cmd === 'keychain_get') {
          throw { kind: 'accessDenied', message: 'OS keychain locked' };
        }
        throw new Error(`unexpected command: ${cmd}`);
      });

      const svc = new KeychainServiceClass('tauri');
      // Non-notFound errors must bubble up, not be swallowed.
      await expect(svc.getKey('anthropic')).rejects.toMatchObject({
        kind: 'accessDenied',
      });
    });
  });

  // ── keychain_delete ─────────────────────────────────────────────────────────

  describe('keychain_delete', () => {
    it('sends the exact command name and arg shape, returns void', async () => {
      const captured: Captured[] = [];

      mockIPC((cmd, args) => {
        captured.push({ cmd, args });
        if (cmd === 'keychain_delete') return undefined;
        throw new Error(`unexpected command: ${cmd}`);
      });

      const svc = new KeychainServiceClass('tauri');
      await svc.deleteKey('anthropic');

      const delCall = captured.find((c) => c.cmd === 'keychain_delete');
      expect(delCall, 'keychain_delete was not invoked').toBeDefined();

      // Arg shape: service + key (no 'value' on a delete).
      expect(delCall!.args).toMatchObject({
        service: undefined,
        key: 'bos_key_anthropic',
      });

      // No 'value' key in delete args -- that would indicate wrong wiring.
      expect((delCall!.args as Record<string, unknown>)['value']).toBeUndefined();
    });
  });
});

// ── tauri-commands.ts standalone wrappers ────────────────────────────────────

// keychainSet / keychainGet / keychainDelete in tauri-commands.ts guard with
// `isTauri()`.  `isTauri()` checks `(globalThis || window).isTauri` (a
// boolean on the global object), which is distinct from the
// `window.__TAURI_INTERNALS__` object that mockIPC sets.  We must set BOTH:
//   - window.__TAURI_INTERNALS__ (done by mockIPC)
//   - globalThis.isTauri = true (so the isTauri() guard passes)

describe('IPC boundary: tauri-commands.ts standalone wrappers', () => {
  beforeEach(() => {
    // Prime the Tauri internals so invoke() resolves through the mock.
    mockIPC(() => undefined);
    // Make isTauri() return true so the guard in each wrapper passes.
    (globalThis as unknown as Record<string, unknown>)['isTauri'] = true;
  });

  afterEach(() => {
    clearMocks();
    delete (globalThis as unknown as Record<string, unknown>)['isTauri'];
  });

  // ── keychainSet ─────────────────────────────────────────────────────────────

  describe('keychainSet', () => {
    it('sends keychain_set with { service, key, value } and resolves', async () => {
      const captured: Captured[] = [];

      mockIPC((cmd, args) => {
        captured.push({ cmd, args });
        if (cmd === 'keychain_set') return undefined;
        throw new Error(`unexpected command: ${cmd}`);
      });

      const { keychainSet } = await import('@/platform/utils/tauri-commands');
      await keychainSet('my-key', 'my-secret', 'my-service');

      const setCall = captured.find((c) => c.cmd === 'keychain_set');
      expect(setCall, 'keychain_set was not invoked').toBeDefined();
      expect(setCall!.args).toEqual({
        service: 'my-service',
        key: 'my-key',
        value: 'my-secret',
      });
    });

    it('passes service=undefined when the optional service param is omitted', async () => {
      const captured: Captured[] = [];

      mockIPC((cmd, args) => {
        captured.push({ cmd, args });
        if (cmd === 'keychain_set') return undefined;
        throw new Error(`unexpected command: ${cmd}`);
      });

      const { keychainSet } = await import('@/platform/utils/tauri-commands');
      await keychainSet('bare-key', 'bare-value');

      const setCall = captured.find((c) => c.cmd === 'keychain_set');
      expect(setCall!.args).toMatchObject({
        key: 'bare-key',
        value: 'bare-value',
        service: undefined,
      });
    });
  });

  // ── keychainGet ─────────────────────────────────────────────────────────────

  describe('keychainGet', () => {
    it('sends keychain_get with { service, key } and returns the Rust reply', async () => {
      const captured: Captured[] = [];

      mockIPC((cmd, args) => {
        captured.push({ cmd, args });
        if (cmd === 'keychain_get') return 'retrieved-secret';
        throw new Error(`unexpected command: ${cmd}`);
      });

      const { keychainGet } = await import('@/platform/utils/tauri-commands');
      const result = await keychainGet('lookup-key', 'lookup-service');

      const getCall = captured.find((c) => c.cmd === 'keychain_get');
      expect(getCall, 'keychain_get was not invoked').toBeDefined();

      // No 'value' arg on a read -- would indicate wrong command mapping.
      expect(getCall!.args).toEqual({
        service: 'lookup-service',
        key: 'lookup-key',
      });
      expect((getCall!.args as Record<string, unknown>)['value']).toBeUndefined();

      // Wrapper must return the string the Rust side sent back.
      expect(result).toBe('retrieved-secret');
    });
  });

  // ── keychainDelete ──────────────────────────────────────────────────────────

  describe('keychainDelete', () => {
    it('sends keychain_delete with { service, key } and resolves', async () => {
      const captured: Captured[] = [];

      mockIPC((cmd, args) => {
        captured.push({ cmd, args });
        if (cmd === 'keychain_delete') return undefined;
        throw new Error(`unexpected command: ${cmd}`);
      });

      const { keychainDelete } = await import('@/platform/utils/tauri-commands');
      await keychainDelete('to-delete', 'my-service');

      const delCall = captured.find((c) => c.cmd === 'keychain_delete');
      expect(delCall, 'keychain_delete was not invoked').toBeDefined();

      // Must NOT include 'value' -- that would be the wrong arg shape.
      expect(delCall!.args).toEqual({
        service: 'my-service',
        key: 'to-delete',
      });
      expect((delCall!.args as Record<string, unknown>)['value']).toBeUndefined();
    });
  });
});
