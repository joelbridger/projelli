/**
 * BackendFactory — QA-33 regression coverage.
 *
 * createFSBackend() used to call vaultStatus() with NO timeout at all. On a
 * machine where the OS credential service is stopped/unreachable (e.g.
 * Windows' `VaultSvc`), the underlying keychain read can hang far longer than
 * this check should ever take — and since nothing bounded it here, the hang
 * was only ever caught by the OUTER 30s workspace-open timeout in
 * useWorkspaceLifecycle.ts, which aborted the ENTIRE open attempt instead of
 * letting this check settle quickly. These tests pin down that
 * createFSBackend now bounds the check itself.
 *
 * codex-review (2026-07-04) caught that the original fix still silently fell
 * through to the plain (unwrapped) backend on ANY vaultStatus() failure —
 * which, now that the failure is reachable in ~5s instead of practically
 * never, could open a genuinely encrypted workspace with NO encryption
 * (reads show ciphertext; saves write PLAINTEXT into the vault). It must
 * fail closed (throw) instead, so the caller's existing "workspace failed to
 * open" error handling takes over.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { setRootPathMock, vaultStatusMock } = vi.hoisted(() => ({
  setRootPathMock: vi.fn().mockResolvedValue(undefined),
  vaultStatusMock: vi.fn(),
}));

vi.mock('./TauriFSBackend', () => ({
  TauriFSBackend: class {
    setRootPath = setRootPathMock;
  },
}));

vi.mock('./VaultFSBackend', () => ({
  VaultFSBackend: vi.fn().mockImplementation(function (this: { __vaultWrapped: unknown }, inner: unknown) {
    this.__vaultWrapped = inner;
  }),
}));

vi.mock('@/platform/utils/tauri-commands', () => ({
  migrateWorkspaceDataDir: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/platform/firm/vault/vaultClient', () => ({
  vaultStatus: vaultStatusMock,
}));

import { createFSBackend } from './BackendFactory';
import { VaultFSBackend } from './VaultFSBackend';

describe('createFSBackend — QA-33 vault-status bound', () => {
  beforeEach(() => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};
    vaultStatusMock.mockReset();
    setRootPathMock.mockClear();
    vi.mocked(VaultFSBackend).mockClear();
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
  });

  it('a hung vaultStatus() rejects (fails closed) within its bound, instead of opening unwrapped', async () => {
    vi.useFakeTimers();
    vaultStatusMock.mockReturnValue(new Promise(() => {})); // never resolves

    const pending = createFSBackend('/some/workspace');
    // Attach a rejection handler immediately so Node doesn't flag this as an
    // unhandled rejection while the fake timer advances below.
    const settled = pending.catch((err: unknown) => ({ threw: true, err }));
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await settled;

    expect(result).toMatchObject({ threw: true });
    expect(VaultFSBackend).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('a fast, healthy vaultStatus() still wraps the backend when the vault is enabled', async () => {
    vaultStatusMock.mockResolvedValue({ enabled: true, locked: false, hasEscrow: false, vaultId: 'v1' });

    await createFSBackend('/some/workspace');

    expect(VaultFSBackend).toHaveBeenCalledTimes(1);
  });

  it('a fast, healthy vaultStatus() with no vault enabled returns the plain backend', async () => {
    vaultStatusMock.mockResolvedValue({ enabled: false, locked: false, hasEscrow: false, vaultId: null });

    const backend = await createFSBackend('/some/workspace');

    expect(VaultFSBackend).not.toHaveBeenCalled();
    expect(backend).toBeDefined();
  });

  it('a vaultStatus() rejection fails closed (throws) rather than opening unwrapped', async () => {
    vaultStatusMock.mockRejectedValue(new Error('command not registered'));

    await expect(createFSBackend('/some/workspace')).rejects.toThrow('command not registered');
    expect(VaultFSBackend).not.toHaveBeenCalled();
  });
});
