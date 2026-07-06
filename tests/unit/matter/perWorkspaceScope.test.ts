/**
 * QA-93 — matter state is PER WORKSPACE.
 *
 * The matter store used to persist under APP-GLOBAL localStorage keys, so opening
 * a different workspace still showed the previous workspace's clients. These
 * tests pin the fix: persistence is scoped per workspace (key suffix derived from
 * the workspace root), the in-memory slice is swapped on switch, and a one-time
 * NON-DESTRUCTIVE migration carries legacy global matters into the workspace that
 * owns their (absolute) folders — never guessing relative paths.
 *
 * These are the STAGE-A (keying + migration) cases. The reload wiring at the
 * workspace-switch choke-point is covered in the lifecycle test; the reader
 * funnel + whole-practice Ask cases live in their own files.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  useMatterStore,
  getMatters,
  setMatterAuditEmitter,
  flushPendingMatterMigrationAudit,
  clearPendingMatterMigrationAudit,
} from '@/platform/matter/matterStore';
import { resolveMatterIdForWorkspacePath } from '@/platform/hooks/useMemoryWiring';
import { UNASSIGNED_MATTER_ID } from '@/platform/types/matter';
import {
  setActiveWorkspaceScopeRoot,
  workspaceScopeId,
} from '@/platform/state/workspaceScope';
import { SK_MATTERS } from '@/config/identity';

const GLOBAL_MATTERS_KEY = SK_MATTERS;

function scopedMattersKey(root: string): string {
  return `${SK_MATTERS}::ws:${workspaceScopeId(root)}`;
}

function seed(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}
function readEnvelope(key: string): { state?: Record<string, unknown>; version?: number } | null {
  const raw = localStorage.getItem(key);
  return raw ? (JSON.parse(raw) as { state?: Record<string, unknown>; version?: number }) : null;
}
function matterIdsInKey(key: string): string[] {
  const env = readEnvelope(key);
  const matters = (env?.state?.['matters'] as Array<{ id: string }> | undefined) ?? [];
  return matters.map((m) => m.id).sort();
}

const baseMatter = {
  name: 'Client',
  client: 'Client',
  mailFolderPaths: [],
  crmHouseholdKeys: [],
  onedriveFolderKeys: [],
  boxFolderKeys: [],
  esignKeys: [],
  jotformKeys: [],
  sharefileFolderKeys: [],
  meetingKeys: [],
  zocksKeys: [],
  addeparKeys: [],
  privileged: false,
  mcpAccessGranted: false,
  shared: false,
  createdAt: '2026-01-01T00:00:00Z',
};

/** Reload the matter store as if the given workspace just opened. */
async function reloadForWorkspace(root: string | null): Promise<void> {
  setActiveWorkspaceScopeRoot(root);
  await useMatterStore.persist.rehydrate();
}

beforeEach(() => {
  localStorage.clear();
  useMatterStore.setState({
    matters: [],
    activeMatterId: null,
    snapshots: {},
    cache: {},
    statusByMatterId: {},
    clientMapHubId: null,
    clientMapHubTab: null,
    pendingMeetingOpen: null,
  });
  setActiveWorkspaceScopeRoot(null);
  clearPendingMatterMigrationAudit();
  setMatterAuditEmitter(null);
});

afterEach(() => {
  setActiveWorkspaceScopeRoot(null);
  clearPendingMatterMigrationAudit();
  setMatterAuditEmitter(null);
});

describe('QA-93 stage A — fresh install, no legacy data', () => {
  it('createMatter after opening a workspace persists under that workspace scoped key, not the global key', async () => {
    await reloadForWorkspace('/wsA');
    const m = useMatterStore.getState().createMatter({ name: 'Acme', client: 'Acme', folderPaths: ['/wsA/Acme'] });
    expect(getMatters().map((x) => x.id)).toEqual([m.id]);
    // Scoped key holds it; no matter ever bleeds into the legacy global key
    // from a scoped session.
    expect(matterIdsInKey(scopedMattersKey('/wsA'))).toEqual([m.id]);
    expect(matterIdsInKey(GLOBAL_MATTERS_KEY)).toEqual([]);
  });

  it('opening a second fresh workspace shows an EMPTY client list (no bleed from the first)', async () => {
    await reloadForWorkspace('/wsA');
    useMatterStore.getState().createMatter({ name: 'Acme', client: 'Acme', folderPaths: ['/wsA/Acme'] });
    expect(getMatters()).toHaveLength(1);

    await reloadForWorkspace('/wsB');
    expect(getMatters()).toEqual([]);
    expect(useMatterStore.getState().activeMatterId).toBeNull();
  });
});

