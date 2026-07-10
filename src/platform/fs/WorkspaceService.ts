// Workspace Service
// Orchestrates file operations with security validation

import type { FileNode, Workspace, RecentWorkspace } from '@/platform/types/workspace';
import type {
  FSBackend,
  FileStat,
  WorkspaceInitOptions,
} from './types';
import {
  FileOperationError,
  DEFAULT_WORKSPACE_FOLDERS,
} from './types';
import { PathValidator } from './PathValidator';
import { WORKSPACE_DATA_DIR } from '@/config/identity';

/**
 * WorkspaceService provides secure file operations
 * All operations go through path validation before reaching the backend
 */
/**
 * P1.1 (Task 6) — structural clone of a file tree so the shared cached scan can
 * be handed to multiple consumers without one mutating another's copy. FileNode
 * is plain data; only `children` needs recursion (Date/primitive fields are
 * copied by value).
 */
function cloneFileTree(nodes: FileNode[]): FileNode[] {
  return nodes.map((n) =>
    n.children ? { ...n, children: cloneFileTree(n.children) } : { ...n },
  );
}

export class WorkspaceService {
  private backend: FSBackend | null = null;
  private pathValidator: PathValidator | null = null;
  private workspace: Workspace | null = null;
  /**
   * P1.1 (Task 6) — one shared workspace tree scan.
   *
   * `getFileTree()` does a FULL recursive `backend.list()` walk (an IPC round
   * trip per directory on desktop). On workspace open, ~5 independent consumers
   * scan the tree nearly simultaneously — WorkspaceSelector, the lifecycle hook,
   * source-card loading, the content index, and the RAG PDF collector — so the
   * whole tree was walked ~5× per boot. This caches the IN-FLIGHT scan promise so
   * that concurrent boot callers share ONE underlying walk.
   *
   * Correctness: the cache is invalidated on every mutation that goes through
   * this service (write/delete/move/copy/rename/mkdir). On Tauri, the
   * `FileSystemWatcher` also refreshes it — event-driven, not polled — by
   * calling `getFileTree({ fresh: true })` whenever the Rust backend's native
   * file watcher reports a real change (which both bypasses AND repopulates
   * the cache), so a cached read is never staler than the last real change. In
   * the browser (no OS file-change events), `FileSystemWatcher` falls back to
   * a slow poll that does the same `{ fresh: true }` refresh. Each call
   * returns a structural CLONE so a consumer mutating its tree can't corrupt
   * another's.
   */
  private treeScan: Promise<FileNode[]> | null = null;

  /**
   * Initialize workspace with a backend and root path
   */
  async initialize(
    backend: FSBackend,
    rootPath: string,
    options: WorkspaceInitOptions = {}
  ): Promise<Workspace> {
    const { createIfMissing = false, createDefaultStructure = false } = options;

    console.log('[WorkspaceService] initialize() called with rootPath:', rootPath);

    // Set up backend. Pass createIfMissing so the create-new-workspace flow
    // creates the root directory instead of throwing when it is absent.
    this.backend = backend;
    await backend.setRootPath(rootPath, { createIfMissing });

    console.log('[WorkspaceService] Backend setRootPath completed');

    // Set up path validator
    this.pathValidator = new PathValidator(rootPath);

    // Check if workspace exists - use empty string to check the root itself
    console.log('[WorkspaceService] Checking if root exists by calling backend.exists("")');
    const exists = await backend.exists('');

    if (!exists) {
      if (createIfMissing) {
        // Create the root itself. Pass '' (not the absolute rootPath): the
        // backend resolves '' to the workspace root, whereas passing the
        // absolute path would be re-joined under the root (e.g.
        // `/root/<root>`). setRootPath above normally already created it when
        // createIfMissing is set; this is a defensive fallback.
        await backend.mkdir('');
      } else {
        throw new FileOperationError(
          `Workspace path does not exist: ${rootPath}`,
          rootPath,
          'stat'
        );
      }
    }

    // Verify it's a directory - use empty string to stat the root itself
    const stat = await backend.stat('');
    if (stat.type !== 'folder') {
      throw new FileOperationError(
        `Workspace path is not a directory: ${rootPath}`,
        rootPath,
        'stat'
      );
    }

    // Create default folder structure if requested
    if (createDefaultStructure) {
      await this.createDefaultStructure();
    }

    // Create workspace object
    this.workspace = {
      rootPath,
      name: this.pathValidator.getFileName(rootPath),
      createdAt: stat.createdAt,
      lastOpenedAt: new Date(),
    };

    return this.workspace;
  }

