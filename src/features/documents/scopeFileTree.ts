/**
 * scopeFileTree — prune a workspace file tree to a single client's folders.
 *
 * The Client Map hub's "Documents" sub-tab shows THIS client's files, not the
 * whole workspace. A matter owns one or more absolute `folderPaths`
 * (`Matter.folderPaths`); this helper returns a new tree containing only:
 *   - the subtree rooted at each of the matter's folders (its full contents),
 *   - plus the ancestor folders needed to reach them (so the path is navigable).
 *
 * Everything outside the matter's folders is dropped. The function is PURE
 * (returns new nodes; never mutates the input) so it is safe to call inside a
 * render/useMemo, and so the unscoped store tree the rest of the app uses is
 * never altered.
 *
 * Matching reuses the app's canonical folder logic (`isPathInFolder` /
 * `normalize` from the matter resolver — the SAME check `resolveMatterId` uses),
 * so the pruned view agrees exactly with how files are assigned to matters, and
 * Windows backslash paths + trailing slashes are handled identically. Matching
 * is whole-segment, so `/ws/Brennan` does NOT match `/ws/Brennan Two`.
 */
import type { FileNode } from '@/platform/types/workspace';
import { isPathInFolder, normalize } from '@/platform/rag/matterResolver';

/** True when `path` is a strict ancestor of `folder` (so we must descend into
 *  it to reach the scoped folder). */
function isAncestorOf(path: string, folder: string): boolean {
  return isPathInFolder(folder, path) && normalize(path) !== normalize(folder);
}

/**
 * Return a pruned copy of `tree` limited to the given absolute `folderPaths`.
 *
 * - `folderPaths` empty → returns `[]` (a client with no mapped folders has no
 *   scoped documents; the caller shows an honest empty state).
 * - A node at/under any folder path is included whole (its full subtree).
 * - A folder that is an ancestor of a scoped folder is kept but recursed into,
 *   so only the branch leading to the scoped folder survives.
 */
export function scopeFileTreeToFolders(
  tree: FileNode[],
  folderPaths: string[],
): FileNode[] {
  if (folderPaths.length === 0) return [];
  const folders = folderPaths.filter(Boolean);

  function prune(node: FileNode): FileNode | null {
    // Inside one of the matter's folders (or exactly one): keep the whole node.
    if (folders.some((f) => isPathInFolder(node.path, f))) {
      return node;
    }
    // A folder above a scoped folder: keep only the branch that reaches it.
    if (node.type === 'folder' && folders.some((f) => isAncestorOf(node.path, f))) {
      const children = (node.children ?? [])
        .map(prune)
        .filter((c): c is FileNode => c !== null);
      return { ...node, children };
    }
    // Unrelated to every scoped folder: drop it.
    return null;
  }

  return tree.map(prune).filter((n): n is FileNode => n !== null);
}