describe('QA-93 stage A — one-time migration from legacy global data', () => {
  it('carries ONLY matters whose absolute folderPaths live under the opened root; leaves global intact', async () => {
    seed(GLOBAL_MATTERS_KEY, {
      state: {
        matters: [
          { ...baseMatter, id: 'a1', folderPaths: ['/wsA/Clients/Acme'] },
          { ...baseMatter, id: 'a2', folderPaths: ['/wsA/Clients/Beta'] },
          { ...baseMatter, id: 'b1', folderPaths: ['/wsB/Clients/Gamma'] },
        ],
        activeMatterId: 'a2',
      },
      version: 10,
    });

    await reloadForWorkspace('/wsA');
    expect(getMatters().map((m) => m.id).sort()).toEqual(['a1', 'a2']);
    // active id carried because a2 migrated.
    expect(useMatterStore.getState().activeMatterId).toBe('a2');
    // Global key is NON-destructively retained so /wsB can still claim b1 later.
    expect(matterIdsInKey(GLOBAL_MATTERS_KEY)).toEqual(['a1', 'a2', 'b1']);
    // The scoped key now holds only /wsA's matters.
    expect(matterIdsInKey(scopedMattersKey('/wsA'))).toEqual(['a1', 'a2']);
  });

  it('active id is dropped to null when the active matter does NOT migrate into this workspace', async () => {
    seed(GLOBAL_MATTERS_KEY, {
      state: {
        matters: [
          { ...baseMatter, id: 'a1', folderPaths: ['/wsA/Clients/Acme'] },
          { ...baseMatter, id: 'b1', folderPaths: ['/wsB/Clients/Gamma'] },
        ],
        activeMatterId: 'b1',
      },
      version: 10,
    });
    await reloadForWorkspace('/wsA');
    expect(getMatters().map((m) => m.id)).toEqual(['a1']);
    expect(useMatterStore.getState().activeMatterId).toBeNull();
  });

  it('a second workspace opening later claims ITS matters from the still-intact global data', async () => {
    seed(GLOBAL_MATTERS_KEY, {
      state: {
        matters: [
          { ...baseMatter, id: 'a1', folderPaths: ['/wsA/Clients/Acme'] },
          { ...baseMatter, id: 'b1', folderPaths: ['/wsB/Clients/Gamma'] },
        ],
        activeMatterId: null,
      },
      version: 10,
    });
    await reloadForWorkspace('/wsA');
    expect(getMatters().map((m) => m.id)).toEqual(['a1']);
    await reloadForWorkspace('/wsB');
    expect(getMatters().map((m) => m.id)).toEqual(['b1']);
  });

  it('carries snapshots + cache only for migrated matter ids', async () => {
    seed(GLOBAL_MATTERS_KEY, {
      state: {
        matters: [
          { ...baseMatter, id: 'a1', folderPaths: ['/wsA/Acme'] },
          { ...baseMatter, id: 'b1', folderPaths: ['/wsB/Gamma'] },
        ],
        activeMatterId: null,
      },
      version: 10,
    });
    seed('lantern:matter-ui-snapshots', {
      state: { snapshots: { a1: { surface: 'files', activeTabPath: null }, b1: { surface: 'email', activeTabPath: null } } },
      version: 0,
    });
    seed('lantern:matter-at-a-glance', {
      state: { cache: { a1: { result: { summary: 'A' }, cachedAt: 't' }, b1: { result: { summary: 'B' }, cachedAt: 't' } } },
      version: 0,
    });

    await reloadForWorkspace('/wsA');
    expect(Object.keys(useMatterStore.getState().snapshots)).toEqual(['a1']);
    expect(Object.keys(useMatterStore.getState().cache)).toEqual(['a1']);
  });
});