  /**
   * Create default folder structure for new workspaces
   */
  private async createDefaultStructure(): Promise<void> {
    if (!this.backend || !this.pathValidator) {
      throw new Error('Workspace not initialized');
    }

    console.log('[WorkspaceService] Creating default structure with folders:', DEFAULT_WORKSPACE_FOLDERS);

    for (const folder of DEFAULT_WORKSPACE_FOLDERS) {
      // Pass relative path to backend - it will resolve against workspace root
      const exists = await this.backend.exists(folder);
      if (!exists) {
        console.log('[WorkspaceService] Creating folder:', folder);
        await this.backend.mkdir(folder);
      } else {
        console.log('[WorkspaceService] Folder already exists:', folder);
      }
    }

    console.log('[WorkspaceService] Default structure creation complete');
  }

  /**
   * Get the current workspace
   */
  getWorkspace(): Workspace | null {
    return this.workspace;
  }

  /**
   * Get the root path
   */
  getRootPath(): string | null {
    return this.pathValidator?.getRootPath() ?? null;
  }

  /**
   * Check if workspace is initialized
   */
  isInitialized(): boolean {
    return this.backend !== null && this.pathValidator !== null;
  }

  /**
   * Stream C1 — Expose the underlying FSBackend so the marketplace install
   * pipeline can write tarballs / extract templates outside the workspace
   * security envelope (templates land under `<workspaceRoot>/.lantern/`).
   * Returns null when the workspace isn't initialized.
   */
  getBackend(): FSBackend | null {
    return this.backend;
  }

  /**
   * Close the current workspace
   */
  close(): void {
    this.backend = null;
    this.pathValidator = null;
    this.workspace = null;
  }

  // ==================== File Operations ====================

