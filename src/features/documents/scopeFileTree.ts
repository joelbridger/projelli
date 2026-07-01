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
 * never altered. The original node `path` values are preserved unchanged.
 *
 * **Single source of truth for ownership (the bugs this guards against):**
 *   1. The store file tree's node paths are workspace-RELATIVE (`Clients/Acme/…`,
 *      from the FS backend's `list()`), while a matter's `folderPaths` are
 *      ABSOLUTE (`C:/WS/Clients/Acme`). A raw compare matches NOTHING across the
 *      two shapes, which made every client's Documents tab show empty. We bridge
 *      that by resolving each tree node path to an absolute path under
 *      `workspaceRoot` (`toAbsolute`) before comparing.
 *   2. Matching/ownership then reuses the EXACT functions the indexer and chat
 *      use — `isPathInFolder` and `resolveMatterId` — so the Documents tab agrees
 *      byte-for-byte with how files are actually assigned to matters. Those share
 *      the `appPath` comparison helpers, whose case sensitivity follows the
 *      FILESYSTEM (inferred from path shape): POSIX paths compare CASE-SENSITIVELY
 *      so two clients whose folders differ only by case (`/Clients/Acme` vs
 *      `/Clients/acme`) stay SEPARATE on a case-sensitive filesystem — no
 *      cross-client bleed; Windows drive-letter / UNC paths compare
 *      CASE-INSENSITIVELY because the Windows filesystem is (so `C:\…\Acme` and
 *      `c:\…\acme` are the same physical folder — they cannot coexist there).
 *   3. A matter mapped to the workspace ROOT (e.g. the onboarding sample matter,
 *      `folderPaths: [workspaceRoot]`) is naturally an include-EVERYTHING scope:
 *      `isPathInFolder(node, root)` is true for every node, and `resolveMatterId`
 *      gives it longest-match ownership of anything no deeper matter claims — so
 *      that client's Documents tab lists all its files (minus nested
 *      foreign-client folders), never empty.
 *
 * Matching is whole-segment, so `/ws/Acme` never matches `/ws/Acme Two`.
 */
import type { FileNode } from '@/platform/types/workspace';
import type { Matter } from '@/platform/types/matter';
import { isPathInFolder, normalize, resolveMatterId } from '@/platform/rag/matterResolver';

/** True when `path` is a strict ancestor of `folder` (so we must descend into
 *  it to reach the scoped folder). */
function isAncestorOf(path: string, folder: string): boolean {
  return isPathInFolder(folder, path) && normalize(path) !== normalize(folder);
}

/**
 * Resolve a possibly-relative tree node path to an absolute path under the
 * workspace root, so it can be compared against the matters' absolute
 * `folderPaths` with the SAME logic the resolver/indexer use (case sensitivity
 * follows the path's filesystem shape; see the module doc).
 *
 * - No `workspaceRoot` (back-compat / tests that use one path shape on both
 *   sides) → the path is compared as-is.
 * - Already absolute (equals the root or sits under it) → normalized as-is.
 * - Relative → joined under the normalized root.
 *
 * Case is preserved (we only normalize separators / trailing slash), so the
 * comparison stays consistent with `resolveMatterId`.
 */
function toAbsolute(p: string, workspaceRoot?: string | null): string {
  const np = normalize(p);
  if (!workspaceRoot) return np;
  const nr = normalize(workspaceRoot);
  if (np === nr || np.startsWith(`${nr}/`)) return np;
  return `${nr}/${np.replace(/^\/+/, '')}`;
}

/**
 * Return a pruned copy of `tree` limited to the given `folderPaths`.
 *
 * - `folderPaths` empty → returns `[]` (a client with no mapped folders has no
 *   scoped documents; the caller shows an honest empty state).
 * - A folder mapped to the workspace ROOT is an INCLUDE-EVERYTHING scope (see the
 *   module doc): it returns the whole tree, still minus nested foreign-client
 *   folders when ownership context is supplied.
 * - A node at/under any folder path is included; an ancestor folder is kept only
 *   for the branch leading down to a scoped folder.
 * - **Matter isolation:** when `matters` + `scopeMatterId` are supplied, a
 *   descendant whose longest-match owner is a DIFFERENT matter (a subfolder
 *   mapped to another client, nested inside this client's folder) is DROPPED —
 *   using the shared `resolveMatterId` — so one client's tab can
 *   never surface another client's files. Without that context the prune is
 *   purely folder-based (back-compat).
 * - `workspaceRoot` (when known) bridges absolute matter folders against relative
 *   tree node paths. Always pass it from the live workspace; omit only in pure
 *   tests that use one path shape on both sides.
 */
