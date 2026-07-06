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
import { useMatterStore, getMatters } from '@/platform/matter/matterStore';
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
});

afterEach(() => {
  setActiveWorkspaceScopeRoot(null);
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

  it('a matter with BOTH a relative and an absolute-under-root folderPath still migrates (via the absolute one)', async () => {
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
