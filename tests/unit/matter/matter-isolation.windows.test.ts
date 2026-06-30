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
  it('matches across separator + DRIVE case (segments keep their case)', () => {
    expect(isPathInFolder('C:/WS/Acme/doc.docx', 'C:\\WS\\Acme')).toBe(true);
    expect(isPathInFolder('c:\\WS\\Acme\\sub\\doc.docx', 'C:/WS/Acme')).toBe(true);
  });

  it('FAILS CLOSED on a case-only SEGMENT difference (different client folder)', () => {
    // `acme` is a different client folder from `Acme` on a case-sensitive volume.
    expect(isPathInFolder('C:/WS/acme/doc.docx', 'C:\\WS\\Acme')).toBe(false);
    expect(isPathInFolder('c:\\ws\\acme\\sub\\doc.docx', 'C:/WS/Acme')).toBe(false);
  });

  it('respects folder boundaries', () => {
    expect(isPathInFolder('C:\\WS\\Acme Corp\\doc.docx', 'C:\\WS\\Acme')).toBe(false);
  });
});

describe('resolveMatterId — Windows', () => {
  const matterA = matter('matter-a', ['C:\\WS\\Acme']);
  const matterB = matter('matter-b', ['C:\\WS\\Beta']);
  const matters = [matterA, matterB];

  it('resolves a file to its matter despite separator + drive-case differences', () => {
    expect(resolveMatterId('c:/WS/Acme/sub/secret.docx', matters)).toBe('matter-a');
    expect(resolveMatterId('C:\\WS\\Beta\\notes.docx', matters)).toBe('matter-b');
  });

  it('does NOT pull a file from a case-only sibling folder into the matter', () => {
    // A file under `acme` (a DIFFERENT client) must NOT resolve to matter-a (Acme).
    expect(resolveMatterId('C:/WS/acme/x.docx', matters)).toBe(UNASSIGNED_MATTER_ID);
  });

  it('returns unassigned for a path outside every matter folder', () => {
    expect(resolveMatterId('D:\\Elsewhere\\x.docx', matters)).toBe(UNASSIGNED_MATTER_ID);
  });

  it('longest (most specific) mapped folder still wins on Windows', () => {
    const parent = matter('parent', ['C:\\WS\\Clients']);
    const child = matter('child', ['C:\\WS\\Clients\\Acme']);
    expect(resolveMatterId('C:\\WS\\Clients\\Acme\\doc.docx', [parent, child])).toBe('child');
  });

  it('attributes case-distinct sibling folders to the RIGHT matter (no cross-leak)', () => {
    // On a case-SENSITIVE Windows-shaped volume `C:\WS\Acme` and `C:\WS\acme`
    // are two DIFFERENT clients. Case-sensitive segment comparison attributes
    // each file to its OWN matter — never the sibling — so neither leaks.
    const upper = matter('upper', ['C:\\WS\\Acme']);
    const lower = matter('lower', ['C:\\WS\\acme']);
    expect(resolveMatterId('C:\\WS\\Acme\\secret.docx', [upper, lower])).toBe('upper');
    expect(resolveMatterId('C:\\WS\\acme\\secret.docx', [upper, lower])).toBe('lower');
  });

  it('fails closed when two matters map the EXACT same folder (ambiguous)', () => {
    // A genuine duplicate mapping (config error) is ambiguous → unassigned.
    const a = matter('dup-a', ['C:\\WS\\Acme']);
    const b = matter('dup-b', ['c:/WS/Acme']);
    expect(resolveMatterId('C:\\WS\\Acme\\x.docx', [a, b])).toBe(UNASSIGNED_MATTER_ID);
  });
});

describe('pathInMatterScope — Windows', () => {
  const matterA = matter('matter-a', ['C:\\WS\\Acme']);
  const matters = [matterA];

  it('allows the matter file (drive/separator variant) and blocks another client', () => {
    expect(pathInMatterScope('c:/WS/Acme/doc.docx', 'matter-a', matters)).toBe(true);
    expect(pathInMatterScope('C:\\WS\\Beta\\doc.docx', 'matter-a', matters)).toBe(false);
  });

  it('BLOCKS a file in a case-only sibling folder (Codex P1 — no cross-client leak)', () => {
    // `acme` ≠ `Acme`: a file there must NOT be reachable under matter-a's scope.
    expect(pathInMatterScope('C:\\WS\\acme\\secret.docx', 'matter-a', matters)).toBe(false);
    expect(pathInMatterScope('c:/ws/acme/secret.docx', 'matter-a', matters)).toBe(false);
  });

  it('still fails closed on a parent traversal regardless of separator', () => {
    expect(pathInMatterScope('C:\\WS\\Acme\\..\\Beta\\doc.docx', 'matter-a', matters)).toBe(false);
  });
});