describe('QA-93 stage A — relative folderPaths are NEVER guessed into a workspace', () => {
  it('a matter with only relative folderPaths is not carried into any workspace and stays in global', async () => {
    seed(GLOBAL_MATTERS_KEY, {
      state: {
        matters: [
          { ...baseMatter, id: 'rel', folderPaths: ['Clients/Relative'] },
          { ...baseMatter, id: 'a1', folderPaths: ['/wsA/Clients/Acme'] },
        ],
        activeMatterId: 'rel',
      },
      version: 10,
    });
    await reloadForWorkspace('/wsA');
    // Only the absolute-under-root matter migrates; the relative one is left alone.
    expect(getMatters().map((m) => m.id)).toEqual(['a1']);
    // active id 'rel' did not migrate → null.
    expect(useMatterStore.getState().activeMatterId).toBeNull();
    // The relative matter is still present in the retained global data.
    expect(matterIdsInKey(GLOBAL_MATTERS_KEY).includes('rel')).toBe(true);
  });

  it('a matter with BOTH a relative and an absolute-under-root folderPath migrates via the absolute one, but the RELATIVE mapping is dropped (round 3, Codex F1)', async () => {
    seed(GLOBAL_MATTERS_KEY, {
      state: {
        matters: [{ ...baseMatter, id: 'mix', folderPaths: ['Clients/Legacy', '/wsA/Clients/Acme'] }],
        activeMatterId: 'mix',
      },
      version: 10,
    });
    await reloadForWorkspace('/wsA');
    expect(getMatters().map((m) => m.id)).toEqual(['mix']);
    expect(useMatterStore.getState().activeMatterId).toBe('mix');
    // The carried copy keeps ONLY mappings proven under this root. A relative
    // mapping was never proven to belong to /wsA — carrying it would let the
    // resolver attribute /wsA files to a client from a different workspace.
    expect(getMatters().find((m) => m.id === 'mix')?.folderPaths).toEqual(['/wsA/Clients/Acme']);
    // The global source still holds the original mixed shape (non-destructive).
    const globalMix = (readEnvelope(GLOBAL_MATTERS_KEY)?.state?.['matters'] as Array<{ id: string; folderPaths: string[] }>).find((m) => m.id === 'mix');
    expect(globalMix?.folderPaths).toEqual(['Clients/Legacy', '/wsA/Clients/Acme']);
  });

  it('REVIEWER FAILURE SHAPE (round 3, Codex F1): a carried relative mapping must not attribute this workspace\'s files to that client', async () => {
    // Legacy data: client "mix" proved a folder under /wsA, but ALSO carries a
    // relative "Clients/Legacy" mapping that was never proven to belong to /wsA
    // (it may have described a folder in a completely different workspace).
    seed(GLOBAL_MATTERS_KEY, {
      state: {
        matters: [{ ...baseMatter, id: 'mix', folderPaths: ['Clients/Legacy', '/wsA/Clients/Acme'] }],
        activeMatterId: null,
      },
      version: 10,
    });
    await reloadForWorkspace('/wsA');
    // Post-migration, resolving a file under /wsA/Clients/Legacy must be
    // UNASSIGNED — not silently attributed to "mix". Misattributing a file to
    // the wrong client is the worst failure class for this product; a visibly
    // unmapped folder is the safe outcome.
    expect(resolveMatterIdForWorkspacePath('/wsA/Clients/Legacy/estate-plan.docx', '/wsA')).toBe(UNASSIGNED_MATTER_ID);
    // The proven mapping still resolves normally.
    expect(resolveMatterIdForWorkspacePath('/wsA/Clients/Acme/notes.docx', '/wsA')).toBe('mix');
  });
});

