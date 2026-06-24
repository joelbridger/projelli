// Helpers extracted from MatterManagerDialog.tsx — pure module-scope utilities.

import type { FileNode } from '@/platform/types/workspace';
import { AuditService } from '@/platform/audit/AuditService';
import { isPathInFolder, normalize as normalizeMatterPath } from '@/platform/rag/matterResolver';

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
