// Path Validation Module
// Ensures all file operations stay within workspace boundaries

import { SecurityError } from './types';

/**
 * PathValidator provides security validation for file paths
 * to prevent path traversal attacks and symlink escapes
 */
export class PathValidator {
  private rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = this.normalizePath(rootPath);
  }

  /**
   * Update the root path
   */
  setRootPath(rootPath: string): void {
    this.rootPath = this.normalizePath(rootPath);
  }

  /**
   * Get the current root path
   */
  getRootPath(): string {
    return this.rootPath;
  }

  /**
   * Normalize a path (resolve ./ and ../ segments, normalize separators)
   */
  normalizePath(path: string): string {
    // Normalize separators to forward slashes
    let normalized = path.replace(/\\/g, '/');

    // Remove trailing slash except for root
    if (normalized.length > 1 && normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }

    return normalized;
  }

  /**
   * Join path segments safely
   */
  joinPath(...segments: string[]): string {
    const joined = segments
      .map((s) => this.normalizePath(s))
      .filter((s) => s.length > 0)
      .join('/');
    return this.normalizePath(joined);
  }

  /**
   * Get the relative path from root to the given path
   */
  getRelativePath(absolutePath: string): string {
    const normalized = this.normalizePath(absolutePath);
    if (!normalized.startsWith(this.rootPath)) {
      throw new SecurityError(
        `Path is outside workspace: ${absolutePath}`,
        absolutePath,
        'OUTSIDE_WORKSPACE'
      );
    }
    let relative = normalized.slice(this.rootPath.length);
    if (relative.startsWith('/')) {
      relative = relative.slice(1);
    }
    return relative || '.';
  }

  /**
   * Convert a relative path to absolute path within workspace
   */
  toAbsolutePath(relativePath: string): string {
    const normalized = this.normalizePath(relativePath);

    // If already absolute and within workspace, return as-is
    if (normalized.startsWith(this.rootPath)) {
      return normalized;
    }

    // Don't allow absolute paths that aren't in workspace
    if (this.isAbsolutePath(normalized)) {
      throw new SecurityError(
        `Absolute path outside workspace not allowed: ${relativePath}`,
        relativePath,
        'ABSOLUTE_PATH_IN_RELATIVE_CONTEXT'
      );
    }

    return this.joinPath(this.rootPath, normalized);
  }

  /**
   * Check if a path is absolute
   */
  isAbsolutePath(path: string): boolean {
    const normalized = this.normalizePath(path);
    // Unix absolute path
    if (normalized.startsWith('/')) return true;
    // Windows absolute path (C:/ or similar)
    if (/^[a-zA-Z]:[\\/]/.test(normalized)) return true;
    return false;
  }

  /**
   * Validate a path for security issues
   * Returns the validated absolute path if valid
   * Throws SecurityError if invalid
   */
  validatePath(path: string): string {
    console.log('[PathValidator] validatePath called with:', path);
    console.log('[PathValidator] rootPath:', this.rootPath);

    // Check for basic path traversal patterns BEFORE normalization
    // This catches attempts to use encoded or alternative representations
    this.checkTraversalPatterns(path);

    const absolutePath = this.toAbsolutePath(path);
    console.log('[PathValidator] toAbsolutePath result:', absolutePath);

    // Resolve the path to handle remaining ../ segments
    const resolvedPath = this.resolvePath(absolutePath);
    console.log('[PathValidator] resolvePath result:', resolvedPath);

    // Verify the resolved path is still within workspace
    if (!this.isWithinWorkspace(resolvedPath)) {
      console.error('[PathValidator] Path escapes workspace!');
      console.error('[PathValidator] resolvedPath:', resolvedPath);
      console.error('[PathValidator] rootPath:', this.rootPath);
      throw new SecurityError(
        `Path escapes workspace boundary: ${path}`,
        path,
        'PATH_TRAVERSAL'
      );
    }

    console.log('[PathValidator] Path validated successfully:', resolvedPath);
    return resolvedPath;
  }

  /**
   * Check for traversal patterns in raw path string
   */
  private checkTraversalPatterns(path: string): void {
    // Patterns that indicate path traversal attempts
    const traversalPatterns = [
      /\.\.\//g, // ../
      /\.\.\\/g, // ..\
      /\.\.$/g, // ends with ..
      /%2e%2e/gi, // URL encoded ..
      /%252e%252e/gi, // Double URL encoded ..
      /\.{3,}/g, // Three or more dots
    ];

    for (const pattern of traversalPatterns) {
      if (pattern.test(path)) {
        throw new SecurityError(
          `Path contains traversal sequence: ${path}`,
          path,
          'PATH_TRAVERSAL'
        );
      }
    }
  }

  /**
   * Resolve a path by handling . and .. segments
   */
  private resolvePath(path: string): string {
    const segments = path.split('/').filter((s) => s.length > 0 && s !== '.');
    const resolved: string[] = [];

    for (const segment of segments) {
      if (segment === '..') {
        // Going up - but check if we're still within allowed bounds
        if (resolved.length > 0) {
          resolved.pop();
        }
        // If we can't go up anymore, that's a traversal attempt
      } else {
        resolved.push(segment);
      }
    }

    // Reconstruct path - preserve Windows drive letter if present
    const firstSegment = resolved[0];
    if (resolved.length > 0 && firstSegment && /^[a-zA-Z]:$/.test(firstSegment)) {
      // Windows absolute path
      return resolved.join('/');
    } else {
      // Unix absolute path
      return '/' + resolved.join('/');
    }
  }

  /**
   * Check if a path is within the workspace root
   */
  isWithinWorkspace(path: string): boolean {
    const normalized = this.normalizePath(path);
    const normalizedRoot = this.normalizePath(this.rootPath);

    // Path must start with root path
    if (!normalized.startsWith(normalizedRoot)) {
      return false;
    }

    // Ensure it's not just a prefix match (e.g., /workspace-evil matching /workspace)
    if (normalized.length > normalizedRoot.length) {
      const nextChar = normalized.charAt(normalizedRoot.length);
      if (nextChar !== '/') {
        return false;
      }
    }

    return true;
  }

  /**
   * Validate that a symlink doesn't escape the workspace
   * This should be called after resolving the symlink target
   */
  validateSymlinkTarget(
    symlinkPath: string,
    resolvedTarget: string
  ): string {
    const absoluteTarget = this.normalizePath(resolvedTarget);

    if (!this.isWithinWorkspace(absoluteTarget)) {
      throw new SecurityError(
        `Symlink escapes workspace: ${symlinkPath} -> ${resolvedTarget}`,
        symlinkPath,
        'SYMLINK_ESCAPE'
      );
    }

    return absoluteTarget;
  }

  /**
   * Validate a file/folder name (not a path)
   */
  validateName(name: string): string {
    // Check for empty name
    if (!name || name.trim().length === 0) {
      throw new SecurityError(
        'Name cannot be empty',
        name,
        'INVALID_PATH'
      );
    }

    // Check for path separators in name
    if (name.includes('/') || name.includes('\\')) {
      throw new SecurityError(
        'Name cannot contain path separators',
        name,
        'INVALID_PATH'
      );
    }

    // Check for . or ..
    if (name === '.' || name === '..') {
      throw new SecurityError(
        'Name cannot be . or ..',
        name,
        'PATH_TRAVERSAL'
      );
    }

    // Check for null bytes
    if (name.includes('\0')) {
      throw new SecurityError(
        'Name cannot contain null bytes',
        name,
        'INVALID_PATH'
      );
    }

    // Check for control characters
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(name)) {
      throw new SecurityError(
        'Name cannot contain control characters',
        name,
        'INVALID_PATH'
      );
    }

    return name.trim();
  }

  /**
   * Get the parent directory of a path
   */
  getParentPath(path: string): string {
    const normalized = this.normalizePath(path);
    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash <= 0) {
      return '/';
    }
    return normalized.slice(0, lastSlash);
  }

  /**
   * Get the filename from a path
   */
  getFileName(path: string): string {
    const normalized = this.normalizePath(path);
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  }

  /**
   * Get the file extension from a path
   */
  getExtension(path: string): string {
    const fileName = this.getFileName(path);
    const lastDot = fileName.lastIndexOf('.');
    if (lastDot <= 0) {
      return '';
    }
    return fileName.slice(lastDot + 1).toLowerCase();
  }
}

/**
 * Create a PathValidator instance
 */
export function createPathValidator(rootPath: string): PathValidator {
  return new PathValidator(rootPath);
}
