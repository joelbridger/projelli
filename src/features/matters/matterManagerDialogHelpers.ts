// Helpers extracted from MatterManagerDialog.tsx — pure module-scope utilities.

import type { FileNode } from '@/types/workspace';
import { AuditService } from '@/platform/audit/AuditService';

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

/** Generate a random 16-char temporary password. */
export function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => chars[b % chars.length] ?? '?').join('');
}

export const audit = new AuditService('firm');
