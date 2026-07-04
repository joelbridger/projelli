// Helpers extracted from MatterManagerDialog.tsx — pure module-scope utilities.

import type { FileNode } from '@/platform/types/workspace';
import { AuditService } from '@/platform/audit/AuditService';
import { isPathInFolder, normalize as normalizeMatterPath } from '@/platform/rag/matterResolver';
import { workspacePath } from '@/platform/fs/appPath';

/**
 * QA-5 — sanitize a client/matter name into a safe SINGLE path segment. Strips
 * anything that could let a client escape its own subfolder (slashes, colons,
 * the usual illegal filename characters), collapses whitespace, and drops
 * trailing dots/spaces (invalid folder names on Windows). Returns '' when
 * nothing usable remains — INCLUDING a dot-only name (".", ".."), which would
 * otherwise collapse to the workspace root/parent once the scope resolver folds
 * dot segments (Codex review: isolation hole).
 */
function sanitizeFolderName(name: string): string {
  const cleaned = name
    .trim()
    // Replace path separators + reserved/illegal filename characters with a space.
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Trailing dots/spaces are illegal as a Windows folder name.
    .replace(/[.\s]+$/g, '');
  // A name made only of dots (or now empty) is not a real folder — reject it so
  // it can never resolve to the workspace itself or its parent.
  if (/^\.*$/.test(cleaned)) return '';
  return cleaned;
}

export function clientFolderSegment(clientName: string, matterName: string): string {
  // Prefer the client name; fall back to the matter name only if the client
  // name sanitizes to nothing (e.g. a dot-only client name).
  return sanitizeFolderName(clientName) || sanitizeFolderName(matterName);
}

/**
 * QA-5 — derive the absolute workspace subfolder a brand-new client should own
 * and be scoped to, matching the seeded-client pattern (one folder per client
 * under the workspace root, named for the client). The result is fed straight
 * into `matter.folderPaths` so the client's documents are isolated from the
 * first action.
 *
 * - Returns `null` when there is no open workspace (nothing to scope to) or the
 *   name is empty — callers then create the client with no folder (unchanged
 *   pre-QA-5 behaviour) rather than inventing a bogus path.
 * - Uniquifies against `takenFolderPaths` (every OTHER client's linked folders)
 *   so two same-named clients never share a folder — matter isolation is the
 *   whole point of the field.
 */
export function deriveNewClientFolderPath(
  clientName: string,
  matterName: string,
  workspaceRoot: string | null,
  takenFolderPaths: string[],
): string | null {
  if (!workspaceRoot) return null;
  const segment = clientFolderSegment(clientName, matterName);
  if (!segment) return null;

  const root = normalizeMatterPath(workspaceRoot);
  // Collision check must use the SAME absolute coordinate system the matter
  // resolver uses (Codex review): an existing matter may still hold a
  // workspace-RELATIVE folderPath ('Smith') that resolves to the same absolute
  // folder as this candidate ('/ws/Smith'). Canonicalize both sides to absolute
  // before comparing.
  // Lowercased so collisions are caught on case-insensitive filesystems too
  // (Windows/macOS): '/ws/smith' and '/ws/Smith' are the SAME real folder there,
  // so they must never resolve to two different clients.
  const takenAbs = takenFolderPaths.map((p) => workspacePath(workspaceRoot, p).toLowerCase());
  // A candidate is free only if NO existing client's folder is the same as, or
  // NESTED INSIDE, the candidate — because matter scoping includes every
  // descendant, so a candidate that engulfs another client's folder (e.g.
  // candidate '/ws/Smith' vs existing '/ws/Smith/Docs') would leak that client's
  // files into the new one. We intentionally do NOT reject a candidate that sits
  // *inside* a taken folder: the only such case is the whole-workspace
  // "everything" scope (folderPaths:[workspaceRoot]), under which per-client
  // subfolders legitimately live — rejecting it would also loop forever.
  const isFree = (candidate: string): boolean =>
    !takenAbs.some((t) => isPathInFolder(t, candidate.toLowerCase()));

  let candidate = `${root}/${segment}`;
  let n = 2;
  while (!isFree(candidate)) {
    candidate = `${root}/${segment} ${String(n)}`;
    n += 1;
  }
  return candidate;
}

/** Collect every folder path in the workspace tree (depth-first, sorted). */
export function collectFolderPaths(nodes: FileNode[]): string[] {
  const out: string[] = [];
  const walk = (ns: FileNode[]) => {
    for (const n of ns) {
      if (n.type === 'folder') {
        out.push(n.path);
        if (n.children) walk(n.children);
      }
    }
  };
  walk(nodes);
  return out.sort();
}

/** A short label for a folder path relative to the workspace root. */
export function relLabel(path: string, root: string | null): string {
  if (!root) return path;
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const p = path.replace(/\\/g, '/');
  return p.startsWith(`${r}/`) ? p.slice(r.length + 1) : p;
}

export function folderPathRelativeKey(path: string, rootPath: string | null): string {
  const normalized = normalizeMatterPath(path);
  if (!rootPath) return normalized;
  const root = normalizeMatterPath(rootPath);
  if (!root) return normalized;
  if (normalized === root) return '';
  return normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : normalized;
}

export function folderPathsMatch(candidate: string, mapped: string, rootPath: string | null): boolean {
  const c = normalizeMatterPath(candidate);
  const m = normalizeMatterPath(mapped);
  if (!c || !m) return false;
  if (c === m) return true;
  if (folderPathRelativeKey(c, rootPath) === folderPathRelativeKey(m, rootPath)) return true;
  if (folderPathRelativeKey(c, rootPath) === m || folderPathRelativeKey(m, rootPath) === c) return true;
  if (isPathInFolder(c, m) && isPathInFolder(m, c)) return true;
  return c.endsWith(`/${m}`) || m.endsWith(`/${c}`);
}

export function dedupeFolderPathsForDisplay(paths: string[], rootPath: string | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const key = folderPathRelativeKey(path, rootPath);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(normalizeMatterPath(path));
  }
  return out;
}

/** Generate a random 16-char temporary password. */
export function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => chars[b % chars.length] ?? '?').join('');
}

export const audit = new AuditService('firm');
