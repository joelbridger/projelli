/**
 * scopeFileTree.test.ts — the pure tree-prune that powers the per-client
 * Documents sub-tab. It must keep only a client's folders (whole subtree),
 * keep ancestor folders needed to reach them, drop everything else, never
 * mutate the input, and match by whole path segments (no prefix bleed).
 */
import { describe, it, expect } from 'vitest';
import { scopeFileTreeToFolders } from '@/features/documents/scopeFileTree';
import type { FileNode } from '@/platform/types/workspace';
import type { Matter } from '@/platform/types/matter';

function matter(id: string, folderPaths: string[]): Matter {
  return { id, name: id, client: id, folderPaths, createdAt: '2026-01-01T00:00:00.000Z' };
}

function folder(path: string, children: FileNode[] = []): FileNode {
  return { id: path, name: path.split('/').pop() ?? path, path, type: 'folder', children };
}
function file(path: string): FileNode {
  return { id: path, name: path.split('/').pop() ?? path, path, type: 'file' };
}

const TREE: FileNode[] = [
  folder('/ws/Webb Household', [file('/ws/Webb Household/Plan.md'), folder('/ws/Webb Household/Sub', [file('/ws/Webb Household/Sub/deep.md')])]),
  folder('/ws/Other Client', [file('/ws/Other Client/x.md')]),
  folder('/ws/Webb Household Two', [file('/ws/Webb Household Two/y.md')]),
  file('/ws/loose.md'),
];

