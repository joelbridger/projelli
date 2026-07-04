// Backend Factory
// Detects runtime environment and returns appropriate FSBackend

import type { FSBackend, SetRootPathOptions } from './types';
import { WebFSBackend } from './WebFSBackend';
import { TauriFSBackend } from './TauriFSBackend';
import { VaultFSBackend } from './VaultFSBackend';
import { vaultStatus } from '@/platform/firm/vault/vaultClient';
import { migrateWorkspaceDataDir } from '@/platform/utils/tauri-commands';
import { withTimeout } from '@/lib/withTimeout';

// QA-33: this used to be a bare, unbounded `await vaultStatus(...)`. The Rust
// command reads the vault master key from the OS keychain, which is a
// blocking OS call — if the underlying credential service is stopped or
// unreachable (e.g. Windows' `VaultSvc`), that call can hang far longer than
// this check should ever take. Without a bound here, the hang was only ever
// caught by handleOpenRecentProject's *outer* 30s workspace-open timeout,
// which aborted the ENTIRE open attempt instead of letting this check's own
// existing fallback (open unwrapped) run. Bounded to the same 5s budget as
// the sibling preflight in App.tsx's `isWorkspaceVaultLocked`, which checks
// the identical command for the identical reason.
const VAULT_STATUS_CHECK_TIMEOUT_MS = 5_000;

/**
 * Detects if running in Tauri environment
 * @returns true if __TAURI__ global is present
 */
export function isTauriEnvironment(): boolean {
  // __TAURI__ is injected by the Tauri runtime; not in the `Window` type.
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

/**
 * Creates appropriate FSBackend based on runtime environment
 *
 * In Tauri: Returns TauriFSBackend (native filesystem)
 * In Browser: Returns WebFSBackend (File System Access API)
 *
 * @param workspacePath - Optional workspace path (used by TauriFSBackend)
 * @param options - setRootPath options (e.g. `createIfMissing` for the
 *                  create-new-workspace flow). Defaults to strict (must exist).
 * @returns FSBackend instance
 */
export async function createFSBackend(
  workspacePath?: string,
  options?: SetRootPathOptions
): Promise<FSBackend> {
  const isTauri = isTauriEnvironment();

  if (isTauri) {
    console.log('[BackendFactory] Tauri environment detected, using TauriFSBackend');
    console.log('[BackendFactory] Workspace path:', workspacePath);
    if (!workspacePath) {
      throw new Error('TauriFSBackend requires a workspace path');
    }
    const backend = new TauriFSBackend();
    await backend.setRootPath(workspacePath, options);
    console.log('[BackendFactory] Backend initialized successfully');

    // Data-folder rename migration (`.keepance` → `.lantern`) — MUST run here,
    // the single desktop backend factory every open path funnels through, and
    // BEFORE vault_status below. A legacy workspace still has its vault metadata
    // at `.keepance-vault.json`; migrating it first means vault_status sees the
    // renamed `.lantern-vault.json` and correctly wraps the backend, instead of
    // opening a vaulted workspace unwrapped (ciphertext) for a session. This
    // also migrates the data stores before audit/mail/RAG open them.
    //
    // Deliberately NOT time-bounded (coordinator review, 2026-07-04): unlike
    // vault_status (a pure read), this is a MUTATING rename on disk. A
    // withTimeout() here would only make the FRONTEND stop waiting — the
    // Rust-side rename keeps running regardless — so a "timed out" migration
    // could still be mid-rename while this same function goes on to open
    // audit/mail/RAG stores against a data dir that is neither fully
    // `.keepance` nor fully `.lantern`, and WorkspaceSelector's own migration
    // call (which runs before this one, on the manual-open path) could end up
    // racing a SECOND migration attempt against the same still-in-flight
    // rename. Honest-slow beats fast-corrupt: always wait for the real
    // rename to finish (or fail) before any store opens. The try/catch below
    // still makes a genuine FAILURE non-fatal (best-effort, "using data in
    // place") — only an artificial abandon-while-still-running is unsafe.
    try {
      const report = await migrateWorkspaceDataDir(workspacePath);
      if (report) console.log('[data-dir-migration]', report);
    } catch (err) {
      console.warn('[data-dir-migration] failed (using data in place):', err);
    }

    // Wrap in VaultFSBackend if the workspace has an active vault.
    // Browser/Web backend is NEVER wrapped — vault is Tauri-only.
    //
    // codex-review (2026-07-04, QA-33 follow-up): this used to swallow ANY
    // vaultStatus() failure and fall through to the plain (unwrapped)
    // backend. `vault_status`'s Rust implementation only ever touches the
    // keychain AFTER confirming `.lantern-vault.json` exists on disk (a pure,
    // near-instant filesystem check) — so a failure here can only
    // realistically happen for a workspace that IS vault-enabled (a
    // credential-service outage while reading the VMK) or a genuine plumbing
    // bug. Falling through to "unwrapped" in either case would open an
    // encrypted workspace with NO encryption: reads would show raw
    // ciphertext, and — far worse — any subsequent save/import would write
    // PLAINTEXT directly onto disk through TauriFSBackend, silently mixing
    // unencrypted files into what's supposed to be an all-encrypted vault,
    // with no way to detect or undo it afterward. Bounding this check (QA-33)
    // made that reachable in ~5s instead of practically never, which raised
    // it from a theoretical to a real risk. Fail closed instead: surface the
    // error so the caller's existing "workspace failed to open" handling
    // (an honest, dismissible message — see useWorkspaceLifecycle.ts /
    // WorkspaceSelector.tsx) takes over, rather than silently degrading
    // confidentiality.
    const status = await withTimeout(
      vaultStatus(workspacePath),
      VAULT_STATUS_CHECK_TIMEOUT_MS,
      'Checking vault status',
    );
    if (status.enabled) {
      console.log('[BackendFactory] Vault enabled for workspace, wrapping with VaultFSBackend');
      return new VaultFSBackend(backend, workspacePath);
    }

    return backend;
  } else {
    console.log('[BackendFactory] Browser environment detected, using WebFSBackend');
    return new WebFSBackend();
  }
}

/**
 * Get the name of the backend that would be used in current environment
 * Useful for UI display and debugging
 * @returns Backend name string
 */
export function getBackendName(): string {
  return isTauriEnvironment() ? 'TauriFSBackend' : 'WebFSBackend';
}
