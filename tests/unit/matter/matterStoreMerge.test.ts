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

import { describe, it, expect, beforeEach } from 'vitest';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useMatterUiStore } from '@/platform/matter/matterUiStore';
import { useMatterAtAGlanceStore } from '@/platform/matter/matterAtAGlanceStore';
import { useMatterSyncStore } from '@/platform/matter/matterSyncStore';

const MATTERS_KEY = 'keepance:matters';
const UI_KEY = 'keepance:matter-ui-snapshots';
const GLANCE_KEY = 'keepance:matter-at-a-glance';

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
    expect(matters!.version).toBe(7);

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
