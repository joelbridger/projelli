// Type declarations for Tauri plugins
// These are only used when running in Tauri environment

declare module '@tauri-apps/plugin-fs' {
  export function readTextFile(path: string, options?: { baseDir?: number }): Promise<string>;
  export function readFile(path: string, options?: { baseDir?: number }): Promise<Uint8Array>;
  export function writeTextFile(path: string, contents: string, options?: { baseDir?: number }): Promise<void>;
  export function writeFile(path: string, contents: Uint8Array, options?: { baseDir?: number }): Promise<void>;
  export function exists(path: string, options?: { baseDir?: number }): Promise<boolean>;
  export function remove(path: string, options?: { baseDir?: number; recursive?: boolean }): Promise<void>;
  export function rename(oldPath: string, newPath: string): Promise<void>;
  export function copyFile(source: string, destination: string): Promise<void>;
  export function mkdir(path: string, options?: { baseDir?: number; recursive?: boolean }): Promise<void>;
  export function readDir(path: string, options?: { baseDir?: number }): Promise<Array<{
    name: string;
    isDirectory: boolean;
    isFile: boolean;
    isSymlink: boolean;
  }>>;
  export function stat(path: string, options?: { baseDir?: number }): Promise<{
    isFile: boolean;
    isDirectory: boolean;
    isSymlink: boolean;
    size: number;
    readonly: boolean;
    fileType: 'file' | 'dir' | 'symlink' | 'other';
    mtime: number | null;
    atime: number | null;
    ctime: number | null;
  }>;
  export function lstat(path: string, options?: { baseDir?: number }): Promise<{
    isFile: boolean;
    isDirectory: boolean;
    isSymlink: boolean;
    size: number;
    readonly: boolean;
    fileType: 'file' | 'dir' | 'symlink' | 'other';
    mtime: number | null;
    atime: number | null;
    ctime: number | null;
  }>;
}
