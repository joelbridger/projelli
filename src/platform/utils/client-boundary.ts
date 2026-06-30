/**
 * Client boundary detection for AI context.
 *
 * Advisor Prep Hero's confidentiality promise depends on one top-level folder = one
 * client. These pure helpers answer two questions before each send:
 *
 *   1. Which top-level folders does the current AI context span?
 *   2. Does that set include more than one folder (a cross-client situation)?
 *
 * "Top-level folder" means the first path segment inside the workspace root.
 * For example, in a workspace rooted at /Users/jane/Advisor Prep Hero, the file
 *   /Users/jane/Advisor Prep Hero/Acme Corp/matter-1/discovery.md
 * belongs to the top-level folder "Acme Corp".
 *
 * Files that sit directly inside the workspace root (no subfolder at all)
 * are reported under the sentinel key "<workspace root>" so the caller can
 * show them meaningfully in the UI.
 *
 * All functions are pure (no side-effects, no Zustand) so they can be
 * unit-tested without mounting React.
 */

import {
  topLevelSegment,
  sameOrInside,
  joinWorkspacePath,
} from '@/platform/fs/appPath';

/** Sentinel label for files that live directly in the workspace root. */
export const ROOT_LEVEL_SENTINEL = '<workspace root>';

/**
 * Given an absolute file path and the absolute workspace root path, return
 * the name of the immediate child folder of the root that contains the file.
 *
 * Returns `ROOT_LEVEL_SENTINEL` when the file sits directly in the root
 * (no containing subfolder).
 *
 * Returns `null` when `filePath` is not inside `workspaceRoot` or when
 * either argument is empty/null.
 *
 * Examples (workspaceRoot = "/ws"):
 *   "/ws/ClientA/matter1/doc.md"  =>  "ClientA"
 *   "/ws/ClientA/doc.md"          =>  "ClientA"
 *   "/ws/doc.md"                  =>  ROOT_LEVEL_SENTINEL
 *   "/other/doc.md"               =>  null
 */
export function getTopLevelFolder(
  filePath: string,
  workspaceRoot: string,
): string | null {
  if (!filePath || !workspaceRoot) return null;

  // Cross-platform containment + segment extraction: handles `\` vs `/`, drive
  // letters, UNC roots, trailing separators, and (on Windows) case-insensitive
  // comparison. An empty segment means the file IS the root or sits directly in
  // it — both reported under the root-level sentinel.
  const seg = topLevelSegment(workspaceRoot, filePath);
  if (seg === null) return null;
  return seg === '' ? ROOT_LEVEL_SENTINEL : seg;
}

/**
 * Given a set of included file paths and the workspace root, returns the set
 * of distinct top-level folder names those files belong to.
 *
 * Paths that cannot be mapped (outside the workspace root, or empty) are
 * silently ignored so bad data can't pollute the result.
 */
export function getDistinctTopLevelFolders(
  filePaths: string[],
  workspaceRoot: string,
): Set<string> {
  // Distinct top-level folder NAMES, compared as-is (case-sensitively). The
  // cross-client WARNING this feeds is a confidentiality safety net, so we lean
  // to the fail-SAFE direction: if two paths' top folders differ by case
  // (`Acme` vs `acme`) we treat them as DISTINCT and warn, rather than folding
  // them and risk MISSING a genuine two-client span on a case-sensitive volume.
  // (In practice file-tree paths carry the on-disk case consistently, so this
  // rarely over-warns.) Containment elsewhere still folds case on Windows where
  // that is the safe direction — see `resolveMatterId`'s ambiguity guard.
  const folders = new Set<string>();
  for (const p of filePaths) {
    const folder = getTopLevelFolder(p, workspaceRoot);
    if (folder !== null) folders.add(folder);
  }
  return folders;
}

export interface CrossClientResult {
  /** True when the included files span more than one top-level folder. */
  isCrossClient: boolean;
  /** Sorted list of all distinct top-level folders in the context set. */
  folders: string[];
}

/**
 * High-level check: given a list of active file paths and the workspace root,
 * determine whether the AI context spans more than one top-level client folder.
 *
 * This is the function the UI calls to decide whether to show the warning.
 */
export function detectCrossClientContext(
  filePaths: string[],
  workspaceRoot: string | null | undefined,
): CrossClientResult {
  if (!workspaceRoot || filePaths.length === 0) {
    return { isCrossClient: false, folders: [] };
  }

  const folderSet = getDistinctTopLevelFolders(filePaths, workspaceRoot);
  const folders = Array.from(folderSet).sort();
  return {
    isCrossClient: folderSet.size > 1,
    folders,
  };
}

// ─────────────────────────────────────────────────────────────────────
// D1 — folder scoping helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Filter a list of file paths to only those within a specific top-level
 * folder inside the workspace root.
 *
 * When `scopedFolder` is null/undefined (no scope set), returns all paths
 * unchanged.
 *
 * When `workspaceRoot` is null/undefined, returns all paths unchanged since
 * we cannot compute the prefix.
 *
 * Examples (workspaceRoot = "/ws", scopedFolder = "Acme Corp"):
 *   ["/ws/Acme Corp/matter/doc.md", "/ws/Beta Inc/doc.md"]
 *   => ["/ws/Acme Corp/matter/doc.md"]
 */
export function filterByScope(
  filePaths: string[],
  workspaceRoot: string | null | undefined,
  scopedFolder: string | null | undefined,
): string[] {
  if (!scopedFolder || !workspaceRoot) return filePaths;
  // A file is in scope when it IS, or lives inside, `<root>/<scopedFolder>`.
  // sameOrInside is separator-, trailing-separator-, and (on Windows) case-
  // robust, and it respects segment boundaries (so "Acme" never matches
  // "Acme Corp"). This replaces the POSIX-only `startsWith` prefix match.
  const scopeRoot = joinWorkspacePath(workspaceRoot, scopedFolder);
  return filePaths.filter((p) => sameOrInside(scopeRoot, p));
}

/**
 * Extract the distinct top-level folder names from a list of file paths
 * for use in the folder scope picker. Returns an empty array when
 * `workspaceRoot` is missing.
 *
 * The ROOT_LEVEL_SENTINEL is included when any file sits directly in the
 * workspace root, so the picker can show it as an option.
 */
export function getTopLevelFolderNames(
  filePaths: string[],
  workspaceRoot: string | null | undefined,
): string[] {
  if (!workspaceRoot) return [];
  const folderSet = getDistinctTopLevelFolders(filePaths, workspaceRoot);
  return Array.from(folderSet).sort();
}
