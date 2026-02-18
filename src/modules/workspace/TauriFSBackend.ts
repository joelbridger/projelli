// Tauri File System Backend
// Implements FSBackend using Tauri's fs plugin

import type { FSBackend, FileStat } from './types';
import { FileOperationError } from './types';
import type { FileNode } from '@/types/workspace';

// Tauri fs plugin types (imported dynamically to avoid browser errors)
interface TauriFsModule {
  readTextFile(path: string, options?: { baseDir?: number }): Promise<string>;
  readFile(path: string, options?: { baseDir?: number }): Promise<Uint8Array>;
  writeTextFile(path: string, contents: string, options?: { baseDir?: number }): Promise<void>;
  writeFile(path: string, contents: Uint8Array, options?: { baseDir?: number }): Promise<void>;
  exists(path: string, options?: { baseDir?: number }): Promise<boolean>;
  remove(path: string, options?: { baseDir?: number; recursive?: boolean }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  copyFile(source: string, destination: string): Promise<void>;
  mkdir(path: string, options?: { baseDir?: number; recursive?: boolean }): Promise<void>;
  readDir(path: string, options?: { baseDir?: number }): Promise<DirEntry[]>;
  stat(path: string, options?: { baseDir?: number }): Promise<FileInfo>;
  lstat(path: string, options?: { baseDir?: number }): Promise<FileInfo>;
}

interface DirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
}

interface FileInfo {
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

/**
 * Check if running in Tauri environment
 */
export function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

/**
 * Get the Tauri fs module (dynamically imported)
 */
async function getTauriFsModule(): Promise<TauriFsModule> {
  if (!isTauriEnvironment()) {
    throw new Error('TauriFSBackend is only available in Tauri environment');
  }
  // Dynamic import to avoid bundling issues in browser
  const fs = await import('@tauri-apps/plugin-fs');
  return fs as unknown as TauriFsModule;
}

/**
 * TauriFSBackend implements FSBackend using Tauri's file system plugin
 */
export class TauriFSBackend implements FSBackend {
  private rootPath: string = '';
  private fsModule: TauriFsModule | null = null;

  /**
   * Initialize the Tauri FS module
   */
  private async ensureModule(): Promise<TauriFsModule> {
    if (!this.fsModule) {
      this.fsModule = await getTauriFsModule();
    }
    return this.fsModule;
  }

  /**
   * Resolve a relative path to an absolute path within the workspace
   */
  private resolvePath(relativePath: string): string {
    if (!this.rootPath) {
      throw new Error('Workspace root not set');
    }

    // If empty string or '.', return root path
    if (relativePath === '' || relativePath === '.') {
      return this.rootPath;
    }

    // Detect platform separator from rootPath
    const isWindows = this.rootPath.includes('\\');
    const separator = isWindows ? '\\' : '/';

    // Normalize the relative path to use the same separator as rootPath
    let normalized = relativePath.replace(/[\/\\]/g, separator);

    // Remove leading separator if present
    if (normalized.startsWith(separator)) {
      normalized = normalized.substring(1);
    }

    // Join with root path using native separator
    return `${this.rootPath}${separator}${normalized}`;
  }

  getRootPath(): string {
    return this.rootPath;
  }

  async setRootPath(path: string): Promise<void> {
    const fs = await this.ensureModule();

    console.log('[TauriFSBackend] setRootPath called with:', path);

    // Normalize path - keep backslashes on Windows
    const normalizedPath = path.replace(/\/$/, '');

    console.log('[TauriFSBackend] Normalized path:', normalizedPath);

    // Verify the path exists
    try {
      const pathExists = await fs.exists(normalizedPath);
      console.log('[TauriFSBackend] Path exists check:', pathExists);

      if (!pathExists) {
        throw new FileOperationError(
          `Workspace path does not exist: ${normalizedPath}`,
          normalizedPath,
          'stat'
        );
      }
    } catch (err) {
      console.error('[TauriFSBackend] Error checking path existence:', err);
      throw err;
    }

    this.rootPath = normalizedPath;
    console.log('[TauriFSBackend] Root path set successfully to:', this.rootPath);
  }

  async read(path: string): Promise<string> {
    const fs = await this.ensureModule();
    const absolutePath = this.resolvePath(path);

    try {
      return await fs.readTextFile(absolutePath);
    } catch (err) {
      throw new FileOperationError(
        `Failed to read file: ${path}`,
        path,
        'read',
        err instanceof Error ? err : undefined
      );
    }
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const fs = await this.ensureModule();
    const absolutePath = this.resolvePath(path);

    try {
      const data = await fs.readFile(absolutePath);
      return data.buffer;
    } catch (err) {
      throw new FileOperationError(
        `Failed to read binary file: ${path}`,
        path,
        'read',
        err instanceof Error ? err : undefined
      );
    }
  }

