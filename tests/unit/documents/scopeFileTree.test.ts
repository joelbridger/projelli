/**
 * scopeFileTree.test.ts — the pure tree-prune that powers the per-client
 * Documents sub-tab. It must keep only a client's folders (whole subtree),
 * keep ancestor folders needed to reach them, drop everything else, never
 * mutate the input, and match by whole path segments (no prefix bleed).
 */
import { describe, it, expect } from 'vitest';
import { scopeFileTreeToFolders } from '@/features/documents/scopeFileTree';
import type { FileNode } from '@/platform/types/workspace';

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
});
