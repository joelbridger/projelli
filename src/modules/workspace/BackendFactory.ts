// Backend Factory
// Detects runtime environment and returns appropriate FSBackend

import type { FSBackend } from './types';
import { WebFSBackend } from './WebFSBackend';
import { TauriFSBackend } from './TauriFSBackend';
import { VaultFSBackend } from './VaultFSBackend';
import { vaultStatus } from '@/modules/vault/vaultClient';

/**
 * Detects if running in Tauri environment
 * @returns true if __TAURI__ global is present
 */
export function isTauriEnvironment(): boolean {
  // @ts-ignore - __TAURI__ is injected by Tauri runtime
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

/**
 * Creates appropriate FSBackend based on runtime environment
 *
 * In Tauri: Returns TauriFSBackend (native filesystem)
 * In Browser: Returns WebFSBackend (File System Access API)
 *
 * @param workspacePath - Optional workspace path (used by TauriFSBackend)
 * @returns FSBackend instance
 */
export async function createFSBackend(workspacePath?: string): Promise<FSBackend> {
  const isTauri = isTauriEnvironment();

  if (isTauri) {
    console.log('[BackendFactory] Tauri environment detected, using TauriFSBackend');
    console.log('[BackendFactory] Workspace path:', workspacePath);
    if (!workspacePath) {
      throw new Error('TauriFSBackend requires a workspace path');
    }
    const backend = new TauriFSBackend();
    await backend.setRootPath(workspacePath);
    console.log('[BackendFactory] Backend initialized successfully');

    // Wrap in VaultFSBackend if the workspace has an active vault.
    // The vault_status command is cheap (just reads .keepance-vault.json).
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
