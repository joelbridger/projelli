import { describe, expect, it } from 'vitest';
import {
  resolveClientDocumentFolderPaths,
  shouldBackfillClientDocumentFolder,
} from '@/app/shell/clientDocumentFolderPaths';
import type { Matter } from '@/platform/types/matter';

function matter(overrides: Partial<Matter>): Matter {
  return {
    id: 'matter-1',
    name: 'Hendricks Household',
    client: 'Hendricks Household',
    folderPaths: [],
    createdAt: '2026-07-09T00:00:00.000Z',
    ...overrides,
  };
}

describe('client document folder derivation', () => {
  it('keeps an existing linked client folder', () => {
    const m = matter({ folderPaths: ['/ws/Clients/Hendricks'] });

    expect(resolveClientDocumentFolderPaths({
      matter: m,
      matters: [m],
      workspaceRoot: '/ws',
    })).toEqual(['/ws/Clients/Hendricks']);
    expect(shouldBackfillClientDocumentFolder(m, ['/ws/Clients/Hendricks'])).toBe(false);
  });

  it('derives a safe workspace folder when a client has no linked folder yet', () => {
    const m = matter({ folderPaths: [] });

    const resolved = resolveClientDocumentFolderPaths({
      matter: m,
      matters: [m],
      workspaceRoot: '/ws',
    });

    expect(resolved).toEqual(['/ws/Hendricks Household']);
    expect(shouldBackfillClientDocumentFolder(m, resolved)).toBe(true);
  });

  it('does not reuse another client folder name', () => {
    const existing = matter({
      id: 'matter-existing',
      folderPaths: ['/ws/Hendricks Household'],
    });
    const m = matter({ id: 'matter-new', folderPaths: [] });

    expect(resolveClientDocumentFolderPaths({
      matter: m,
      matters: [existing, m],
      workspaceRoot: '/ws',
    })).toEqual(['/ws/Hendricks Household 2']);
  });

  it('does not invent a folder without an open workspace', () => {
    const m = matter({ folderPaths: [] });

    expect(resolveClientDocumentFolderPaths({
      matter: m,
      matters: [m],
      workspaceRoot: null,
    })).toEqual([]);
    expect(shouldBackfillClientDocumentFolder(m, [])).toBe(false);
  });
});
