// Web File System Backend
// Implements FSBackend using the File System Access API

import type { FileNode } from '@/types/workspace';
import type { FSBackend, FileStat } from './types';
import { FileOperationError } from './types';

/**
 * WebFSBackend implements file operations using the File System Access API
 * This allows the app to work in the browser without Tauri
 */
export class WebFSBackend implements FSBackend {
  private rootHandle: FileSystemDirectoryHandle | null = null;
  private rootPath: string = '';

  /**
   * Check if File System Access API is supported
   */
  static isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'showDirectoryPicker' in window &&
      typeof window.showDirectoryPicker === 'function'
    );
  }

  /**
   * Open a directory picker dialog and set as workspace root
   */
  async openDirectoryPicker(): Promise<FileSystemDirectoryHandle> {
    if (!WebFSBackend.isSupported()) {
      throw new Error('File System Access API is not supported in this browser');
    }

    const handle = await window.showDirectoryPicker({
      mode: 'readwrite',
    });

    this.rootHandle = handle;
    this.rootPath = '/' + handle.name;

    return handle;
  }

  /**
   * Set the workspace root from an existing handle
   */
  setRootHandle(handle: FileSystemDirectoryHandle): void {
    this.rootHandle = handle;
    this.rootPath = '/' + handle.name;
  }

  getRootPath(): string {
    return this.rootPath;
  }

  async setRootPath(path: string): Promise<void> {
    // For Web FS, this is called after openDirectoryPicker sets the handle
    // We just store the path for reference
    this.rootPath = path;
  }

  // ==================== File Operations ====================

  async read(path: string): Promise<string> {
    const file = await this.getFileHandle(path);
    const fileObj = await file.getFile();
    return fileObj.text();
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const file = await this.getFileHandle(path);
    const fileObj = await file.getFile();
    return fileObj.arrayBuffer();
  }

  async write(path: string, content: string): Promise<void> {
    const file = await this.getFileHandle(path, { create: true });
    const writable = await file.createWritable();
    try {
      await writable.write(content);
    } finally {
      await writable.close();
    }
  }

  async writeBinary(path: string, content: ArrayBuffer): Promise<void> {
    const file = await this.getFileHandle(path, { create: true });
    const writable = await file.createWritable();
    try {
      await writable.write(content);
    } finally {
      await writable.close();
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      const segments = this.getPathSegments(path);
      if (segments.length === 0) {
        // Root always exists if handle is set
        return this.rootHandle !== null;
      }

      const parentPath = segments.slice(0, -1);
      const lastName = segments[segments.length - 1];
      if (!lastName) return false;

      const parent = await this.getDirectoryHandle(parentPath);

      // Try to get the handle to see if it exists
      try {
        await parent.getFileHandle(lastName);
        return true;
      } catch {
        try {
          await parent.getDirectoryHandle(lastName);
          return true;
        } catch {
          return false;
        }
      }
    } catch {
      return false;
    }
  }

  async delete(path: string): Promise<void> {
    const segments = this.getPathSegments(path);
    if (segments.length === 0) {
      throw new FileOperationError(
        'Cannot delete workspace root',
        path,
        'delete'
      );
    }

    const parentPath = segments.slice(0, -1);
    const lastName = segments[segments.length - 1];
    if (!lastName) {
      throw new FileOperationError('Invalid path', path, 'delete');
    }
    const parent = await this.getDirectoryHandle(parentPath);

    await parent.removeEntry(lastName, { recursive: true });
  }

  async move(from: string, to: string): Promise<void> {
    // Web FS doesn't have native move, so copy then delete
    // Check if it's a file or folder
    const stat = await this.stat(from);
    if (stat.type === 'file') {
      const content = await this.read(from);
      await this.write(to, content);
    } else {
      // For folders, use copy (which handles recursion)
      await this.copy(from, to);
    }
    await this.delete(from);
  }

  async copy(from: string, to: string): Promise<void> {
    const stat = await this.stat(from);
    if (stat.type === 'file') {
      const content = await this.read(from);
      await this.write(to, content);
    } else {
      // Copy directory recursively
      await this.mkdir(to);
      const children = await this.list(from);
      for (const child of children) {
        const fromChild = from + '/' + child.name;
        const toChild = to + '/' + child.name;
        await this.copy(fromChild, toChild);
      }
    }
  }

  async rename(path: string, newName: string): Promise<void> {
    const segments = this.getPathSegments(path);
    if (segments.length === 0) {
      throw new FileOperationError(
        'Cannot rename workspace root',
        path,
        'rename'
      );
    }

    const parentPath = segments.slice(0, -1);
    const parentDir = parentPath.length > 0 ? '/' + parentPath.join('/') : '';
    const newPath = parentDir + '/' + newName;

    await this.move(path, newPath);
  }

  async mkdir(path: string): Promise<void> {
    const segments = this.getPathSegments(path);
    await this.getDirectoryHandle(segments, { create: true });
  }

  async list(path: string): Promise<FileNode[]> {
    const segments = this.getPathSegments(path);
    const dir = await this.getDirectoryHandle(segments);
    const nodes: FileNode[] = [];

    for await (const [name, handle] of dir.entries()) {
      const nodePath = path + '/' + name;
      const node: FileNode = {
        id: nodePath,
        name,
        path: nodePath,
        type: handle.kind === 'file' ? 'file' : 'folder',
      };

      if (handle.kind === 'file') {
        const file = await (handle as FileSystemFileHandle).getFile();
        node.size = file.size;
        node.modifiedAt = new Date(file.lastModified);
        const dotIndex = name.lastIndexOf('.');
        if (dotIndex > 0) {
          node.extension = name.slice(dotIndex + 1).toLowerCase();
        }
      }

      nodes.push(node);
    }

    return nodes;
  }

  async stat(path: string): Promise<FileStat> {
    const segments = this.getPathSegments(path);
    const rootName = this.rootHandle?.name ?? 'workspace';
    const statName = segments.length > 0 ? segments[segments.length - 1] : rootName;

    if (segments.length === 0) {
      // Root directory
      return {
        path,
        name: statName ?? rootName,
        type: 'folder',
        size: 0,
        modifiedAt: new Date(),
        createdAt: new Date(),
        isSymlink: false,
      };
    }

    const parentPath = segments.slice(0, -1);
    const parent = await this.getDirectoryHandle(parentPath);
    const name = statName ?? '';

    // Try as file first
    try {
      const fileHandle = await parent.getFileHandle(name);
      const file = await fileHandle.getFile();
      return {
        path,
        name,
        type: 'file',
        size: file.size,
        modifiedAt: new Date(file.lastModified),
        createdAt: new Date(file.lastModified), // Web FS doesn't provide created time
        isSymlink: false, // Web FS doesn't expose symlinks
      };
    } catch {
      // Try as directory
      try {
        await parent.getDirectoryHandle(name);
        return {
          path,
          name,
          type: 'folder',
          size: 0,
          modifiedAt: new Date(),
          createdAt: new Date(),
          isSymlink: false,
        };
      } catch {
        throw new FileOperationError(
          `Path not found: ${path}`,
          path,
          'stat'
        );
      }
    }
  }

  async isSymlink(_path: string): Promise<boolean> {
    // Web File System Access API doesn't expose symlink information
    return false;
  }

  async resolveSymlink(path: string): Promise<string> {
    // Web File System Access API doesn't expose symlink information
    return path;
  }

  // ==================== Helper Methods ====================

  private ensureInitialized(): void {
    if (!this.rootHandle) {
      throw new Error('Workspace not initialized. Call openDirectoryPicker() first.');
    }
  }

  private getPathSegments(path: string): string[] {
    // Remove root path prefix if present
    let relativePath = path;
    if (path.startsWith(this.rootPath)) {
      relativePath = path.slice(this.rootPath.length);
    }

    // Split into segments and filter empty
    return relativePath
      .split('/')
      .filter((s) => s.length > 0 && s !== '.');
  }

  private async getDirectoryHandle(
    segments: string[],
    options?: { create?: boolean }
  ): Promise<FileSystemDirectoryHandle> {
    this.ensureInitialized();

    let current = this.rootHandle!;
    for (const segment of segments) {
      current = await current.getDirectoryHandle(segment, options);
    }
    return current;
  }

  private async getFileHandle(
    path: string,
    options?: { create?: boolean }
  ): Promise<FileSystemFileHandle> {
    this.ensureInitialized();

    const segments = this.getPathSegments(path);
    if (segments.length === 0) {
      throw new FileOperationError(
        'Cannot get file handle for directory',
        path,
        'read'
      );
    }

    const parentPath = segments.slice(0, -1);
    const fileName = segments[segments.length - 1];
    if (!fileName) {
      throw new FileOperationError('Invalid path', path, 'read');
    }

    // Ensure parent directories exist if creating
    const parent = await this.getDirectoryHandle(
      parentPath,
      options?.create ? { create: true } : undefined
    );

    return parent.getFileHandle(fileName, options);
  }
}

/**
 * Create a WebFSBackend instance
 */
export function createWebFSBackend(): WebFSBackend {
  return new WebFSBackend();
}
