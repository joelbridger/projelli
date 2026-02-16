// Workspace Module Types

import type { FileNode } from '@/types/workspace';

/**
 * File system backend interface
 * Implemented by WebFSBackend and TauriFSBackend
 */
export interface FSBackend {
  /**
   * Read file contents as string
   */
  read(path: string): Promise<string>;

  /**
   * Read file contents as binary
   */
  readBinary(path: string): Promise<ArrayBuffer>;

  /**
   * Write string content to file
   */
  write(path: string, content: string): Promise<void>;

  /**
   * Write binary content to file
   */
  writeBinary(path: string, content: ArrayBuffer): Promise<void>;

  /**
   * Check if path exists
   */
  exists(path: string): Promise<boolean>;

  /**
   * Delete file or folder
   */
  delete(path: string): Promise<void>;

  /**
   * Move file or folder
   */
  move(from: string, to: string): Promise<void>;

  /**
   * Copy file or folder
   */
  copy(from: string, to: string): Promise<void>;

  /**
   * Rename file or folder
   */
  rename(path: string, newName: string): Promise<void>;

  /**
   * Create directory
   */
  mkdir(path: string): Promise<void>;

  /**
   * List directory contents
   */
  list(path: string): Promise<FileNode[]>;

  /**
   * Get file stats
   */
  stat(path: string): Promise<FileStat>;

  /**
   * Check if path is a symlink
   */
  isSymlink(path: string): Promise<boolean>;

  /**
   * Resolve symlink to actual path
   */
  resolveSymlink(path: string): Promise<string>;

  /**
   * Get the workspace root path
   */
  getRootPath(): string;

  /**
   * Set the workspace root path
   */
  setRootPath(path: string): Promise<void>;
}

/**
 * File statistics
 */
export interface FileStat {
  path: string;
  name: string;
  type: 'file' | 'folder';
  size: number;
  modifiedAt: Date;
  createdAt: Date;
  isSymlink: boolean;
}

/**
 * Security error thrown when path validation fails
 */
export class SecurityError extends Error {
  constructor(
    message: string,
    public readonly attemptedPath: string,
    public readonly reason: SecurityErrorReason
  ) {
    super(message);
    this.name = 'SecurityError';
  }
}

/**
 * Reasons for security errors
 */
export type SecurityErrorReason =
  | 'PATH_TRAVERSAL'
  | 'SYMLINK_ESCAPE'
  | 'OUTSIDE_WORKSPACE'
  | 'INVALID_PATH'
  | 'ABSOLUTE_PATH_IN_RELATIVE_CONTEXT';

/**
 * File operation error
 */
export class FileOperationError extends Error {
  public readonly path: string;
  public readonly operation: FileOperation;
  public override readonly cause: Error | undefined;

  constructor(
    message: string,
    path: string,
    operation: FileOperation,
    cause?: Error
  ) {
    super(message);
    this.name = 'FileOperationError';
    this.path = path;
    this.operation = operation;
    this.cause = cause;
  }
}

/**
 * Types of file operations
 */
export type FileOperation =
  | 'read'
  | 'write'
  | 'delete'
  | 'move'
  | 'copy'
  | 'rename'
  | 'mkdir'
  | 'list'
  | 'stat';

/**
 * Options for workspace initialization
 */
export interface WorkspaceInitOptions {
  /**
   * Create workspace folder if it doesn't exist
   */
  createIfMissing?: boolean;

  /**
   * Create default folder structure
   */
  createDefaultStructure?: boolean;
}

/**
 * Default folder structure for new workspaces
 */
export const DEFAULT_WORKSPACE_FOLDERS = [
  'docs',
  'research',
  'templates',
  '.trash',
] as const;
