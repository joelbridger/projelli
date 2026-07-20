/**
 * Single import boundary for `@tauri-apps/plugin-fs`.
 *
 * Tauri grants this plugin broad disk access, so app code should prefer
 * `WorkspaceService` for normal workspace reads/writes. Use this wrapper only
 * for explicit user-picked files, export/temp files, or low-level fs backends.
 */

export interface TauriDirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
}

export interface TauriFileInfo {
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  readonly: boolean;
  fileType: 'file' | 'dir' | 'symlink' | 'other';
  mtime: number | null;
  atime: number | null;
  ctime: number | null;
}

export interface TauriFsModule {
  readTextFile(path: string, options?: { baseDir?: number }): Promise<string>;
  readFile(path: string, options?: { baseDir?: number }): Promise<Uint8Array>;
  writeTextFile(path: string, contents: string, options?: { baseDir?: number }): Promise<void>;
  writeFile(path: string, contents: Uint8Array, options?: { baseDir?: number }): Promise<void>;
  exists(path: string, options?: { baseDir?: number }): Promise<boolean>;
  remove(path: string, options?: { baseDir?: number; recursive?: boolean }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  copyFile(source: string, destination: string): Promise<void>;
  mkdir(path: string, options?: { baseDir?: number; recursive?: boolean }): Promise<void>;
  readDir(path: string, options?: { baseDir?: number }): Promise<TauriDirEntry[]>;
  stat(path: string, options?: { baseDir?: number }): Promise<TauriFileInfo>;
  lstat(path: string, options?: { baseDir?: number }): Promise<TauriFileInfo>;
}

export async function getTauriFsModule(): Promise<TauriFsModule> {
  // Durable Tauri detection: only throw when NEITHER the durable
  // `__TAURI_INTERNALS__` transport NOR the legacy `__TAURI__` global is
  // present. Using `__TAURI__` alone here would start throwing (breaking native
  // fs access) after a future `withGlobalTauri:false` flip. Mirrors
  // useWorkspaceLifecycle's negated-superset guard.
  if (
    typeof window !== 'undefined' &&
    !('__TAURI_INTERNALS__' in window) &&
    !('__TAURI__' in window)
  ) {
    throw new Error('Tauri filesystem access is only available in the desktop app');
  }
  const fs = await import('@tauri-apps/plugin-fs');
  return fs as unknown as TauriFsModule;
}

export async function readTauriFile(path: string): Promise<Uint8Array> {
  return (await getTauriFsModule()).readFile(path);
}

export async function readTauriTextFile(path: string): Promise<string> {
  return (await getTauriFsModule()).readTextFile(path);
}

export async function writeTauriFile(path: string, content: ArrayBuffer | Uint8Array): Promise<void> {
  const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
  await (await getTauriFsModule()).writeFile(path, bytes);
}

export async function writeTauriTextFile(path: string, content: string): Promise<void> {
  await (await getTauriFsModule()).writeTextFile(path, content);
}
