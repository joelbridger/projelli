/**
 * Matter-store merge — persistence/hydration contract (plan risk R4: DATA LOSS).
 *
 * The four legacy matter stores (matterStore / matterUiStore / matterSyncStore /
 * matterAtAGlanceStore) were merged into one store with four slices. Zustand
 * `persist` writes ONE localStorage key per store, but we MUST keep the three
 * distinct legacy keys byte-compatible so existing users' data hydrates and is
 * written back unchanged:
 *   - keepance:matters             { matters, activeMatterId }   (v7 + migrate)
 *   - keepance:matter-ui-snapshots { snapshots }                 (v0)
 *   - keepance:matter-at-a-glance  { cache }                     (v0)
 * The sync slice (statusByMatterId) is ephemeral and is NEVER persisted.
 *
 * These tests are the safety net the merge was built against: each legacy key
 * fixture must hydrate into the right slice, the v1 matters fixture must migrate,
 * and writing back must re-emit all three keys in their legacy envelope format.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useMatterUiStore } from '@/platform/matter/matterUiStore';
import { useMatterAtAGlanceStore } from '@/platform/matter/matterAtAGlanceStore';
import { useMatterSyncStore } from '@/platform/matter/matterSyncStore';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';

const MATTERS_KEY = 'lantern:matters';
const UI_KEY = 'lantern:matter-ui-snapshots';
const GLANCE_KEY = 'lantern:matter-at-a-glance';

function seed(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function readEnvelope(key: string): { state?: Record<string, unknown>; version?: number } | null {
  const raw = localStorage.getItem(key);
  return raw ? (JSON.parse(raw) as { state?: Record<string, unknown>; version?: number }) : null;
}

const sampleMatterV4 = {
  id: 'm1',
  name: 'Acme v. Beta',
  client: 'Acme Corp',
  folderPaths: ['/ws/Acme'],
  mailFolderPaths: [],
  privileged: false,
  shared: false,
  createdAt: '2026-01-01T00:00:00Z',
};

beforeEach(async () => {
  localStorage.clear();
  // Reset the in-memory store to defaults between cases so a prior hydrate
  // doesn't leak. (rehydrate below re-reads whatever we seed.)
  useMatterStore.setState({
    matters: [],
    activeMatterId: null,
    snapshots: {},
    cache: {},
    statusByMatterId: {},
  });
  useWorkspaceStore.setState({ rootPath: null });
});

describe('matter-store merge — reconciliation covers an already-loaded workspace at first import (Codex review #4)', () => {
  it('reconciles legacy relative folderPaths against a workspace that was ALREADY loaded before matterStore evaluated', async () => {
    // A `subscribe` callback only fires on a CHANGE. If `workspaceStore`
    // already had its rootPath/fileTree loaded by the time matterStore's
    // module evaluates and registers the subscription — a real possible
    // startup ordering, not just this store's own persist migration finishing
    // first — waiting for the next change would leave an affected matter
    // relative indefinitely. Simulate that ordering with a fresh module graph.
    vi.resetModules();
    seed(MATTERS_KEY, {
      state: { matters: [{ ...sampleMatterV4, folderPaths: ['Clients/Hollings'] }], activeMatterId: 'm1' },
      version: 10,
    });

    const { useWorkspaceStore: freshWorkspaceStore } = await import('@/platform/fs/workspaceStore');
    freshWorkspaceStore.setState({
      rootPath: 'C:/workspaces/Northcrest',
      fileTree: [{ id: 'h', name: 'Hollings', path: 'Clients/Hollings', type: 'folder' }],
    });

    // matterStore's module body runs NOW, with workspaceStore already settled.
    const { useMatterStore: freshMatterStore } = await import('@/platform/matter/matterStore');

    expect(freshMatterStore.getState().matters[0]!.folderPaths).toEqual([
      'C:/workspaces/Northcrest/Clients/Hollings',
    ]);
  });
});

describe('matter-store merge — v9 -> v10 folderPaths canonicalization', () => {
  it('never resolves a relative folderPaths entry to absolute during migration itself, even if a workspace root already happens to be set (Codex review #3)', async () => {
    // The migration deliberately does NOT attempt root-resolution — see the
    // v9->v10 `migrate` doc comment. Binding a legacy relative entry to a
    // workspace root is done ONLY by the tree-validated reconciliation
    // subscription below, never by the migration directly (that would
    // reintroduce the "bind to whichever workspace happens to be open, with no
    // proof the folder exists there" risk through a second, unguarded path).
    useWorkspaceStore.setState({ rootPath: 'C:/workspaces/Northcrest', fileTree: [] });
    seed(MATTERS_KEY, {
      state: {
        matters: [{ ...sampleMatterV4, folderPaths: ['Clients/Hollings'] }],
        activeMatterId: 'm1',
      },
      version: 9,
    });
    await useMatterStore.persist.rehydrate();
    expect(useMatterStore.getState().matters[0]!.folderPaths).toEqual(['Clients/Hollings']);

    // Only the reconciliation subscription (fired by a REAL workspace-store
    // change, with a tree that verifies the folder) can bind it.
    useWorkspaceStore.setState({
      rootPath: 'C:/workspaces/Northcrest',
      fileTree: [{ id: 'h', name: 'Hollings', path: 'Clients/Hollings', type: 'folder' }],
    });
    expect(useMatterStore.getState().matters[0]!.folderPaths).toEqual([
      'C:/workspaces/Northcrest/Clients/Hollings',
    ]);
  });

  it('leaves a relative folderPaths entry relative (shape-clean, not dropped) when the workspace root is not yet known', async () => {
    // No workspace root set — matches real app bootstrap ordering, where this
    // store's persist migration runs before a workspace has been opened.
    seed(MATTERS_KEY, {
      state: {
        matters: [{ ...sampleMatterV4, folderPaths: ['Clients/Hollings'] }],
        activeMatterId: 'm1',
      },
      version: 9,
    });
    await useMatterStore.persist.rehydrate();
    expect(useMatterStore.getState().matters[0]!.folderPaths).toEqual(['Clients/Hollings']);
  });

  it('drops a non-string (object) folderPaths entry instead of persisting it as "[object Object]"', async () => {
    seed(MATTERS_KEY, {
      state: {
        matters: [
          {
            ...sampleMatterV4,
            folderPaths: ['/ws/RealFolder', { some: 'garbage-object' }],
          },
        ],
        activeMatterId: 'm1',
      },
      version: 9,
    });
    await useMatterStore.persist.rehydrate();
    const folderPaths = useMatterStore.getState().matters[0]!.folderPaths;
    expect(folderPaths).toEqual(['/ws/RealFolder']);
    expect(folderPaths.join()).not.toContain('[object Object]');
  });

  it('logs a non-DEV-gated [PathShape] summary line at the migration boundary (bench proof)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    seed(MATTERS_KEY, {
      state: {
        matters: [
          { ...sampleMatterV4, id: 'm1', folderPaths: ['/ws/Real', { garbage: true }] },
        ],
        activeMatterId: 'm1',
      },
      version: 9,
    });
    await useMatterStore.persist.rehydrate();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[PathShape\] canonicalized \d+ folderPaths, dropped \d+ invalid$/),
    );
    logSpy.mockRestore();
  });

  it('a matters fixture already at v10 hydrates unchanged (idempotent, no re-canonicalization)', async () => {
    seed(MATTERS_KEY, {
      state: { matters: [{ ...sampleMatterV4, folderPaths: ['Clients/Hollings'] }], activeMatterId: 'm1' },
      version: 10,
    });
    await useMatterStore.persist.rehydrate();
    // Already at v10 → the `version < 10` migration step never runs, so an
    // already-relative entry (e.g. left relative by an earlier hydrate with no
    // workspace root open) is NOT force-canonicalized just by rehydrating again.
    expect(useMatterStore.getState().matters[0]!.folderPaths).toEqual(['Clients/Hollings']);
  });

  it('reconciles a relative folderPaths entry once the workspace root AND its matching tree are known (Codex review #1)', async () => {
    // Simulate the migration having run before a workspace root was open: the
    // entry survives shape-clean but relative (matches the real bootstrap
    // ordering — workspaceStore hydrates its rootPath from a LATER user action,
    // after this store's persist migration has already completed).
    seed(MATTERS_KEY, {
      state: { matters: [{ ...sampleMatterV4, folderPaths: ['Clients/Hollings'] }], activeMatterId: 'm1' },
      version: 10,
    });
    await useMatterStore.persist.rehydrate();
    expect(useMatterStore.getState().matters[0]!.folderPaths).toEqual(['Clients/Hollings']);

    // The user now opens a workspace — rootPath transitions from null to a
    // real value, and the tree loads with a folder at that exact relative
    // path (verifying the entry genuinely belongs to THIS workspace, not a
    // same-named coincidence elsewhere — Codex review #2). Without this
    // reconciliation, the entry would stay relative forever unless the user
    // happened to edit this matter's folders again.
    useWorkspaceStore.setState({
      rootPath: 'C:/workspaces/Northcrest',
      fileTree: [
        {
          id: 'clients',
          name: 'Clients',
          path: 'Clients',
          type: 'folder',
          children: [{ id: 'hollings', name: 'Hollings', path: 'Clients/Hollings', type: 'folder' }],
        },
      ],
    });

    expect(useMatterStore.getState().matters[0]!.folderPaths).toEqual([
      'C:/workspaces/Northcrest/Clients/Hollings',
    ]);
  });

  it('leaves a relative folderPaths entry untouched when it does not exist in the opened workspace tree (Codex review #2 — avoid binding to the wrong workspace)', async () => {
    // The relative entry actually belongs to a DIFFERENT workspace the user
    // has in their recent-workspaces list. If they open THIS (unrelated)
    // workspace first, the entry must NOT be permanently bound to it — that
    // would corrupt the mapping when the user later opens the right workspace.
    seed(MATTERS_KEY, {
      state: { matters: [{ ...sampleMatterV4, folderPaths: ['Clients/Hollings'] }], activeMatterId: 'm1' },
      version: 10,
    });
    await useMatterStore.persist.rehydrate();

    useWorkspaceStore.setState({
      rootPath: 'C:/workspaces/UnrelatedWorkspace',
      fileTree: [
        { id: 'other', name: 'Other Client', path: 'Other Client', type: 'folder' },
      ],
    });

    // Still relative — not bound to the wrong workspace.
    expect(useMatterStore.getState().matters[0]!.folderPaths).toEqual(['Clients/Hollings']);

    // Now the RIGHT workspace opens, with the matching folder — it claims it.
    useWorkspaceStore.setState({
      rootPath: 'C:/workspaces/Northcrest',
      fileTree: [
        { id: 'clients-hollings', name: 'Hollings', path: 'Clients/Hollings', type: 'folder' },
      ],
    });
    expect(useMatterStore.getState().matters[0]!.folderPaths).toEqual([
      'C:/workspaces/Northcrest/Clients/Hollings',
    ]);
  });

  it('does not re-write matters when the workspace root changes but folderPaths are already canonical', async () => {
    seed(MATTERS_KEY, {
      state: {
        matters: [{ ...sampleMatterV4, folderPaths: ['C:/workspaces/Northcrest/Clients/Hollings'] }],
        activeMatterId: 'm1',
      },
      version: 10,
    });
    await useMatterStore.persist.rehydrate();
    const beforeMatters = useMatterStore.getState().matters;

    useWorkspaceStore.setState({ rootPath: 'C:/workspaces/Northcrest', fileTree: [] });

    // Same array reference (or at least identical content) — no spurious churn.
    expect(useMatterStore.getState().matters).toEqual(beforeMatters);
  });
});

describe('matter-store merge — hydration from each legacy key', () => {
  it('hydrates matters + activeMatterId from keepance:matters (v7, no migration)', async () => {
    const sampleMatterV7 = {
      ...sampleMatterV4,
      mcpAccessGranted: false,
      crmHouseholdKeys: [],
      onedriveFolderKeys: [],
      esignKeys: [],
      meetingKeys: [],
    };
    seed(MATTERS_KEY, { state: { matters: [sampleMatterV7], activeMatterId: 'm1' }, version: 7 });
    await useMatterStore.persist.rehydrate();
    const s = useMatterStore.getState();
    expect(s.matters).toHaveLength(1);
    expect(s.matters[0]!.id).toBe('m1');
    expect(s.matters[0]!.mcpAccessGranted).toBe(false);
    expect(s.activeMatterId).toBe('m1');
  });

  it('migrates a v4 matters fixture (backfills external AI tool access off)', async () => {
    seed(MATTERS_KEY, { state: { matters: [sampleMatterV4], activeMatterId: 'm1' }, version: 4 });
    await useMatterStore.persist.rehydrate();
    const s = useMatterStore.getState();
    expect(s.matters).toHaveLength(1);
    expect(s.matters[0]!.id).toBe('m1');
    expect(s.matters[0]!.mcpAccessGranted).toBe(false);
    expect(s.activeMatterId).toBe('m1');
  });

  it('migrates a v1 matters fixture (backfills mailFolderPaths/privileged/shared)', async () => {
    // v1 matters predate mailFolderPaths (v2), privileged (v3), firm linkage (v4).
    seed(MATTERS_KEY, {
      state: {
        matters: [{ id: 'm1', name: 'Old', client: 'C', folderPaths: ['/ws/Old'], createdAt: '2026-01-01T00:00:00Z' }],
        activeMatterId: null,
      },
      version: 1,
    });
    await useMatterStore.persist.rehydrate();
    const m = useMatterStore.getState().matters[0]!;
    expect(m.mailFolderPaths).toEqual([]);
    expect(m.privileged).toBe(false);
    expect(m.shared).toBe(false);
    expect(m.onedriveFolderKeys).toEqual([]);
    expect(m.esignKeys).toEqual([]);
    expect(m.meetingKeys).toEqual([]);
  });

  it('hydrates snapshots from keepance:matter-ui-snapshots', async () => {
    seed(UI_KEY, { state: { snapshots: { m1: { surface: 'files', activeTabPath: '/ws/Acme/x.docx' } } }, version: 0 });
    await useMatterStore.persist.rehydrate();
    expect(useMatterStore.getState().snapshots.m1).toEqual({ surface: 'files', activeTabPath: '/ws/Acme/x.docx' });
    // ...and the sibling alias hook reads the same slice.
    expect(useMatterUiStore.getState().getSnapshot('m1')).toEqual({ surface: 'files', activeTabPath: '/ws/Acme/x.docx' });
  });

  it('hydrates cache from keepance:matter-at-a-glance', async () => {
    const entry = { result: { summary: 'x', generatedAt: '2026-01-01T00:00:00Z' }, cachedAt: '2026-01-01T00:00:00Z' };
    seed(GLANCE_KEY, { state: { cache: { m1: entry } }, version: 0 });
    await useMatterStore.persist.rehydrate();
    expect(useMatterStore.getState().cache.m1).toEqual(entry);
    expect(useMatterAtAGlanceStore.getState().getEntry('m1')).toEqual(entry);
  });

  it('hydrates all three keys together into their respective slices', async () => {
    seed(MATTERS_KEY, { state: { matters: [sampleMatterV4], activeMatterId: 'm1' }, version: 4 });
    seed(UI_KEY, { state: { snapshots: { m1: { surface: 'email', activeTabPath: null } } }, version: 0 });
    seed(GLANCE_KEY, { state: { cache: { m1: { result: { summary: 'g' }, cachedAt: 't' } } }, version: 0 });
    await useMatterStore.persist.rehydrate();
    const s = useMatterStore.getState();
    expect(s.matters).toHaveLength(1);
    expect(s.snapshots.m1!.surface).toBe('email');
    expect(s.cache.m1!.result).toEqual({ summary: 'g' });
  });

  it('a fresh user (no keys) hydrates to empty defaults', async () => {
    await useMatterStore.persist.rehydrate();
    const s = useMatterStore.getState();
    expect(s.matters).toEqual([]);
    expect(s.activeMatterId).toBeNull();
    expect(s.snapshots).toEqual({});
    expect(s.cache).toEqual({});
  });
});

describe('matter-store merge — writes preserve all three legacy keys', () => {
  it('createMatter + saveSnapshot + setEntry each write their own legacy key', () => {
    const m = useMatterStore.getState().createMatter({ name: 'A', client: 'C', folderPaths: ['/ws/A'] });
    useMatterStore.getState().saveSnapshot(m.id, { surface: 'workflows', activeTabPath: null });
    useMatterStore.getState().setEntry(m.id, { summary: 'cached' } as never);

    const matters = readEnvelope(MATTERS_KEY);
    const ui = readEnvelope(UI_KEY);
    const glance = readEnvelope(GLANCE_KEY);

    // Each key carries ONLY its own slice (no cross-contamination).
    expect((matters!.state!.matters as unknown[]).length).toBe(1);
    expect(matters!.state).not.toHaveProperty('snapshots');
    expect(matters!.state).not.toHaveProperty('cache');
    expect(matters!.version).toBe(10);

    expect((ui!.state!.snapshots as Record<string, unknown>)[m.id]).toEqual({ surface: 'workflows', activeTabPath: null });
    expect(ui!.state).not.toHaveProperty('matters');

    expect((glance!.state!.cache as Record<string, unknown>)[m.id]).toBeDefined();
    expect(glance!.state).not.toHaveProperty('matters');
  });

  it('the ephemeral sync slice is NEVER written to any persisted key', () => {
    useMatterStore.getState().setStatus('m1', 'live');
    expect(useMatterStore.getState().statusByMatterId.m1).toBe('live');
    // statusByMatterId must not appear in any of the three persisted envelopes.
    for (const key of [MATTERS_KEY, UI_KEY, GLANCE_KEY]) {
      const env = readEnvelope(key);
      if (env?.state) expect(env.state).not.toHaveProperty('statusByMatterId');
    }
    // The sync alias hook resolves to the same merged store.
    expect(useMatterSyncStore.getState().statusByMatterId.m1).toBe('live');
  });
});
