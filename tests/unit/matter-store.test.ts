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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  resolveMatterId,
  findMatter,
  isPathInFolder,
  matterLabel,
  normalize as normalizeMatterPath,
} from '@/platform/rag/matterResolver';
import { UNASSIGNED_MATTER_ID, type Matter } from '@/platform/types/matter';
import {
  useMatterStore,
  resolveMatterIdForPath,
  getActiveScope,
  setMatterAuditEmitter,
} from '@/platform/matter/matterStore';
import {
  issueAllMattersScopeSelection,
  issueMatterScopeSelection,
  requestClearClientSelection,
  requestMatterScopeSelection,
  useClientContextStore,
} from '@/platform/client-context';
import { setDevFlagOverride } from '@/platform/flags/router';

const ROOT = '/home/lawyer/Lantern';

function resetStore() {
  useMatterStore.setState({ matters: [], activeMatterId: null });
  localStorage.removeItem('audit_log_default');
  setMatterAuditEmitter(null);
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

describe('normalize', () => {
  it('normalises backslashes and trailing slashes for shared matter comparisons', () => {
    expect(normalizeMatterPath('C:\\ws\\A\\\\')).toBe('C:/ws/A');
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
  beforeEach(() => {
    setDevFlagOverride('selection-authority-boot-gate', false);
    resetStore();
  });

  afterEach(() => {
    requestClearClientSelection();
    setDevFlagOverride('selection-authority-boot-gate', undefined);
  });

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

  it('defaults external AI tool access to off', () => {
    const m = useMatterStore.getState().createMatter({ name: 'Acme', client: 'Acme Corp' });
    expect(m.mcpAccessGranted).toBe(false);
    expect(useMatterStore.getState().matters[0]!.mcpAccessGranted).toBe(false);
  });

  it('audits external AI tool grants and revocations through the registered app emitter', () => {
    const auditEmitter = vi.fn();
    setMatterAuditEmitter(auditEmitter);
    const m = useMatterStore.getState().createMatter({ name: 'Acme', client: 'Acme Corp' });

    useMatterStore.getState().setMatterMcpAccess(m.id, true);
    useMatterStore.getState().setMatterMcpAccess(m.id, true);
    useMatterStore.getState().setMatterMcpAccess(m.id, false);
    useMatterStore.getState().setMatterMcpAccess(m.id, false);

    expect(useMatterStore.getState().matters[0]!.mcpAccessGranted).toBe(false);
    expect(auditEmitter).toHaveBeenCalledTimes(2);
    expect(auditEmitter.mock.calls.map(([entry]) => entry.action)).toEqual([
      'mcp_matter_access_granted',
      'mcp_matter_access_revoked',
    ]);
    expect(auditEmitter).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: 'mcp_matter_access_granted',
        metadata: expect.objectContaining({ matterId: m.id, matterName: 'Acme' }),
      }),
    );
    expect(auditEmitter).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: 'mcp_matter_access_revoked',
        metadata: expect.objectContaining({ matterId: m.id, matterName: 'Acme' }),
      }),
    );
    expect(localStorage.getItem('audit_log_default')).toBeNull();
  });

  it('renames name and client independently', () => {
    const m = useMatterStore.getState().createMatter({ name: 'A', client: 'C' });
    useMatterStore.getState().renameMatter(m.id, { name: 'A2' });
    expect(useMatterStore.getState().matters[0]!.name).toBe('A2');
    expect(useMatterStore.getState().matters[0]!.client).toBe('C');
  });

  it('adds and removes folder mappings without normalized duplicates', () => {
    const m = useMatterStore.getState().createMatter({ name: 'A', client: 'C' });
    useMatterStore.getState().addFolderPath(m.id, `${ROOT}\\A\\`);
    useMatterStore.getState().addFolderPath(m.id, `${ROOT}/A/`); // same folder, different spelling
    expect(useMatterStore.getState().matters[0]!.folderPaths).toEqual([`${ROOT}/A`]);
    useMatterStore.getState().removeFolderPath(m.id, `${ROOT}\\A\\`);
    expect(useMatterStore.getState().matters[0]!.folderPaths).toEqual([]);
  });

  it('setFolderPaths collapses normalized duplicate folder mappings', () => {
    const m = useMatterStore.getState().createMatter({ name: 'A', client: 'C' });
    useMatterStore.getState().setFolderPaths(m.id, [`${ROOT}/A/`, `${ROOT}\\A`, '']);
    expect(useMatterStore.getState().matters[0]!.folderPaths).toEqual([`${ROOT}/A`]);
  });

  it('deleteMatter clears active matter when it was active', () => {
    const m = useMatterStore.getState().createMatter({ name: 'A', client: 'C' });
    useMatterStore.getState().setActiveMatter(m.id);
    expect(useMatterStore.getState().activeMatterId).toBe(m.id);
    useMatterStore.getState().deleteMatter(m.id);
    expect(useMatterStore.getState().matters).toHaveLength(0);
    expect(useMatterStore.getState().activeMatterId).toBeNull();
  });

  it('deleteMatter also clears the matter\'s snapshot, at-a-glance cache, and sync status', () => {
    // Codex QA: a deleted matter must not leave orphaned per-matter state behind
    // (stale AI cache / saved UI snapshot / sync status under a recyclable id).
    const s = useMatterStore.getState();
    const m = s.createMatter({ name: 'A', client: 'C' });
    s.saveSnapshot(m.id, { activeView: 'documents' } as unknown as Parameters<typeof s.saveSnapshot>[1]);
    s.setEntry(m.id, { summary: 'x', items: [] } as unknown as Parameters<typeof s.setEntry>[1]);
    s.setStatus(m.id, 'catching-up');
    expect(useMatterStore.getState().snapshots[m.id]).toBeDefined();
    expect(useMatterStore.getState().cache[m.id]).toBeDefined();
    expect(useMatterStore.getState().statusByMatterId[m.id]).toBe('catching-up');

    useMatterStore.getState().deleteMatter(m.id);
    expect(useMatterStore.getState().snapshots[m.id]).toBeUndefined();
    expect(useMatterStore.getState().cache[m.id]).toBeUndefined();
    expect(useMatterStore.getState().statusByMatterId[m.id]).toBeUndefined();
  });

  it('setActiveMatter ignores a missing matter id (no silent scope to a ghost)', () => {
    useMatterStore.getState().setActiveMatter('does-not-exist');
    expect(useMatterStore.getState().activeMatterId).toBeNull();
  });

  it('setActiveMatter ignores an archived matter (confidentiality: scope must be visible)', () => {
    const s = useMatterStore.getState();
    const m = s.createMatter({ name: 'A', client: 'C' });
    s.setMatterArchived(m.id, true);
    s.setActiveMatter(m.id);
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
  beforeEach(async () => {
    resetStore();
    setDevFlagOverride('selection-authority-boot-gate', false);
    requestClearClientSelection();
    setDevFlagOverride('selection-authority-boot-gate', true);
    await requestMatterScopeSelection(issueAllMattersScopeSelection());
  });

  afterEach(() => {
    setDevFlagOverride('selection-authority-boot-gate', false);
    requestClearClientSelection();
    setDevFlagOverride('selection-authority-boot-gate', undefined);
  });

  it('defaults to the explicit allMatters scope', () => {
    expect(getActiveScope()).toEqual({ kind: 'allMatters' });
  });

  it('returns a matter scope once the source selects a matter', async () => {
    const m = useMatterStore.getState().createMatter({ name: 'A', client: 'C' });
    await requestMatterScopeSelection(issueMatterScopeSelection(m.id));
    await vi.waitFor(() => {
      expect(useMatterStore.getState().activeMatterId).toBe(m.id);
      expect(useClientContextStore.getState().followerStatus).toBe('converged');
    });
    expect(getActiveScope()).toEqual({ kind: 'matter', matterId: m.id });
  });

  it('refuses when the selected matter has been deleted instead of broadening authority', async () => {
    const m = useMatterStore.getState().createMatter({ name: 'A', client: 'C' });
    await requestMatterScopeSelection(issueMatterScopeSelection(m.id));
    await vi.waitFor(() => {
      expect(useClientContextStore.getState().followerStatus).toBe('converged');
    });
    useMatterStore.setState({ matters: [], activeMatterId: m.id });
    expect(() => getActiveScope()).toThrow('still catching up');
  });

  it('refuses when the selected matter is archived instead of broadening authority', async () => {
    const s = useMatterStore.getState();
    const m = s.createMatter({ name: 'A', client: 'C' });
    await requestMatterScopeSelection(issueMatterScopeSelection(m.id));
    await vi.waitFor(() => {
      expect(useClientContextStore.getState().followerStatus).toBe('converged');
    });
    s.setMatterArchived(m.id, true);
    // Restore only the follower to prove it cannot turn the stale selection into
    // workspace-wide authority or revive an archived matter.
    useMatterStore.setState({ activeMatterId: m.id });
    expect(() => getActiveScope()).toThrow('still catching up');
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