  async write(path: string, content: string): Promise<void> {
    const fs = await this.ensureModule();
    const absolutePath = this.resolvePath(path);

    try {
      await fs.writeTextFile(absolutePath, content);
    } catch (err) {
      throw new FileOperationError(
        `Failed to write file: ${path}`,
        path,
        'write',
        err instanceof Error ? err : undefined
      );
    }
  }

  async writeBinary(path: string, content: ArrayBuffer): Promise<void> {
    const fs = await this.ensureModule();
    const absolutePath = this.resolvePath(path);

    try {
      await fs.writeFile(absolutePath, new Uint8Array(content));
    } catch (err) {
      throw new FileOperationError(
        `Failed to write binary file: ${path}`,
        path,
        'write',
        err instanceof Error ? err : undefined
      );
    }
  }

  async exists(path: string): Promise<boolean> {
    const fs = await this.ensureModule();
    const absolutePath = this.resolvePath(path);

    console.log('[TauriFSBackend] exists() called with path:', path, 'absolutePath:', absolutePath);

    try {
      const result = await fs.exists(absolutePath);
      console.log('[TauriFSBackend] exists() result:', result);
      return result;
    } catch (err) {
      console.error('[TauriFSBackend] exists() error:', err);
      return false;
    }
  }

  async delete(path: string): Promise<void> {
    const fs = await this.ensureModule();
    const absolutePath = this.resolvePath(path);

    try {
      await fs.remove(absolutePath, { recursive: true });
    } catch (err) {
      throw new FileOperationError(
        `Failed to delete: ${path}`,
        path,
        'delete',
        err instanceof Error ? err : undefined
      );
    }
  }

  async move(from: string, to: string): Promise<void> {
    const fs = await this.ensureModule();
    const fromPath = this.resolvePath(from);
    const toPath = this.resolvePath(to);

    try {
      await fs.rename(fromPath, toPath);
    } catch (err) {
      throw new FileOperationError(
        `Failed to move from ${from} to ${to}`,
        from,
        'move',
        err instanceof Error ? err : undefined
      );
    }
  }

  async copy(from: string, to: string): Promise<void> {
    const fs = await this.ensureModule();
    const fromPath = this.resolvePath(from);
    const toPath = this.resolvePath(to);

    try {
      // Check if source is a directory
      const stat = await fs.stat(fromPath);
      if (stat.isDirectory) {
        // Recursively copy directory
        await this.copyDirectory(fromPath, toPath, fs);
      } else {
        await fs.copyFile(fromPath, toPath);
      }
    } catch (err) {
      throw new FileOperationError(
        `Failed to copy from ${from} to ${to}`,
        from,
        'copy',
        err instanceof Error ? err : undefined
      );
    }
  }

  private async copyDirectory(from: string, to: string, fs: TauriFsModule): Promise<void> {
    // Detect platform separator
    const isWindows = from.includes('\\');
    const separator = isWindows ? '\\' : '/';

    // Create target directory
    await fs.mkdir(to, { recursive: true });

    // Read source directory
    const entries = await fs.readDir(from);

    // Copy each entry
    for (const entry of entries) {
      const sourcePath = `${from}${separator}${entry.name}`;
      const destPath = `${to}${separator}${entry.name}`;

      if (entry.isDirectory) {
        await this.copyDirectory(sourcePath, destPath, fs);
      } else {
        await fs.copyFile(sourcePath, destPath);
      }
    }
  }

  async rename(path: string, newName: string): Promise<void> {
    const fs = await this.ensureModule();
    const absolutePath = this.resolvePath(path);

    // Detect platform separator
    const isWindows = absolutePath.includes('\\');
    const separator = isWindows ? '\\' : '/';

    // Get parent directory and construct new path
    const lastSep = Math.max(absolutePath.lastIndexOf('/'), absolutePath.lastIndexOf('\\'));
    const parentPath = absolutePath.substring(0, lastSep);
    const newPath = `${parentPath}${separator}${newName}`;

    try {
      await fs.rename(absolutePath, newPath);
    } catch (err) {
      throw new FileOperationError(
        `Failed to rename ${path} to ${newName}`,
        path,
        'rename',
        err instanceof Error ? err : undefined
      );
    }
  }

