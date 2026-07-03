// Backend Factory
// Detects runtime environment and returns appropriate FSBackend

import type { FSBackend, SetRootPathOptions } from './types';
import { WebFSBackend } from './WebFSBackend';
import { TauriFSBackend } from './TauriFSBackend';
import { VaultFSBackend } from './VaultFSBackend';
import { vaultStatus } from '@/platform/firm/vault/vaultClient';
import { migrateWorkspaceDataDir } from '@/platform/utils/tauri-commands';

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
    // also migrates the data stores before audit/mail/RAG open them. Idempotent
    // + fail-safe on the Rust side; best-effort (never blocks opening).
    try {
      const report = await migrateWorkspaceDataDir(workspacePath);
      if (report) console.log('[data-dir-migration]', report);
    } catch (err) {
      console.warn('[data-dir-migration] failed (using data in place):', err);
    }

    // Wrap in VaultFSBackend if the workspace has an active vault.
    // The vault_status command is cheap (just reads .lantern-vault.json).
    // Browser/Web backend is NEVER wrapped — vault is Tauri-only.
    try {
      const status = await vaultStatus(workspacePath);
      if (status.enabled) {
        console.log('[BackendFactory] Vault enabled for workspace, wrapping with VaultFSBackend');
        return new VaultFSBackend(backend, workspacePath);
      }
    } catch (err) {
      // Non-fatal: if vault_status fails (e.g. command not registered yet),
      // fall through and return the plain TauriFSBackend.
      console.warn('[BackendFactory] vault_status check failed, using plain TauriFSBackend:', err);
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