/**
 * Find the folder node in `tree` (a `scopeFileTreeToFolders` result) whose
 * absolute path matches `folderPath` (the `Matter.folderPaths` shape) and
 * return its RAW `node.path` — whatever shape THIS tree actually uses.
 *
 * `scopeFileTreeToFolders` preserves `node.path` verbatim from the store
 * tree, and that shape depends on the FS backend (workspace-RELATIVE in
 * production; some callers/tests already use absolute-shaped paths — see
 * `toAbsolute`'s doc). A strict-equality tree lookup
 * (`node.path === currentFolderPath`) needs a value in that SAME shape, so
 * rather than assume one shape, this walks the actual tree and matches in
 * absolute-space (the same comparison the prune above uses) — whichever
 * shape is really in play, the returned value is one the lookup can find.
 * Without this bridge, a raw absolute `folderPaths[0]` seeded directly as
 * `currentFolderPath` never equals a relative `node.path`, so the scoped
 * Grid view renders empty even though the scoped tree has files.
 *
 * Returns `null` when `folderPath` resolves to the workspace root itself (an
 * include-everything scope, e.g. the onboarding sample matter) OR when no
 * matching folder node is found in `tree` — both cases fall back to the
 * scoped root (`currentFolderPath === null`), never a dead-end lookup.
 */
export function toScopedFolderPath(
  tree: FileNode[],
  folderPath: string,
  workspaceRoot?: string | null,
): string | null {
  const target = toAbsolute(folderPath, workspaceRoot);
  if (workspaceRoot && target === normalize(workspaceRoot)) return null;

  function search(nodes: FileNode[]): string | null {
    for (const node of nodes) {
      if (node.type !== 'folder') continue;
      if (toAbsolute(node.path, workspaceRoot) === target) return node.path;
      if (node.children) {
        const found = search(node.children);
        if (found !== null) return found;
      }
    }
    return null;
  }

  return search(tree);
}

export function scopeFileTreeToFolders(
  tree: FileNode[],
  folderPaths: string[],
  matters?: Matter[],
  scopeMatterId?: string,
  workspaceRoot?: string | null,
): FileNode[] {
  const folders = folderPaths.filter(Boolean);
  if (folders.length === 0) return [];
  const ownershipAware = matters !== undefined && scopeMatterId !== undefined;

  function prune(node: FileNode): FileNode | null {
    // Compare the node in the SAME absolute space as the matters' folderPaths
    // and the resolver/indexer (case sensitivity follows path shape; module doc).
    const abs = toAbsolute(node.path, workspaceRoot);

    // Inside one of the matter's folders (a root-mapped folder matches all).
    if (folders.some((f) => isPathInFolder(abs, f))) {
      if (!ownershipAware) {
        // Folder-based only: keep the whole subtree.
        return node;
      }
      // Ownership-aware: a node whose longest-match owner is a DIFFERENT matter
      // (a nested foreign-client subfolder/file) must be dropped, not leaked.
      // Reuses the exact resolver the indexer uses (shape-keyed case sensitivity).
      if (resolveMatterId(abs, matters) !== scopeMatterId) {
        return null;
      }
      // Ours — recurse folders, since a deeper subfolder could belong to another
      // matter even though this level is ours.
      if (node.type === 'folder') {
        const children = (node.children ?? [])
          .map(prune)
          .filter((c): c is FileNode => c !== null);
        return { ...node, children };
      }
      return node;
    }

    // A folder above a scoped folder: keep only the branch that reaches it.
    if (node.type === 'folder' && folders.some((f) => isAncestorOf(abs, f))) {
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