  /**
   * Read file contents as string
   */
  async readFile(path: string): Promise<string> {
    this.ensureInitialized();
    const validatedPath = this.pathValidator!.validatePath(path);
    await this.checkSymlinkSafety(validatedPath);
    const backendPath = this.toBackendPath(validatedPath);

    try {
      return await this.backend!.read(backendPath);
    } catch (error) {
      throw new FileOperationError(
        `Failed to read file: ${path}`,
        path,
        'read',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Read file contents as binary
   */
  async readFileBinary(path: string): Promise<ArrayBuffer> {
    this.ensureInitialized();
    const validatedPath = this.pathValidator!.validatePath(path);
    await this.checkSymlinkSafety(validatedPath);
    const backendPath = this.toBackendPath(validatedPath);

    try {
      return await this.backend!.readBinary(backendPath);
    } catch (error) {
      throw new FileOperationError(
        `Failed to read binary file: ${path}`,
        path,
        'read',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Write string content to file
   */
  async writeFile(path: string, content: string): Promise<void> {
    this.ensureInitialized();
    const validatedPath = this.pathValidator!.validatePath(path);
    this.validateFinalPathSegment(validatedPath);
    const backendPath = this.toBackendPath(validatedPath);

    // Ensure parent directory exists
    const parentPath = this.pathValidator!.getParentPath(validatedPath);
    const backendParentPath = this.toBackendPath(parentPath);
    const parentExists = await this.backend!.exists(backendParentPath);
    if (!parentExists) {
      await this.backend!.mkdir(backendParentPath);
    }

    try {
      await this.backend!.write(backendPath, content);
      this.invalidateTree();
    } catch (error) {
      throw new FileOperationError(
        `Failed to write file: ${path}`,
        path,
        'write',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Write binary content to file
   */
  async writeFileBinary(path: string, content: ArrayBuffer): Promise<void> {
    this.ensureInitialized();
    const validatedPath = this.pathValidator!.validatePath(path);
    this.validateFinalPathSegment(validatedPath);
    const backendPath = this.toBackendPath(validatedPath);

    // Ensure parent directory exists
    const parentPath = this.pathValidator!.getParentPath(validatedPath);
    const backendParentPath = this.toBackendPath(parentPath);
    const parentExists = await this.backend!.exists(backendParentPath);
    if (!parentExists) {
      await this.backend!.mkdir(backendParentPath);
    }

    try {
      await this.backend!.writeBinary(backendPath, content);
      this.invalidateTree();
    } catch (error) {
      throw new FileOperationError(
        `Failed to write binary file: ${path}`,
        path,
        'write',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Check if path exists
   */
  async exists(path: string): Promise<boolean> {
    this.ensureInitialized();
    const validatedPath = this.pathValidator!.validatePath(path);
    const backendPath = this.toBackendPath(validatedPath);
    return this.backend!.exists(backendPath);
  }

  /**
   * Delete file or folder
   */
  async delete(path: string): Promise<void> {
    this.ensureInitialized();
    const validatedPath = this.pathValidator!.validatePath(path);
    const backendPath = this.toBackendPath(validatedPath);

    try {
      await this.backend!.delete(backendPath);
      this.invalidateTree();
    } catch (error) {
      throw new FileOperationError(
        `Failed to delete: ${path}`,
        path,
        'delete',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Move file or folder
   */
  async move(from: string, to: string): Promise<void> {
    this.ensureInitialized();
    const validatedFrom = this.pathValidator!.validatePath(from);
    const validatedTo = this.pathValidator!.validatePath(to);
    // QA-36: move creates the destination (and its parents) — reject a reserved
    // Windows device name / trailing-dot segment at any level of the target.
    this.validateFinalPathSegment(validatedTo);

    // Check symlink safety on source
    await this.checkSymlinkSafety(validatedFrom);

    const backendFrom = this.toBackendPath(validatedFrom);
    const backendTo = this.toBackendPath(validatedTo);

    // Ensure destination parent exists
    const parentPath = this.pathValidator!.getParentPath(validatedTo);
    const backendParentPath = this.toBackendPath(parentPath);
    const parentExists = await this.backend!.exists(backendParentPath);
    if (!parentExists) {
      await this.backend!.mkdir(backendParentPath);
    }

    try {
      await this.backend!.move(backendFrom, backendTo);
      this.invalidateTree();
    } catch (error) {
      throw new FileOperationError(
        `Failed to move ${from} to ${to}`,
        from,
        'move',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Copy file or folder
   */
  async copy(from: string, to: string): Promise<void> {
    this.ensureInitialized();
    const validatedFrom = this.pathValidator!.validatePath(from);
    const validatedTo = this.pathValidator!.validatePath(to);
    // QA-36: copy creates the destination (and its parents) — reject a reserved
    // Windows device name / trailing-dot segment at any level of the target.
    this.validateFinalPathSegment(validatedTo);

    // Check symlink safety on source
    await this.checkSymlinkSafety(validatedFrom);

    const backendFrom = this.toBackendPath(validatedFrom);
    const backendTo = this.toBackendPath(validatedTo);

    // Ensure destination parent exists
    const parentPath = this.pathValidator!.getParentPath(validatedTo);
    const backendParentPath = this.toBackendPath(parentPath);
    const parentExists = await this.backend!.exists(backendParentPath);
    if (!parentExists) {
      await this.backend!.mkdir(backendParentPath);
    }

    try {
      await this.backend!.copy(backendFrom, backendTo);
      this.invalidateTree();
    } catch (error) {
      throw new FileOperationError(
        `Failed to copy ${from} to ${to}`,
        from,
        'copy',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Rename file or folder
   */
  async rename(path: string, newName: string): Promise<void> {
    this.ensureInitialized();
    const validatedPath = this.pathValidator!.validatePath(path);
    const backendPath = this.toBackendPath(validatedPath);
    const validatedName = this.pathValidator!.validateName(newName);

    try {
      await this.backend!.rename(backendPath, validatedName);
      this.invalidateTree();
    } catch (error) {
      throw new FileOperationError(
        `Failed to rename ${path} to ${newName}`,
        path,
        'rename',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Create directory
   */
  async mkdir(path: string): Promise<void> {
    this.ensureInitialized();
    const validatedPath = this.pathValidator!.validatePath(path);
    this.validateFinalPathSegment(validatedPath);
    const backendPath = this.toBackendPath(validatedPath);

    try {
      await this.backend!.mkdir(backendPath);
      this.invalidateTree();
    } catch (error) {
      throw new FileOperationError(
        `Failed to create directory: ${path}`,
        path,
        'mkdir',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * List directory contents
   */
  async list(path: string): Promise<FileNode[]> {
    this.ensureInitialized();
    const validatedPath = this.pathValidator!.validatePath(path);
    const backendPath = this.toBackendPath(validatedPath);

    try {
      return await this.backend!.list(backendPath);
    } catch (error) {
      throw new FileOperationError(
        `Failed to list directory: ${path}`,
        path,
        'list',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get file or folder stats
   */
  async stat(path: string): Promise<FileStat> {
    this.ensureInitialized();
    const validatedPath = this.pathValidator!.validatePath(path);
    const backendPath = this.toBackendPath(validatedPath);

    try {
      return await this.backend!.stat(backendPath);
    } catch (error) {
      throw new FileOperationError(
        `Failed to get stats: ${path}`,
        path,
        'stat',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Check a workspace path without following its final link. Callers that have
   * a tighter boundary than the workspace root, such as a single client
   * folder, use this before reading content.
   */
  async isSymlink(path: string): Promise<boolean> {
    this.ensureInitialized();
    const validatedPath = this.pathValidator!.validatePath(path);
    return this.backend!.isSymlink(this.toBackendPath(validatedPath));
  }

  /**
   * Resolve a link for callers that must verify the target against a boundary
   * narrower than the workspace root. Backends that cannot resolve a link must
   * fail closed rather than returning the input path as a pretend target.
   */
  async resolveSymlink(path: string): Promise<string> {
    this.ensureInitialized();
    const validatedPath = this.pathValidator!.validatePath(path);
    return this.backend!.resolveSymlink(this.toBackendPath(validatedPath));
  }

  /**
   * List workspace recursively as a tree
   */
  async getFileTree(opts?: { fresh?: boolean }): Promise<FileNode[]> {
    this.ensureInitialized();
    // P1.1 (Task 6): share one scan across concurrent boot callers. `fresh` forces
    // a real walk (used by the file watcher's poll/refresh) AND repopulates the
    // cache, so a subsequent cached read reflects the latest scan.
    if (opts?.fresh || !this.treeScan) {
      // Pass empty string to list from workspace root.
      const scan = this.listRecursive('');
      this.treeScan = scan;
      // Never let a failed scan poison the cache: clear it so the next call
      // re-scans (mirrors the previous always-scan behaviour on error).
      scan.catch(() => {
        if (this.treeScan === scan) this.treeScan = null;
      });
    }
    // Clone so a consumer mutating its returned tree can't corrupt the shared one.
    return cloneFileTree(await this.treeScan);
  }

  /**
   * P1.1 (Task 6) — drop the shared tree scan so the next `getFileTree()` re-walks.
   * Called after any mutation through this service so in-app edits show immediately.
   */
  private invalidateTree(): void {
    this.treeScan = null;
  }

  /**
   * List directory recursively
   */
  private async listRecursive(path: string): Promise<FileNode[]> {
    // path here is already a relative path from backend.list().
    // Lantern's internal config folder is never shown anywhere in the tree
    // (so every fileTree consumer — not just FileTree/FileGridView — is covered).
    const items = (await this.backend!.list(path)).filter(
      (i) => i.name !== WORKSPACE_DATA_DIR,
    );

    for (const item of items) {
      if (item.type === 'folder') {
        // Don't recurse into .trash (Trash UI) or any other dot-directory (e.g.
        // .git, .vscode): they can be enormous and aren't useful in the tree.
        // They still appear as (unexpanded) folders so "Show Hidden Files" can
        // reveal them; we just don't walk their contents.
        if (item.name.startsWith('.')) {
          item.children = [];
          continue;
        }

        try {
          // Check symlink safety before recursing
          // item.path is already a relative path
          const isSymlink = await this.backend!.isSymlink(item.path);
          if (isSymlink) {
            const target = await this.backend!.resolveSymlink(item.path);
            if (!this.pathValidator!.isWithinWorkspace(target)) {
              // Skip symlinks that escape workspace
              item.children = [];
              continue;
            }
          }
          item.children = await this.listRecursive(item.path);
        } catch (err) {
          // A folder we can't read (permission denied, an offline
          // network/OneDrive location, a locked drive) is NOT the same as an
          // empty folder — silently reporting `[]` here made a real access
          // failure invisible. Log it and flag it so the tree can show an
          // honest "couldn't read this folder" state instead.
          console.error(`[WorkspaceService] Could not read folder "${item.path}":`, err);
          item.children = [];
          item.readError = true;
        }
      }
    }

    // Sort: folders first, then alphabetically
    return items.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'folder' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }

  // ==================== Helper Methods ====================

  /**
   * Ensure workspace is initialized
   */
  private ensureInitialized(): void {
    if (!this.backend || !this.pathValidator) {
      throw new Error('Workspace not initialized. Call initialize() first.');
    }
  }

  /**
   * Convert validated absolute path to relative path for backend
   */
  private toBackendPath(validatedAbsolutePath: string): string {
    if (!this.pathValidator) {
      throw new Error('Path validator not initialized');
    }
    return this.pathValidator.getRelativePath(validatedAbsolutePath);
  }

  /**
   * Validate EVERY new path segment, not only the full path or the final name.
   * validatePath() intentionally allows a reserved word inside a path string,
   * but create operations (writeFile/writeFileBinary/mkdir) also create any
   * missing PARENT folders — so `Clients/CON/brief.docx` would slip a reserved
   * `CON` directory onto disk even though the leaf `brief.docx` is fine. Reject a
   * reserved device name or a trailing dot/space at ANY level, mirroring the
   * Rust `resolve_creatable` guard. Existing legitimate parents re-validate
   * harmlessly (real folder names always pass validateName).
   */
  private validateFinalPathSegment(validatedAbsolutePath: string): void {
    if (!this.pathValidator) {
      throw new Error('Path validator not initialized');
    }
    const relative = this.pathValidator.getRelativePath(validatedAbsolutePath);
    for (const segment of relative.split(/[/\\]/)) {
      if (segment) this.pathValidator.validateName(segment);
    }
  }

  /**
   * Check symlink safety
   * @param validatedAbsolutePath - Already validated absolute path
   */
  private async checkSymlinkSafety(validatedAbsolutePath: string): Promise<void> {
    if (!this.backend || !this.pathValidator) return;

    const backendPath = this.toBackendPath(validatedAbsolutePath);
    const isSymlink = await this.backend.isSymlink(backendPath);
    if (isSymlink) {
      const target = await this.backend.resolveSymlink(backendPath);
      this.pathValidator.validateSymlinkTarget(validatedAbsolutePath, target);
    }
  }

  /**
   * Create a RecentWorkspace entry from current workspace
   */
  toRecentWorkspace(): RecentWorkspace | null {
    if (!this.workspace) return null;
    return {
      path: this.workspace.rootPath,
      name: this.workspace.name,
      lastOpened: new Date(),
    };
  }
}

/**
 * Create a WorkspaceService instance
 */
export function createWorkspaceService(): WorkspaceService {
  return new WorkspaceService();
}

// Re-export types for convenience
export { SecurityError, FileOperationError } from './types';
