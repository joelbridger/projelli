/**
 * WS-B/C app — Matter store + resolver.
 *
 * Covers:
 *   - createMatter / renameMatter / deleteMatter / folder mapping CRUD
 *   - resolveMatterId: path -> matter, longest-prefix wins, folder-boundary
 *     correctness, unassigned fallback, mail: ids
 *   - active matter -> retrieval scope (matter vs explicit allMatters)
 *   - deleting the active matter falls back to all-matters
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveMatterId,
  findMatter,
  isPathInFolder,
  matterLabel,
} from '@/platform/rag/matterResolver';
import { UNASSIGNED_MATTER_ID, type Matter } from '@/platform/types/matter';
import {
  useMatterStore,
  resolveMatterIdForPath,
  getActiveScope,
} from '@/platform/matter/matterStore';

const ROOT = '/home/lawyer/Keepance';

function resetStore() {
  useMatterStore.setState({ matters: [], activeMatterId: null });
}

// ---------------------------------------------------------------------------
// Pure resolver
// ---------------------------------------------------------------------------

describe('resolveMatterId (pure)', () => {
  const matters: Matter[] = [
    {
      id: 'm-acme',
      name: 'Acme v. Beta',
      client: 'Acme Corp',
      folderPaths: [`${ROOT}/Acme Corp`],
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'm-smith',
      name: 'Smith Estate',
      client: 'Smith',
      folderPaths: [`${ROOT}/Smith Estate`, `${ROOT}/Shared/Smith`],
      createdAt: '2026-01-01T00:00:00Z',
    },
  ];

  it('maps a file under a matter folder to that matter', () => {
    expect(resolveMatterId(`${ROOT}/Acme Corp/discovery/req.md`, matters)).toBe('m-acme');
  });

  it('maps the matter folder itself to the matter', () => {
    expect(resolveMatterId(`${ROOT}/Acme Corp`, matters)).toBe('m-acme');
  });

  it('supports a matter mapped to multiple folders', () => {
    expect(resolveMatterId(`${ROOT}/Shared/Smith/notes.md`, matters)).toBe('m-smith');
    expect(resolveMatterId(`${ROOT}/Smith Estate/will.md`, matters)).toBe('m-smith');
  });

  it('falls back to unassigned for a path outside every matter folder', () => {
    expect(resolveMatterId(`${ROOT}/Scratch/todo.md`, matters)).toBe(UNASSIGNED_MATTER_ID);
  });

  it('does not match a folder whose name is a prefix of another (boundary safety)', () => {
    // "Acme Corp Extra" must NOT resolve to the "Acme Corp" matter.
    expect(resolveMatterId(`${ROOT}/Acme Corp Extra/file.md`, matters)).toBe(
      UNASSIGNED_MATTER_ID,
    );
  });

  it('resolves mail: ids to unassigned (email->matter is a later task)', () => {
    expect(resolveMatterId('mail:<abc@contoso.com>', matters)).toBe(UNASSIGNED_MATTER_ID);
  });

  it('returns unassigned for an empty path', () => {
    expect(resolveMatterId('', matters)).toBe(UNASSIGNED_MATTER_ID);
  });

  it('picks the longest (most specific) matching folder when matters nest', () => {
    const nested: Matter[] = [
      {
        id: 'parent',
        name: 'Parent',
        client: 'C',
        folderPaths: [`${ROOT}/Client`],
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'child',
        name: 'Child',
        client: 'C',
        folderPaths: [`${ROOT}/Client/SubMatter`],
        createdAt: '2026-01-01T00:00:00Z',
      },
    ];
    // A file under the more specific child folder resolves to the child.
    expect(resolveMatterId(`${ROOT}/Client/SubMatter/x.md`, nested)).toBe('child');
    // A file only under the parent folder resolves to the parent.
    expect(resolveMatterId(`${ROOT}/Client/other.md`, nested)).toBe('parent');
  });

  it('ignores any matter that somehow carries the unassigned id', () => {
    const weird: Matter[] = [
      {
        id: UNASSIGNED_MATTER_ID,
        name: 'bad',
        client: '',
        folderPaths: [`${ROOT}/Anything`],
        createdAt: '2026-01-01T00:00:00Z',
      },
    ];
    expect(resolveMatterId(`${ROOT}/Anything/x.md`, weird)).toBe(UNASSIGNED_MATTER_ID);
  });
});

describe('isPathInFolder', () => {
  it('true for the folder itself and descendants', () => {
    expect(isPathInFolder('/ws/A', '/ws/A')).toBe(true);
    expect(isPathInFolder('/ws/A/b/c.md', '/ws/A')).toBe(true);
  });
  it('false across a folder boundary', () => {
    expect(isPathInFolder('/ws/AB/c.md', '/ws/A')).toBe(false);
  });
  it('normalises backslashes and trailing slashes', () => {
    expect(isPathInFolder('C:\\ws\\A\\b.md', 'C:/ws/A/')).toBe(true);
  });
});

describe('matterLabel', () => {
  it('combines client and name', () => {
    expect(
      matterLabel({ id: 'x', name: 'M', client: 'C', folderPaths: [], createdAt: '' }),
    ).toBe('C - M');
  });
  it('falls back to whichever field is set', () => {
    expect(
      matterLabel({ id: 'x', name: 'M', client: '', folderPaths: [], createdAt: '' }),
    ).toBe('M');
  });
});

// ---------------------------------------------------------------------------
// Store CRUD
// ---------------------------------------------------------------------------

describe('useMatterStore CRUD', () => {
  beforeEach(resetStore);

  it('creates a matter with normalised folder paths', () => {
    const m = useMatterStore.getState().createMatter({
      name: 'Acme',
      client: 'Acme Corp',
      folderPaths: [`${ROOT}/Acme/`, ''],
    });
    expect(m.id).toMatch(/^matter_/);
    expect(useMatterStore.getState().matters).toHaveLength(1);
    expect(m.folderPaths).toEqual([`${ROOT}/Acme`]); // trailing slash stripped, empty dropped
  });

  it('renames name and client independently', () => {
    const m = useMatterStore.getState().createMatter({ name: 'A', client: 'C' });
    useMatterStore.getState().renameMatter(m.id, { name: 'A2' });
    expect(useMatterStore.getState().matters[0]!.name).toBe('A2');
    expect(useMatterStore.getState().matters[0]!.client).toBe('C');
  });

  it('adds and removes folder mappings without duplicates', () => {
    const m = useMatterStore.getState().createMatter({ name: 'A', client: 'C' });
    useMatterStore.getState().addFolderPath(m.id, `${ROOT}/A`);
    useMatterStore.getState().addFolderPath(m.id, `${ROOT}/A`); // dup
    expect(useMatterStore.getState().matters[0]!.folderPaths).toEqual([`${ROOT}/A`]);
    useMatterStore.getState().removeFolderPath(m.id, `${ROOT}/A`);
    expect(useMatterStore.getState().matters[0]!.folderPaths).toEqual([]);
  });

  it('deleteMatter clears active matter when it was active', () => {
    const m = useMatterStore.getState().createMatter({ name: 'A', client: 'C' });
    useMatterStore.getState().setActiveMatter(m.id);
    expect(useMatterStore.getState().activeMatterId).toBe(m.id);
    useMatterStore.getState().deleteMatter(m.id);
    expect(useMatterStore.getState().matters).toHaveLength(0);
    expect(useMatterStore.getState().activeMatterId).toBeNull();
  });

  it('findMatter ignores unassigned and unknown ids', () => {
    const m = useMatterStore.getState().createMatter({ name: 'A', client: 'C' });
    const matters = useMatterStore.getState().matters;
    expect(findMatter(m.id, matters)?.id).toBe(m.id);
    expect(findMatter(UNASSIGNED_MATTER_ID, matters)).toBeUndefined();
    expect(findMatter('nope', matters)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Active scope + non-reactive resolver
// ---------------------------------------------------------------------------

describe('active matter -> retrieval scope', () => {
  beforeEach(resetStore);

  it('defaults to the explicit allMatters scope', () => {
    expect(getActiveScope()).toEqual({ kind: 'allMatters' });
  });

  it('returns a matter scope once a matter is active', () => {
    const m = useMatterStore.getState().createMatter({ name: 'A', client: 'C' });
    useMatterStore.getState().setActiveMatter(m.id);
    expect(getActiveScope()).toEqual({ kind: 'matter', matterId: m.id });
  });

  it('resolveMatterIdForPath uses the live store contents', () => {
    const m = useMatterStore.getState().createMatter({
      name: 'A',
      client: 'C',
      folderPaths: [`${ROOT}/A`],
    });
    expect(resolveMatterIdForPath(`${ROOT}/A/file.md`)).toBe(m.id);
    expect(resolveMatterIdForPath(`${ROOT}/Other/file.md`)).toBe(UNASSIGNED_MATTER_ID);
  });
});
