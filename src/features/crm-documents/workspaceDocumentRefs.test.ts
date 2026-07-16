import { describe, expect, it } from 'vitest';
import {
  WorkspaceDocumentRefError,
  addWorkspaceDocumentRef,
  listWorkspaceDocumentRefs,
  removeWorkspaceDocumentRef,
  resolveWorkspaceDocumentRef,
} from '@/features/crm-documents';
import type { FileNode } from '@/platform/types/workspace';
import type { Matter } from '@/platform/types/matter';

const fileTree: readonly FileNode[] = [{
  id: 'clients',
  name: 'Clients',
  path: '/workspace/Clients',
  type: 'folder',
  children: [
    { id: 'review', name: 'review.docx', path: '/workspace/Clients/River/review.docx', type: 'file' },
    { id: 'installer', name: 'installer.exe', path: '/workspace/Clients/River/installer.exe', type: 'file' },
    { id: 'other', name: 'plan.pdf', path: '/workspace/Clients/Lake/plan.pdf', type: 'file' },
  ],
}];

const matters: Matter[] = [
  { id: 'matter-river', name: 'River', client: 'River', folderPaths: ['/workspace/Clients/River'], createdAt: '2026-01-01T00:00:00Z' },
  { id: 'matter-lake', name: 'Lake', client: 'Lake', folderPaths: ['/workspace/Clients/Lake'], createdAt: '2026-01-01T00:00:00Z' },
];

const context = {
  workspaceRoot: '/workspace',
  fileTree,
  matters,
  targetMatterId: 'matter-river',
};

describe('public existing-document reference contract', () => {
  it('resolves only a current workspace file to a portable matter-owned pointer', () => {
    const before = structuredClone(fileTree);
    const ref = resolveWorkspaceDocumentRef({
      ...context,
      path: '/workspace/Clients/River/review.docx',
    });

    expect(ref).toEqual({
      kind: 'document',
      id: 'Clients/River/review.docx',
      label: 'review.docx',
      matterId: 'matter-river',
    });
    expect(fileTree).toEqual(before);
  });

  it.each([
    ['outside workspace', '/outside/review.docx', 'unsafe_path'],
    ['traversal', '../River/review.docx', 'unsafe_path'],
    ['absent', '/workspace/Clients/River/missing.docx', 'not_found'],
    ['unsupported', '/workspace/Clients/River/installer.exe', 'unsupported'],
    ['wrong matter', '/workspace/Clients/Lake/plan.pdf', 'wrong_matter'],
    ['malformed', '', 'malformed'],
  ] as const)('rejects an %s path', (_label, path, code) => {
    expect(() => resolveWorkspaceDocumentRef({ ...context, path })).toThrow(
      expect.objectContaining<Partial<WorkspaceDocumentRefError>>({ code })
    );
  });

  it('rejects duplicate pointers and keeps mixed context references stable on add/remove', () => {
    expect(() => resolveWorkspaceDocumentRef({
      ...context,
      path: '/workspace/Clients/River/review.docx',
      existing: [{ kind: 'document', id: '/workspace/Clients/River/review.docx', label: 'review.docx' }],
    })).toThrow(expect.objectContaining<Partial<WorkspaceDocumentRefError>>({ code: 'duplicate' }));

    const household = { kind: 'household' as const, id: 'household-1' };
    const ref = resolveWorkspaceDocumentRef({ ...context, path: '/workspace/Clients/River/review.docx' });
    const added = addWorkspaceDocumentRef([household], ref);
    expect(listWorkspaceDocumentRefs(added)).toEqual([ref]);
    expect(() => addWorkspaceDocumentRef(added, ref)).toThrow(
      expect.objectContaining<Partial<WorkspaceDocumentRefError>>({ code: 'duplicate' })
    );
    expect(removeWorkspaceDocumentRef(added, ref.id)).toEqual([household]);
  });
});
