// Backend Factory
// Detects runtime environment and returns appropriate FSBackend

import type { FSBackend } from './types';
import { WebFSBackend } from './WebFSBackend';
import { TauriFSBackend } from './TauriFSBackend';

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
