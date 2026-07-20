/**
 * NO-SILENT-DEMOTION proof — FILESYSTEM backend picker (Amplifier Phase-B, c34).
 *
 * Context: the `withGlobalTauri:false` flip (DEFERRED to the packaged bench —
 * NOT performed in this lane) removes the `window.__TAURI__` convenience global
 * but KEEPS `window.__TAURI__INTERNALS__` (Tauri v2's real IPC transport, always
 * injected). Before the durable-detection migration, `isTauriEnvironment()` read
 * ONLY `window.__TAURI__`, so the flip would make it return `false` and the app
 * would silently pick the browser `WebFSBackend` (loose-file storage) instead of
 * the native `TauriFSBackend` — a security regression with NO crash.
 *
 * This suite pins that, AFTER the migration, the picker still resolves NATIVE in
 * the post-flip environment (only `__TAURI_INTERNALS__` present).
 *
 * NECESSARY-BUT-NOT-SUFFICIENT (HD-3): this drives the jsdom environment by
 * SIMULATING the injected globals. The demotion is ultimately a
 * native-present-vs-absent fallback in the real webview, so FULL confirmation is
 * owed on the PACKAGED BINARY at the bench (assert `__TAURI__ === undefined` yet
 * the real workspace still reads/writes through TauriFSBackend). This suite
 * proves the DETECTION LOGIC; only the bench proves the shipped binary.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Stub the native backend so the factory's "native" branch is observable
// without a real Tauri runtime (mirrors BackendFactory.test.ts). The stub class
// is created inside vi.hoisted so it exists when the hoisted vi.mock factory runs.
const { setRootPathMock, vaultStatusMock, migrateWorkspaceDataDirMock, TauriFSBackendStub } = vi.hoisted(
  () => {
    const setRootPathMock = vi.fn();
    class TauriFSBackendStub {
      setRootPath = setRootPathMock;
    }
    return {
      setRootPathMock,
      vaultStatusMock: vi.fn(),
      migrateWorkspaceDataDirMock: vi.fn(),
      TauriFSBackendStub,
    };
  },
);
vi.mock('./TauriFSBackend', () => ({ TauriFSBackend: TauriFSBackendStub }));
vi.mock('./VaultFSBackend', () => ({ VaultFSBackend: vi.fn() }));
vi.mock('@/platform/utils/tauri-commands', () => ({ migrateWorkspaceDataDir: migrateWorkspaceDataDirMock }));
vi.mock('@/platform/firm/vault/vaultClient', () => ({ vaultStatus: vaultStatusMock }));
// Stub the fs plugin module so getTauriFsModule()'s dynamic import resolves
// cleanly in jsdom (we exercise its GUARD, not the real plugin).
vi.mock('@tauri-apps/plugin-fs', () => ({ __stub: true }));

import { createFSBackend, isTauriEnvironment } from './BackendFactory';
import { WebFSBackend } from './WebFSBackend';
import { getTauriFsModule } from './tauriFsPlugin';

type MutWin = { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown };
const w = () => window as unknown as MutWin;

/** withGlobalTauri:false (the DEFERRED flip) → internals present, global absent. */
function setPostFlipTauriEnv() {
  w().__TAURI_INTERNALS__ = {};
  delete w().__TAURI__;
}
/** withGlobalTauri:true (today) → both present. */
function setCurrentTauriEnv() {
  w().__TAURI_INTERNALS__ = {};
  w().__TAURI__ = {};
}
/** Browser → neither present (this is the demotion target we must NOT hit in Tauri). */
function setBrowserEnv() {
  delete w().__TAURI_INTERNALS__;
  delete w().__TAURI__;
}

beforeEach(() => {
  setRootPathMock.mockReset().mockResolvedValue(undefined);
  vaultStatusMock.mockReset().mockResolvedValue({ enabled: false, locked: false, hasEscrow: false, vaultId: null });
  migrateWorkspaceDataDirMock.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  setBrowserEnv();
});

describe('FS picker — isTauriEnvironment() resolves NATIVE across the flip', () => {
  it('post-flip env (only __TAURI_INTERNALS__) → NATIVE (true)', () => {
    setPostFlipTauriEnv();
    expect(isTauriEnvironment()).toBe(true);
  });

  it('current env (both globals) → NATIVE (true) — behavior-preserving today', () => {
    setCurrentTauriEnv();
    expect(isTauriEnvironment()).toBe(true);
  });

  it('browser env (neither global) → WEB (false)', () => {
    setBrowserEnv();
    expect(isTauriEnvironment()).toBe(false);
  });
});

describe('FS factory — createFSBackend() picks the native backend across the flip', () => {
  it('post-flip env → TauriFSBackend (not WebFSBackend)', async () => {
    setPostFlipTauriEnv();
    const backend = await createFSBackend('/ws');
    expect(backend).toBeInstanceOf(TauriFSBackendStub);
    expect(backend).not.toBeInstanceOf(WebFSBackend);
    expect(setRootPathMock).toHaveBeenCalledWith('/ws', undefined);
  });

  it('browser env → WebFSBackend (the demotion path, correct only in a real browser)', async () => {
    setBrowserEnv();
    const backend = await createFSBackend();
    expect(backend).toBeInstanceOf(WebFSBackend);
  });
});

describe('FS plugin — getTauriFsModule() guard follows the durable check', () => {
  it('post-flip env → resolves (native fs access allowed)', async () => {
    setPostFlipTauriEnv();
    await expect(getTauriFsModule()).resolves.toBeDefined();
  });

  it('browser env → throws (fs access refused)', async () => {
    setBrowserEnv();
    await expect(getTauriFsModule()).rejects.toThrow('only available in the desktop app');
  });
});

describe('NEGATIVE CONTROL — the pre-migration global-only check WOULD demote', () => {
  it('post-flip env: legacy `__TAURI__`-only predicate is false, durable predicate is true', () => {
    setPostFlipTauriEnv();
    // Exactly the pre-migration expression this lane replaced:
    const legacyGlobalOnly = typeof window !== 'undefined' && '__TAURI__' in window;
    // The old check sees "browser" → would have silently picked WebFSBackend.
    expect(legacyGlobalOnly).toBe(false);
    // The migrated durable check preserves native resolution.
    expect(isTauriEnvironment()).toBe(true);
  });
});
