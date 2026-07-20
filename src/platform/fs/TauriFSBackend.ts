// Tauri File System Backend
// Implements FSBackend using Tauri's fs plugin

import type { FSBackend, FileStat, SetRootPathOptions } from './types';
import { FileOperationError } from './types';
import type { FileNode } from '@/platform/types/workspace';
import { WORKSPACE_DATA_DIR } from '@/config/identity';
import {
  getTauriFsModule,
  type TauriFsModule,
} from './tauriFsPlugin';

/**
 * Check if running in Tauri environment.
 *
 * Durable detection — matches `__TAURI_INTERNALS__` (always injected by Tauri
 * v2, independent of `withGlobalTauri`) OR the legacy `__TAURI__` global, so it
 * survives a future `withGlobalTauri:false` flip without demoting to browser
 * mode. See BackendFactory.isTauriEnvironment for the full rationale.
 */
export function isTauriEnvironment(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
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
    let normalized = relativePath.replace(/[/\\]/g, separator);

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

  async setRootPath(path: string, options?: SetRootPathOptions): Promise<void> {
    const fs = await this.ensureModule();

    console.log('[TauriFSBackend] setRootPath called with:', path, 'options:', options);

    // Normalize path - keep backslashes on Windows, but strip a trailing
    // separator of EITHER kind. A Windows folder pasted/picked as `C:\WS\` would
    // otherwise keep its trailing `\`, and resolvePath would then build
    // `C:\WS\\sub` (a doubled separator). A bare drive root (`C:\`) is preserved
    // so we never turn it into `C:` (which means "current dir on C:").
    let normalizedPath = path.replace(/[/\\]+$/, '');
    if (/^[A-Za-z]:$/.test(normalizedPath)) {
      // Was a drive root like `C:\` — keep one separator.
      normalizedPath = `${normalizedPath}\\`;
    }

    console.log('[TauriFSBackend] Normalized path:', normalizedPath);

    // Verify the path exists. In the create-new-workspace flow
    // (createIfMissing), create the directory instead of throwing — this is the
    // step that actually brings a brand-new workspace folder into being, and it
    // must happen here because `initialize()` calls `setRootPath` before it can
    // create anything. The open-existing flow leaves createIfMissing unset and
    // stays strict, so a mistyped/missing path still surfaces a clear error.
    let pathExists: boolean;
    try {
      pathExists = await fs.exists(normalizedPath);
      console.log('[TauriFSBackend] Path exists check:', pathExists);
    } catch (err) {
      // `exists()` THREW — that is not the same as "the path is missing". The
      // usual cause is the folder being unreadable (permission denied, a
      // disconnected network/OneDrive location, a locked drive). Reporting
      // "path does not exist" here would be misleading, so surface the access
      // problem in plain language instead.
      console.error('[TauriFSBackend] Error checking if root path exists:', err);
      throw new FileOperationError(
        `Cannot access the workspace folder: ${normalizedPath}. ` +
          `It may be a permission issue, or a network/OneDrive location that is offline.`,
        normalizedPath,
        'stat',
        err instanceof Error ? err : undefined
      );
    }

    try {
      if (!pathExists) {
        if (options?.createIfMissing) {
          // Recursive mkdir is idempotent: safe even if the folder actually
          // exists but a platform fs.exists quirk wrongly reported it missing.
          console.log('[TauriFSBackend] Path missing — creating (createIfMissing):', normalizedPath);
          await fs.mkdir(normalizedPath, { recursive: true });
        } else {
          throw new FileOperationError(
            `Workspace path does not exist: ${normalizedPath}`,
            normalizedPath,
            'stat'
          );
        }
      }
    } catch (err) {
      console.error('[TauriFSBackend] Error preparing root path:', err);
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
      // `exists()` THREW — same distinction as `setRootPath` above: Tauri's
      // fs.exists() already resolves to `false` (never throws) for a path
      // that legitimately isn't there, so a throw here means the CHECK
      // itself failed (permission denied, a disconnected network/OneDrive
      // location, a locked drive). Swallowing that into `false` made a
      // permission failure indistinguishable from a missing file/folder —
      // surface it instead of hiding it behind a console line no one reads.
      console.error('[TauriFSBackend] exists() check failed (not "not found" — the check itself errored):', err);
      throw new FileOperationError(
        `Could not check if "${path}" exists. It may be a permission issue, or a network/OneDrive location that is offline.`,
        path,
        'stat',
        err instanceof Error ? err : undefined
      );
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
        // Only Lantern's own internal config folder is dropped here (and never
        // recursed into); the UI's hiddenNodes helper hides it everywhere too.
        // Ordinary dotfiles like .gitignore are NOT dropped at the backend — the
        // UI / "Show Hidden Files" setting decides about those (matching the
        // WebFS backend). The .trash folder keeps its existing handling.
        if (entry.name === WORKSPACE_DATA_DIR) {
          continue;
        }

        // Use forward slashes for internal path representation (cross-platform)
        const entryPath = path ? `${path}/${entry.name}` : entry.name;

        if (entry.isDirectory) {
          // Shallow (one level), exactly like WebFSBackend.list(). Real recursion
          // is owned by WorkspaceService.listRecursive, which applies the .trash /
          // dot-directory / symlink rules — so the backend never walks into a
          // huge directory (e.g. .git) regardless of how list() is called.
          nodes.push({
            id: entryPath,
            name: entry.name,
            type: 'folder',
            path: entryPath,
            children: [],
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

  resolveSymlink(_path: string): Promise<string> {
    // The filesystem plugin exposes lstat but no realpath/readlink. Returning
    // the input here would falsely claim a link had been resolved, so callers
    // with a security boundary must fail closed instead.
    return Promise.reject(new Error('Tauri filesystem plugin cannot resolve symlink targets safely.'));
  }
}

/**
 * Create a TauriFSBackend instance
 */
export function createTauriFSBackend(): TauriFSBackend {
  return new TauriFSBackend();
}
