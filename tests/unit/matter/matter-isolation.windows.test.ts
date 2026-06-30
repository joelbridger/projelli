/**
 * Matter (client) isolation on WINDOWS-style paths.
 *
 * `resolveMatterId` / `isPathInFolder` decide which client a file belongs to —
 * the core of the matter-scope guard that gates every AI file tool and the open-
 * file context. On Windows these must be case-insensitive and separator-agnostic,
 * or a client's own file resolves to "unassigned" (locked out of its matter) or,
 * worse, a path could be mis-attributed. These tests pin that.
 */

import { describe, it, expect } from 'vitest';
import {
  isPathInFolder,
  resolveMatterId,
} from '@/platform/rag/matterResolver';
import { pathInMatterScope } from '@/platform/matter/matterScopeGuard';
import { UNASSIGNED_MATTER_ID, type Matter } from '@/platform/types/matter';

function matter(id: string, folderPaths: string[]): Matter {
  return {
    id,
    name: id,
    client: id,
    folderPaths,
    mailFolderPaths: [],
    crmHouseholdKeys: [],
    createdAt: 0,
    updatedAt: 0,
  } as unknown as Matter;
}

describe('isPathInFolder — Windows', () => {
  it('matches across separator + case', () => {
    expect(isPathInFolder('C:/WS/Acme/doc.docx', 'C:\\WS\\acme')).toBe(true);
    expect(isPathInFolder('c:\\ws\\acme\\sub\\doc.docx', 'C:/WS/Acme')).toBe(true);
  });

  it('respects folder boundaries', () => {
    expect(isPathInFolder('C:\\WS\\Acme Corp\\doc.docx', 'C:\\WS\\Acme')).toBe(false);
  });
});

describe('resolveMatterId — Windows', () => {
  const matterA = matter('matter-a', ['C:\\WS\\Acme']);
  const matterB = matter('matter-b', ['C:\\WS\\Beta']);
  const matters = [matterA, matterB];

  it('resolves a file to its matter despite separator + case differences', () => {
    expect(resolveMatterId('c:/ws/acme/sub/secret.docx', matters)).toBe('matter-a');
    expect(resolveMatterId('C:\\WS\\Beta\\notes.docx', matters)).toBe('matter-b');
  });

  it('keeps a different client out of the wrong matter', () => {
    // Beta's file must NOT resolve to matter-a even with mixed case.
    expect(resolveMatterId('C:/WS/beta/x.docx', matters)).toBe('matter-b');
  });

  it('returns unassigned for a path outside every matter folder', () => {
    expect(resolveMatterId('D:\\Elsewhere\\x.docx', matters)).toBe(UNASSIGNED_MATTER_ID);
  });

  it('longest (most specific) mapped folder still wins on Windows', () => {
    const parent = matter('parent', ['C:\\WS\\Clients']);
    const child = matter('child', ['C:\\WS\\Clients\\Acme']);
    expect(resolveMatterId('c:/ws/clients/acme/doc.docx', [parent, child])).toBe('child');
  });

  it('FAILS CLOSED on a case-only folder collision across two matters (Codex P1)', () => {
    // On a case-SENSITIVE Windows-shaped volume `C:\WS\Acme` and `C:\WS\acme`
    // are two DIFFERENT clients. Because containment folds case on Windows-shaped
    // paths, a file under one would match BOTH at equal depth. Silently picking
    // the first matter would leak one client's file under the other's scope, so
    // resolution must fail closed (UNASSIGNED) rather than guess.
    const upper = matter('upper', ['C:\\WS\\Acme']);
    const lower = matter('lower', ['C:\\WS\\acme']);
    expect(resolveMatterId('C:\\WS\\Acme\\secret.docx', [upper, lower])).toBe(
      UNASSIGNED_MATTER_ID,
    );
    // And the guard does not over-fire when only ONE matter owns the folder.
    expect(resolveMatterId('C:\\WS\\Acme\\secret.docx', [upper])).toBe('upper');
  });
});

describe('pathInMatterScope — Windows', () => {
  const matterA = matter('matter-a', ['C:\\WS\\Acme']);
  const matters = [matterA];

  it('allows the active matter file (mixed case) and blocks another client', () => {
    expect(pathInMatterScope('c:/ws/acme/doc.docx', 'matter-a', matters)).toBe(true);
    expect(pathInMatterScope('C:\\WS\\Beta\\doc.docx', 'matter-a', matters)).toBe(false);
  });

  it('still fails closed on a parent traversal regardless of separator', () => {
    expect(pathInMatterScope('C:\\WS\\Acme\\..\\Beta\\doc.docx', 'matter-a', matters)).toBe(false);
  });
});
