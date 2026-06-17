/**
 * Workspace path resolution helper.
 *
 * The TS side of the workspace tracks files using workspace-relative paths
 * (e.g. "docs/contract.docx"), which the WorkspaceService correctly resolves
 * when reading/writing through the FSBackend abstraction.  However, the native
 * Tauri commands (docx_open, etc.) receive paths via `invoke()` and pass them
 * directly to `std::fs::read(path)`, which resolves relative paths against the
 * Rust process CWD rather than the workspace root.  On Windows this causes
 * "os error 3" (the system cannot find the path specified).
 *
 * `resolveWorkspacePath` bridges this gap: call it wherever a path will be
 * handed to a native Tauri command rather than routed through WorkspaceService.
 *
 * SEPARATOR NOTE: paths produced here use forward-slash joins suitable for
 * native command paths (std::fs), which Rust accepts on all platforms.
 * See also `resolveExplorerPath` in FileTree.tsx which must use OS-native
 * separators for explorer.exe / open / xdg-open arguments.
 */

/**
 * Resolve `maybeRelative` against `rootPath` if it is not already absolute,
 * returning an absolute path the native layer can use directly.
 *
 * Rules:
 *   - A POSIX absolute path (starts with `/`) is returned unchanged.
 *   - A Windows absolute path (starts with a drive letter `X:` or a backslash)
 *     is returned unchanged.
 *   - Any other path is treated as workspace-relative and joined to `rootPath`.
 *   - A trailing slash on `rootPath` is stripped before joining to avoid
 *     double slashes.
 *   - Spaces and unicode in both parts are preserved unmangled.
 */
export function resolveWorkspacePath(rootPath: string, maybeRelative: string): string {
  if (isAbsolutePath(maybeRelative)) {
    return maybeRelative;
  }
  const root = rootPath.endsWith('/') || rootPath.endsWith('\\')
    ? rootPath.slice(0, -1)
    : rootPath;
  return `${root}/${maybeRelative}`;
}

/**
 * Return true if `p` is an absolute path on any supported platform.
 *
 * Covers:
 *   - POSIX: starts with "/"
 *   - Windows forward-slash: starts with "C:/" or similar drive+colon+slash
 *   - Windows backslash: starts with "C:\\" or starts with "\\"
 *   - UNC paths: starts with "\\\\" (e.g. "\\\\server\\share")
 *
 * Exported so callers outside this module (e.g. resolveExplorerPath in
 * FileTree.tsx) can reuse the single source of truth for absolute detection,
 * which correctly handles UNC paths that neither "/" nor drive-letter checks
 * would catch.
 */
export function isAbsolutePath(p: string): boolean {
  // POSIX absolute
  if (p.startsWith('/')) return true;
  // Windows backslash absolute (C:\ or \\server UNC)
  if (p.startsWith('\\')) return true;
  // Windows drive-letter absolute: X: followed by / or \
  if (/^[A-Za-z]:[\\/]/.test(p)) return true;
  return false;
}
