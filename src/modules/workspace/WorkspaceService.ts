// Workspace Service
// Orchestrates file operations with security validation

import type { FileNode, Workspace, RecentWorkspace } from '@/types/workspace';
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

/**
 * WorkspaceService provides secure file operations
 * All operations go through path validation before reaching the backend
 */
export class WorkspaceService {
  private backend: FSBackend | null = null;
  private pathValidator: PathValidator | null = null;
  private workspace: Workspace | null = null;

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

    // Set up backend
    this.backend = backend;
    await backend.setRootPath(rootPath);

    console.log('[WorkspaceService] Backend setRootPath completed');

    // Set up path validator
    this.pathValidator = new PathValidator(rootPath);

    // Check if workspace exists - use empty string to check the root itself
    console.log('[WorkspaceService] Checking if root exists by calling backend.exists("")');
    const exists = await backend.exists('');

    if (!exists) {
      if (createIfMissing) {
        await backend.mkdir(rootPath);
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
    const backendPath = this.toBackendPath(validatedPath);

    try {
      await this.backend!.mkdir(backendPath);
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
   * List workspace recursively as a tree
   */
  async getFileTree(): Promise<FileNode[]> {
    this.ensureInitialized();
    // Pass empty string to list from workspace root
    return this.listRecursive('');
  }

  /**
   * List directory recursively
   */
  private async listRecursive(path: string): Promise<FileNode[]> {
    // path here is already a relative path from backend.list()
    const items = await this.backend!.list(path);

    for (const item of items) {
      if (item.type === 'folder') {
        // Don't recurse into .trash
        if (item.name === '.trash') {
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
        } catch {
          // If we can't read a directory, mark it as empty
          item.children = [];
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
