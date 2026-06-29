/**
 * scopeFileTree — prune a workspace file tree to a single client's folders.
 *
 * The Client Map hub's "Documents" sub-tab shows THIS client's files, not the
 * whole workspace. A matter owns one or more `folderPaths` (`Matter.folderPaths`);
 * this helper returns a new tree containing only:
 *   - the subtree rooted at each of the matter's folders (its full contents),
 *   - plus the ancestor folders needed to reach them (so the path is navigable).
 *
 * Everything outside the matter's folders is dropped. The function is PURE
 * (returns new nodes; never mutates the input) so it is safe to call inside a
 * render/useMemo, and so the unscoped store tree the rest of the app uses is
 * never altered. The original node `path` values are preserved unchanged in the
 * output — only comparison is canonicalized.
 *
 * **Path-format independence (the bug this guards against):** the store file
 * tree's node paths are workspace-RELATIVE (`Clients/Acme/...`, produced by the
 * FS backend's `list()`), while a matter's `folderPaths` are ABSOLUTE
 * (`C:/WS/Clients/Acme`). A naive prefix/segment compare matches NOTHING across
 * those two shapes, which made every client's Documents tab show empty. We fix
 * this by comparing in the canonical, workspace-relative, case-insensitive key
 * space `canonicalFolderClaimKey` already defines — the SAME canonicalization the
 * folder-claim ownership checks use — so a relative tree node and an absolute
 * matter folder for the same physical directory resolve to the same key. Pass
 * `workspaceRoot` to enable absolute↔relative collapsing; without it the compare
 * is purely lexical (back-compat for callers whose tree and folders already share
 * one format). Matching is whole-segment, so `/ws/Acme` never matches `/ws/Acme Two`.
 */
import type { FileNode } from '@/platform/types/workspace';
import type { Matter } from '@/platform/types/matter';
import { canonicalFolderClaimKey } from '@/platform/rag/matterResolver';
import { UNASSIGNED_MATTER_ID } from '@/platform/types/matter';

/** True when `pathKey` is the folder `folderKey` itself or a descendant of it.
 *  Both inputs must already be canonical (whole-segment, normalized) keys. */
function keyAtOrUnder(pathKey: string, folderKey: string): boolean {
  return pathKey === folderKey || pathKey.startsWith(`${folderKey}/`);
}

/** True when `nodeKey` is a STRICT ancestor of `folderKey` (so we must descend
 *  into it to reach the scoped folder). Canonical keys. */
function isStrictAncestor(nodeKey: string, folderKey: string): boolean {
  return folderKey.startsWith(`${nodeKey}/`);
}

/**
 * Return a pruned copy of `tree` limited to the given `folderPaths`.
 *
 * - `folderPaths` empty (or none canonicalizable) → returns `[]` (a client with
 *   no mapped folders has no scoped documents; the caller shows an honest empty
 *   state).
 * - A node at/under any folder path is included; an ancestor folder is kept only
 *   for the branch leading down to a scoped folder.
 * - **Matter isolation:** when `matters` + `scopeMatterId` are supplied, a
 *   descendant owned by a DIFFERENT matter (a subfolder mapped to another client,
 *   nested inside this client's folder) is DROPPED — using the same longest-match
 *   ownership the matter resolver uses, in canonical space — so one client's tab
 *   can never surface another client's files. Without that context the prune is
 *   purely folder-based (back-compat).
 * - `workspaceRoot` (when known) lets the function collapse absolute matter
 *   folder paths against relative tree node paths (and vice-versa). Always pass
 *   it from the live workspace; omit only in pure tests that use one path shape.
 */
export function scopeFileTreeToFolders(
  tree: FileNode[],
  folderPaths: string[],
  matters?: Matter[],
  scopeMatterId?: string,
  workspaceRoot?: string | null,
): FileNode[] {
  if (folderPaths.length === 0) return [];

  // Canonicalize the scoped folders to workspace-relative, case-insensitive keys.
  // This is what makes an absolute matter folder match a relative tree node for
  // the same physical directory.
  const folderKeys = folderPaths
    .map((f) => canonicalFolderClaimKey(f, workspaceRoot))
    .filter((k): k is string => k !== null && k.length > 0);
  if (folderKeys.length === 0) return [];

  const ownershipAware = matters !== undefined && scopeMatterId !== undefined;

  // Pre-canonicalize every matter's folder ownership once (id + canonical key),
  // so the per-node longest-match owner lookup is consistent with `folderKeys`.
  const ownerEntries: Array<{ id: string; key: string }> = [];
  if (ownershipAware) {
    // `matters` is narrowed to defined here via the `ownershipAware` alias.
    for (const m of matters) {
      if (m.id === UNASSIGNED_MATTER_ID) continue;
      for (const fp of m.folderPaths) {
        const key = canonicalFolderClaimKey(fp, workspaceRoot);
        if (key) ownerEntries.push({ id: m.id, key });
      }
    }
  }

  /** Longest-match owner of a canonical node key (mirrors `resolveMatterId`). */
  function ownerOf(nodeKey: string): string {
    let bestId = UNASSIGNED_MATTER_ID;
    let bestLen = -1;
    for (const { id, key } of ownerEntries) {
      if (keyAtOrUnder(nodeKey, key) && key.length > bestLen) {
        bestLen = key.length;
        bestId = id;
      }
    }
    return bestId;
  }

  function prune(node: FileNode): FileNode | null {
    const nodeKey = canonicalFolderClaimKey(node.path, workspaceRoot);

    // A node that canonicalizes to the workspace root itself (key === null) is an
    // ancestor of every scoped folder — descend so we can reach them.
    if (nodeKey === null) {
      if (node.type !== 'folder') return null;
      const children = (node.children ?? [])
        .map(prune)
        .filter((c): c is FileNode => c !== null);
      return children.length > 0 ? { ...node, children } : null;
    }

    // Inside one of the matter's folders (path-wise).
    if (folderKeys.some((fk) => keyAtOrUnder(nodeKey, fk))) {
      if (!ownershipAware) {
        // Folder-based only: keep the whole subtree.
        return node;
      }
      // Ownership-aware: a node whose longest-match owner is a DIFFERENT matter
      // (a nested foreign-client subfolder/file) must be dropped, not leaked.
      if (ownerOf(nodeKey) !== scopeMatterId) {
        return null;
      }
      // Ours — but recurse folders, since a deeper subfolder could be mapped to
      // another matter even though this level is ours.
      if (node.type === 'folder') {
        const children = (node.children ?? [])
          .map(prune)
          .filter((c): c is FileNode => c !== null);
        return { ...node, children };
      }
      return node;
    }

    // A folder above a scoped folder: keep only the branch that reaches it.
    if (node.type === 'folder' && folderKeys.some((fk) => isStrictAncestor(nodeKey, fk))) {
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