  async mkdir(path: string): Promise<void> {
    const fs = await this.ensureModule();
    const absolutePath = this.resolvePath(path);

    console.log('[TauriFSBackend] mkdir() called with path:', path, 'absolutePath:', absolutePath);

    try {
      await fs.mkdir(absolutePath, { recursive: true });
      console.log('[TauriFSBackend] mkdir() succeeded');
    } catch (err) {
      console.error('[TauriFSBackend] mkdir() failed for path:', path, 'absolutePath:', absolutePath, 'error:', err);
      throw new FileOperationError(
        `Failed to create directory: ${path}`,
        path,
        'mkdir',
        err instanceof Error ? err : undefined
      );
    }
  }

  async list(path: string): Promise<FileNode[]> {
    const fs = await this.ensureModule();
    const absolutePath = this.resolvePath(path);

    console.log('[TauriFSBackend] list() called with path:', path, 'absolutePath:', absolutePath);

    try {
      const entries = await fs.readDir(absolutePath);
      const nodes: FileNode[] = [];

      for (const entry of entries) {
        // Skip hidden files starting with .
        if (entry.name.startsWith('.') && entry.name !== '.trash') {
          continue;
        }

        // Use forward slashes for internal path representation (cross-platform)
        const entryPath = path ? `${path}/${entry.name}` : entry.name;

        if (entry.isDirectory) {
          // Recursively list subdirectories
          const children = await this.list(entryPath);
          nodes.push({
            id: entryPath,
            name: entry.name,
            type: 'folder',
            path: entryPath,
            children,
          });
        } else if (entry.isFile) {
          nodes.push({
            id: entryPath,
            name: entry.name,
            type: 'file',
            path: entryPath,
          });
        }
      }

      console.log('[TauriFSBackend] list() found', nodes.length, 'entries');

      // Sort: folders first, then alphabetically
      return nodes.sort((a, b) => {
        if (a.type === b.type) {
          return a.name.localeCompare(b.name);
        }
        return a.type === 'folder' ? -1 : 1;
      });
    } catch (err) {
      console.error('[TauriFSBackend] list() failed for path:', path, 'absolutePath:', absolutePath, 'error:', err);
      throw new FileOperationError(
        `Failed to list directory: ${path}`,
        path,
        'list',
        err instanceof Error ? err : undefined
      );
    }
  }

  async stat(path: string): Promise<FileStat> {
    const fs = await this.ensureModule();
    const absolutePath = this.resolvePath(path);

    console.log('[TauriFSBackend] stat() called with path:', path);
    console.log('[TauriFSBackend] Resolved to absolutePath:', absolutePath);

    try {
      const stat = await fs.stat(absolutePath);

      // Extract file name - handle both forward and backslashes
      const lastSlash = Math.max(absolutePath.lastIndexOf('/'), absolutePath.lastIndexOf('\\'));
      const name = lastSlash >= 0 ? absolutePath.substring(lastSlash + 1) : absolutePath;

      console.log('[TauriFSBackend] stat() succeeded, name:', name, 'type:', stat.isDirectory ? 'folder' : 'file');

      return {
        path,
        name,
        type: stat.isDirectory ? 'folder' : 'file',
        size: stat.size,
        modifiedAt: stat.mtime ? new Date(stat.mtime) : new Date(),
        createdAt: stat.ctime ? new Date(stat.ctime) : new Date(),
        isSymlink: stat.isSymlink,
      };
    } catch (err) {
      console.error('[TauriFSBackend] stat() failed for path:', path, 'absolutePath:', absolutePath, 'error:', err);
      throw new FileOperationError(
        `Failed to stat: ${path} (absolute: ${absolutePath})`,
        path,
        'stat',
        err instanceof Error ? err : undefined
      );
    }
  }

  async isSymlink(path: string): Promise<boolean> {
    const fs = await this.ensureModule();
    const absolutePath = this.resolvePath(path);

    try {
      const stat = await fs.lstat(absolutePath);
      return stat.isSymlink;
    } catch {
      return false;
    }
  }

  async resolveSymlink(path: string): Promise<string> {
    // Tauri doesn't have a direct readlink function
    // For now, return the path as-is (symlinks are blocked by security layer anyway)
    return path;
  }
}

/**
 * Create a TauriFSBackend instance
 */
export function createTauriFSBackend(): TauriFSBackend {
  return new TauriFSBackend();
}