describe('QA-93 round 3 — dropped relative mappings leave a plain-language audit trail (Codex F1)', () => {
  it('one Activity Log entry per affected matter, listing the dropped mappings, delivered when the workspace\'s audit log is flushed', async () => {
    seed(GLOBAL_MATTERS_KEY, {
      state: {
        matters: [
          // Two relative mappings dropped for this client → ONE entry listing both.
          { ...baseMatter, id: 'mix', name: 'Hendricks', client: 'Hendricks', folderPaths: ['Clients/Legacy', 'Clients/Old Files', '/wsA/Clients/Hendricks'] },
          // No relative mappings → NO entry for this client.
          { ...baseMatter, id: 'clean', name: 'Acme', client: 'Acme', folderPaths: ['/wsA/Clients/Acme'] },
        ],
        activeMatterId: null,
      },
      version: 10,
    });

    const emitted: Array<{ description: string; metadata: Record<string, unknown> }> = [];
    setMatterAuditEmitter((entry) => { emitted.push({ description: entry.description, metadata: entry.metadata }); });

    await reloadForWorkspace('/wsA');
    // Migration queues the entry but must NOT emit yet — the durable audit
    // store is still pointed at the previous workspace at this moment.
    expect(emitted).toHaveLength(0);

    // The lifecycle flushes after pointing the audit store at /wsA.
    flushPendingMatterMigrationAudit('/wsA');
    expect(emitted).toHaveLength(1);
    // Plain language: names the client, lists the exact mappings, says what to do.
    expect(emitted[0]!.description).toContain('Hendricks');
    expect(emitted[0]!.description).toContain('"Clients/Legacy"');
    expect(emitted[0]!.description).toContain('"Clients/Old Files"');
    expect(emitted[0]!.description).toContain('not carried over');
    expect(emitted[0]!.metadata['matterId']).toBe('mix');
    expect(emitted[0]!.metadata['droppedFolderPaths']).toEqual(['Clients/Legacy', 'Clients/Old Files']);

    // A second flush delivers nothing (entries are drained, not re-sent).
    flushPendingMatterMigrationAudit('/wsA');
    expect(emitted).toHaveLength(1);
  });

  it('entries queued for one workspace never flush into a DIFFERENT workspace\'s audit log', async () => {
    seed(GLOBAL_MATTERS_KEY, {
      state: {
        matters: [{ ...baseMatter, id: 'mix', folderPaths: ['Clients/Legacy', '/wsA/Clients/Acme'] }],
        activeMatterId: null,
      },
      version: 10,
    });
    const emitted: unknown[] = [];
    setMatterAuditEmitter((entry) => { emitted.push(entry); });

    await reloadForWorkspace('/wsA');
    // Flushing for a different root delivers nothing and keeps the entry queued.
    flushPendingMatterMigrationAudit('/wsB');
    expect(emitted).toHaveLength(0);
    // Flushing for the producing root delivers it.
    flushPendingMatterMigrationAudit('/wsA');
    expect(emitted).toHaveLength(1);
  });
});

describe('QA-93 stage A — a matter spanning two workspaces keeps only THIS workspace\'s folders (Codex F3)', () => {
  it('drops another workspace\'s absolute folderPath from the carried copy', async () => {
    seed(GLOBAL_MATTERS_KEY, {
      state: {
        matters: [{ ...baseMatter, id: 'span', folderPaths: ['/wsA/Clients/Acme', '/wsB/Clients/Acme'] }],
        activeMatterId: null,
      },
      version: 10,
    });
    await reloadForWorkspace('/wsA');
    const m = getMatters().find((x) => x.id === 'span');
    // Carried into A, but only A's folder claim rides along — B's is dropped so it
    // can't leak into A's scope.
    expect(m?.folderPaths).toEqual(['/wsA/Clients/Acme']);
    // And B's own scope carries only B's folder.
    await reloadForWorkspace('/wsB');
    expect(getMatters().find((x) => x.id === 'span')?.folderPaths).toEqual(['/wsB/Clients/Acme']);
  });
});

describe('QA-93 stage A — nested workspace roots: the parent includes the child\'s matter (Codex F4, documented)', () => {
  it('a matter under a nested child root is claimed by BOTH the child and the parent workspace', async () => {
    // Pathological but possible: the user opens both `/Practice` and
    // `/Practice/Clients` as separate workspaces. A matter under the child path
    // is legitimately inside BOTH roots, so each scope claims it. Non-destructive
    // global retention makes this lossless; there is no safe signal to pick one
    // owner, so "parent includes its nested child" is the documented behavior.
    seed(GLOBAL_MATTERS_KEY, {
      state: {
        matters: [{ ...baseMatter, id: 'nested', folderPaths: ['/Practice/Clients/Acme'] }],
        activeMatterId: null,
      },
      version: 10,
    });
    await reloadForWorkspace('/Practice/Clients');
    expect(getMatters().map((m) => m.id)).toEqual(['nested']);
    await reloadForWorkspace('/Practice');
    expect(getMatters().map((m) => m.id)).toEqual(['nested']);
  });
});

describe('QA-93 stage A — two-workspace round trip preserves each workspace independently', () => {
  it('creating a matter in A, then B, then reopening A shows only A (+its migrated) matters', async () => {
    await reloadForWorkspace('/wsA');
    const a = useMatterStore.getState().createMatter({ name: 'A', client: 'A', folderPaths: ['/wsA/A'] });
    await reloadForWorkspace('/wsB');
    const b = useMatterStore.getState().createMatter({ name: 'B', client: 'B', folderPaths: ['/wsB/B'] });
    expect(getMatters().map((m) => m.id)).toEqual([b.id]);

    await reloadForWorkspace('/wsA');
    expect(getMatters().map((m) => m.id)).toEqual([a.id]);
    await reloadForWorkspace('/wsB');
    expect(getMatters().map((m) => m.id)).toEqual([b.id]);
  });
});