describe('scopeFileTreeToFolders', () => {
  it('returns [] for no folder paths', () => {
    expect(scopeFileTreeToFolders(TREE, [])).toEqual([]);
  });

  it('keeps the matched folder with its full subtree, drops the rest', () => {
    const out = scopeFileTreeToFolders(TREE, ['/ws/Webb Household']);
    expect(out).toHaveLength(1);
    expect(out[0]!.path).toBe('/ws/Webb Household');
    // Whole subtree preserved.
    expect(out[0]!.children?.map((c) => c.path)).toEqual([
      '/ws/Webb Household/Plan.md',
      '/ws/Webb Household/Sub',
    ]);
  });

  it('matches by whole segments — "/ws/Webb Household" does not match "/ws/Webb Household Two"', () => {
    const out = scopeFileTreeToFolders(TREE, ['/ws/Webb Household']);
    expect(out.map((n) => n.path)).not.toContain('/ws/Webb Household Two');
    expect(out.map((n) => n.path)).not.toContain('/ws/Other Client');
    expect(out.map((n) => n.path)).not.toContain('/ws/loose.md');
  });

  it('keeps an ancestor folder but only the branch leading to the scoped folder', () => {
    const nested: FileNode[] = [
      folder('/ws/Clients', [
        folder('/ws/Clients/Webb', [file('/ws/Clients/Webb/f.md')]),
        folder('/ws/Clients/Acme', [file('/ws/Clients/Acme/g.md')]),
      ]),
    ];
    const out = scopeFileTreeToFolders(nested, ['/ws/Clients/Webb']);
    expect(out).toHaveLength(1);
    expect(out[0]!.path).toBe('/ws/Clients');
    expect(out[0]!.children?.map((c) => c.path)).toEqual(['/ws/Clients/Webb']);
  });

  it('supports multiple scoped folders', () => {
    const out = scopeFileTreeToFolders(TREE, ['/ws/Webb Household', '/ws/Other Client']);
    expect(out.map((n) => n.path).sort()).toEqual(['/ws/Other Client', '/ws/Webb Household']);
  });

  it('does not mutate the input tree', () => {
    const snapshot = JSON.stringify(TREE);
    scopeFileTreeToFolders(TREE, ['/ws/Clients/Webb']);
    expect(JSON.stringify(TREE)).toBe(snapshot);
  });

  it('drops a nested subfolder owned by ANOTHER client (matter-isolation leak)', () => {
    // Client A owns /ws/Clients; client B owns the nested /ws/Clients/Beta.
    const nested: FileNode[] = [
      folder('/ws/Clients', [
        folder('/ws/Clients/Acme', [file('/ws/Clients/Acme/deal.docx')]),
        folder('/ws/Clients/Beta', [file('/ws/Clients/Beta/secret.docx')]),
      ]),
    ];
    const matters = [matter('A', ['/ws/Clients']), matter('B', ['/ws/Clients/Beta'])];

    const out = scopeFileTreeToFolders(nested, ['/ws/Clients'], matters, 'A');
    expect(out).toHaveLength(1);
    expect(out[0]!.path).toBe('/ws/Clients');
    const childPaths = out[0]!.children?.map((c) => c.path) ?? [];
    expect(childPaths).toContain('/ws/Clients/Acme');
    // B's folder must NOT leak into A's scoped view.
    expect(childPaths).not.toContain('/ws/Clients/Beta');
  });

  it('without matter context, prune is folder-based only (back-compat)', () => {
    const nested: FileNode[] = [
      folder('/ws/Clients', [folder('/ws/Clients/Beta', [file('/ws/Clients/Beta/x.docx')])]),
    ];
    // No matters passed → the nested folder is kept (no ownership awareness).
    const out = scopeFileTreeToFolders(nested, ['/ws/Clients']);
    expect(out[0]!.children?.map((c) => c.path)).toEqual(['/ws/Clients/Beta']);
  });

  it('normalizes path shapes the way matter resolution does (backslashes / trailing slash)', () => {
    // Reuses isPathInFolder/normalize, so a Windows-style or trailing-slash
    // matter folder still matches a forward-slash tree node (Codex review P2).
    const win: FileNode[] = [
      folder('C:/WS/Clients/Acme', [file('C:/WS/Clients/Acme/deal.docx')]),
      folder('C:/WS/Clients/Beta', [file('C:/WS/Clients/Beta/x.docx')]),
    ];
    const out = scopeFileTreeToFolders(win, ['C:\\WS\\Clients\\Acme\\']);
    expect(out).toHaveLength(1);
    expect(out[0]!.path).toBe('C:/WS/Clients/Acme');
  });

  // ── BUG-1 regression (Phase C bench, 2026-06-29) ────────────────────────
  // The live store file tree's node paths are workspace-RELATIVE (from the FS
  // backend's list()), but a matter's folderPaths are ABSOLUTE. With no shared
  // root the two shapes never matched, so EVERY client's Documents tab showed
  // empty even though the files were loaded. Passing `workspaceRoot` must
  // collapse the shapes and scope correctly. Output paths stay as-is (relative).
  describe('BUG-1: relative tree node paths vs absolute matter folderPaths', () => {
    // Relative tree (exactly what the FS backend produces), absolute matter folders.
    const relTree: FileNode[] = [
      folder('Clients', [
        folder('Clients/Caldwell, Jennifer', [
          folder('Clients/Caldwell, Jennifer/Agreements', [
            file('Clients/Caldwell, Jennifer/Agreements/IAA.pdf'),
          ]),
          file('Clients/Caldwell, Jennifer/Plan.pdf'),
        ]),
        folder('Clients/Diaz, Michelle', [file('Clients/Diaz, Michelle/x.pdf')]),
      ]),
      folder('_Firm', [file('_Firm/policy.pdf')]),
    ];
    const ROOT = 'C:/keepance-demo-northcrest/Northcrest Wealth Partners';
    const absFolder = `${ROOT}/Clients/Caldwell, Jennifer`;

    it('scopes a relative tree to an absolute folder when workspaceRoot is given', () => {
      const out = scopeFileTreeToFolders(relTree, [absFolder], undefined, undefined, ROOT);
      // Keeps the ancestor "Clients" branch leading to Caldwell, drops _Firm + Diaz.
      expect(out.map((n) => n.path)).toEqual(['Clients']);
      expect(out[0]!.children?.map((c) => c.path)).toEqual(['Clients/Caldwell, Jennifer']);
      const caldwell = out[0]!.children![0]!;
      // Caldwell's full subtree (relative paths preserved unchanged) survives.
      expect(caldwell.children?.map((c) => c.path)).toEqual([
        'Clients/Caldwell, Jennifer/Agreements',
        'Clients/Caldwell, Jennifer/Plan.pdf',
      ]);
    });

    it('demonstrates the bug: WITHOUT workspaceRoot the abs↔rel mismatch yields empty', () => {
      const out = scopeFileTreeToFolders(relTree, [absFolder]);
      expect(out).toEqual([]); // the pre-fix behavior — proves root is what saves it
    });

    it('also works when the tree node paths are themselves absolute', () => {
      const absTree: FileNode[] = [
        folder(`${ROOT}/Clients`, [
          folder(`${ROOT}/Clients/Caldwell, Jennifer`, [file(`${ROOT}/Clients/Caldwell, Jennifer/Plan.pdf`)]),
          folder(`${ROOT}/Clients/Diaz, Michelle`, [file(`${ROOT}/Clients/Diaz, Michelle/x.pdf`)]),
        ]),
      ];
      const out = scopeFileTreeToFolders(absTree, [absFolder], undefined, undefined, ROOT);
      expect(out[0]!.children?.map((c) => c.path)).toEqual([`${ROOT}/Clients/Caldwell, Jennifer`]);
    });

    it('keeps matter isolation with relative tree + absolute matter folders', () => {
      // Caldwell (scope) owns her folder; a nested foreign client folder must not leak.
      const nested: FileNode[] = [
        folder('Clients', [
          folder('Clients/Caldwell, Jennifer', [
            file('Clients/Caldwell, Jennifer/own.pdf'),
            folder('Clients/Caldwell, Jennifer/Shared-Beta', [
              file('Clients/Caldwell, Jennifer/Shared-Beta/secret.pdf'),
            ]),
          ]),
        ]),
      ];
      const matters = [
        matter('caldwell', [`${ROOT}/Clients/Caldwell, Jennifer`]),
        matter('beta', [`${ROOT}/Clients/Caldwell, Jennifer/Shared-Beta`]),
      ];
      const out = scopeFileTreeToFolders(
        nested,
        [`${ROOT}/Clients/Caldwell, Jennifer`],
        matters,
        'caldwell',
        ROOT,
      );
      const caldwell = out[0]!.children![0]!;
      const childPaths = caldwell.children?.map((c) => c.path) ?? [];
      expect(childPaths).toContain('Clients/Caldwell, Jennifer/own.pdf');
      // Beta's nested folder must NOT leak into Caldwell's scoped view.
      expect(childPaths).not.toContain('Clients/Caldwell, Jennifer/Shared-Beta');
    });
  });
});
