/**
 * Matter/client organization is DURABLE IN THE WORKSPACE FOLDER — not only in
 * the browser profile (fix/matters-workspace-persistence).
 *
 * Bug reproduced on the real Windows bench (2026-07): client/matter records
 * lived ONLY in browser-profile-scoped localStorage (`lantern:matters…`), so a
 * WebView2 profile reset / cache clear / reinstall / new machine permanently
 * destroyed ALL client organization while the workspace's document files
 * survived intact but orphaned ("No clients yet" over ~40 real clients).
 *
 * The fix: the workspace's own on-disk file (`.lantern/matters.json`, written
 * through WorkspaceService like every other app write) is the SOURCE OF TRUTH;
 * localStorage remains only a fast cache. These tests pin:
 *   (a) fresh-profile durability — create matters, wipe the profile
 *       (localStorage cleared), reopen the workspace → matters intact from disk;
 *   (b) the one-time legacy migration — matters that exist only in
 *       localStorage (pre-fix installs) are committed to the workspace folder
 *       on open, then survive a wipe;
 *   (c) multi-workspace isolation — each workspace's records live in ITS OWN
 *       folder and never bleed;
 *   plus disk-wins-over-stale-cache, corrupt-file recovery, write-through on
 *   delete, and the reloadWorkspaceScopedStores wiring.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  useMatterStore,
  getMatters,
  hydrateMattersFromWorkspaceDisk,
  flushMattersWorkspaceDiskWrites,
  __resetMattersWorkspaceDiskSyncForTests,
} from '@/platform/matter/matterStore';
import {
  setActiveWorkspaceScopeRoot,
  workspaceScopeId,
} from '@/platform/state/workspaceScope';
import { setActiveWorkspaceService } from '@/platform/fs/activeWorkspaceService';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { workspacePath } from '@/platform/fs/appPath';
import { MATTERS_WORKSPACE_REL_PATH, SK_MATTERS } from '@/config/identity';
import { reloadWorkspaceScopedStores } from '@/platform/state/reloadWorkspaceScopedStores';
import {
  readAuthoritativeMatterScope,
  issueAllMattersScopeSelection,
  issueMatterScopeSelection,
  rehydrateSelectionHint,
  replaceCanonicalHouseholdDirectory,
  requestClearClientSelection,
  requestMatterScopeSelection,
  useClientContextStore,
} from '@/platform/client-context';
import { setDevFlagOverride } from '@/platform/flags/router';

// ── helpers ──────────────────────────────────────────────────────────────────

function mattersFilePath(root: string): string {
  return workspacePath(root, MATTERS_WORKSPACE_REL_PATH);
}

function scopedMattersKey(root: string): string {
  return `${SK_MATTERS}::ws:${workspaceScopeId(root)}`;
}

/** Minimal in-memory WorkspaceService — the same surface the MCP session-scope
 *  writer's tests mock (writeFile/move/delete) plus exists/readFile/getRootPath. */
function createMockWorkspaceService(
  root: string,
  beforeWrite?: (() => Promise<void>) | undefined,
) {
  const files = new Map<string, string>();
  const service = {
    getRootPath: () => root,
    exists: (p: string) => Promise.resolve(files.has(p)),
    readFile: (p: string) => {
      const c = files.get(p);
      if (c === undefined) return Promise.reject(new Error(`missing file: ${p}`));
      return Promise.resolve(c);
    },
    writeFile: async (p: string, content: string) => {
      await beforeWrite?.();
      files.set(p, content);
    },
    move: (from: string, to: string) => {
      const c = files.get(from);
      if (c === undefined) return Promise.reject(new Error(`missing temp file: ${from}`));
      files.set(to, c);
      files.delete(from);
      return Promise.resolve();
    },
    delete: (p: string) => {
      files.delete(p);
      return Promise.resolve();
    },
  };
  return { service: service as unknown as WorkspaceService, files };
}

/** A full v10-shaped persisted matter record (mirrors perWorkspaceScope.test.ts). */
function persistedMatter(id: string, root: string, name = 'Client') {
  return {
    id,
    name,
    client: name,
    folderPaths: [`${root}/Clients/${name}`],
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
}

function seedLocalStorage(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function seedDiskFile(
  files: Map<string, string>,
  root: string,
  matters: unknown[],
  activeMatterId: string | null = null,
): void {
  files.set(
    mattersFilePath(root),
    JSON.stringify({
      version: 10,
      savedAt: '2026-07-01T00:00:00Z',
      state: { matters, activeMatterId, snapshots: {}, cache: {} },
    }),
  );
}

function readDiskMatterIds(files: Map<string, string>, root: string): string[] {
  const raw = files.get(mattersFilePath(root));
  if (raw === undefined) return [];
  const parsed = JSON.parse(raw) as { state?: { matters?: Array<{ id: string }> } };
  return (parsed.state?.matters ?? []).map((m) => m.id).sort();
}

/** Open a workspace the way the app's lifecycle does: point the active service
 *  + scope at it, rehydrate the store from the (scoped) localStorage cache,
 *  then run the workspace-disk hydrate and let all disk work settle. */
async function openWorkspace(root: string, service: WorkspaceService): Promise<void> {
  setActiveWorkspaceService(service);
  setActiveWorkspaceScopeRoot(root);
  await useMatterStore.persist.rehydrate();
  await hydrateMattersFromWorkspaceDisk(root);
  await flushMattersWorkspaceDiskWrites();
}

/** Simulate a browser-profile reset / fresh process: ALL profile-scoped state
 *  (localStorage + this process's in-memory store + module-level disk-sync
 *  bookkeeping) is gone; only workspace files (the mock `files` maps) survive. */
function wipeProfile(): void {
  // Reset in-memory state FIRST (each setState echoes into localStorage via
  // persist), then clear localStorage LAST so nothing re-writes a cache key.
  resetStoreState();
  setActiveWorkspaceScopeRoot(null);
  setActiveWorkspaceService(null);
  __resetMattersWorkspaceDiskSyncForTests();
  localStorage.clear();
}

function resetStoreState(): void {
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
}

beforeEach(() => {
  wipeProfile();
});

afterEach(() => {
  setDevFlagOverride('selection-authority-boot-gate', false);
  requestClearClientSelection();
  setDevFlagOverride('selection-authority-boot-gate', undefined);
  setActiveWorkspaceScopeRoot(null);
  setActiveWorkspaceService(null);
});

describe('writer-owned workspace-disk rehydration', () => {
  it('reclassifies the disk hint and never installs the disk follower as authority', async () => {
    const { service, files } = createMockWorkspaceService('/wsA');
    const live = persistedMatter('m_live', '/wsA', 'Live');
    const forgedFollower = persistedMatter('m_forged', '/wsA', 'Forged');
    files.set(
      mattersFilePath('/wsA'),
      JSON.stringify({
        version: 10,
        savedAt: '2026-07-18T00:00:00Z',
        state: {
          matters: [live, forgedFollower],
          activeMatterId: forgedFollower.id,
          selectionHint: {
            version: 1,
            source: 'specific-matter',
            matterId: live.id,
          },
          snapshots: {},
          cache: {},
        },
      })
    );

    setDevFlagOverride('selection-authority-boot-gate', true);
    replaceCanonicalHouseholdDirectory('wealthbox', []);
    rehydrateSelectionHint({
      kind: 'persisted-hint',
      value: { version: 1, source: 'explicit-all-matters' },
    });
    await openWorkspace('/wsA', service);

    expect(readAuthoritativeMatterScope()).toEqual({
      kind: 'matter-only',
      matterId: live.id,
    });
    await vi.waitFor(() => {
      expect(useMatterStore.getState().activeMatterId).toBe(live.id);
      expect(useClientContextStore.getState().followerStatus).toBe('converged');
    });
  });

  it('captures a workspace selection hint before its disk write enters the queue', async () => {
    let holdNextWrite = false;
    let releaseHeldWrite = (): void => {};
    let heldWriteEntered: (() => void) | null = null;
    const heldWriteStarted = new Promise<void>((resolve) => {
      heldWriteEntered = resolve;
    });
    const heldWrite = new Promise<void>((resolve) => {
      releaseHeldWrite = () => {
        resolve();
      };
    });
    const { service, files } = createMockWorkspaceService('/wsA', async () => {
      if (!holdNextWrite) return;
      holdNextWrite = false;
      heldWriteEntered?.();
      await heldWrite;
    });

    setDevFlagOverride('selection-authority-boot-gate', true);
    replaceCanonicalHouseholdDirectory('wealthbox', []);
    rehydrateSelectionHint({
      kind: 'persisted-hint',
      value: { version: 1, source: 'explicit-all-matters' },
    });
    await openWorkspace('/wsA', service);
    const selected = useMatterStore.getState().createMatter({
      name: 'Selected',
      client: 'Selected',
      folderPaths: ['/wsA/Selected'],
    });
    await flushMattersWorkspaceDiskWrites();
    await requestMatterScopeSelection(issueMatterScopeSelection(selected.id));

    holdNextWrite = true;
    useMatterStore.getState().renameMatter(selected.id, { name: 'First queued edit' });
    await heldWriteStarted;
    useMatterStore.getState().renameMatter(selected.id, { name: 'Second queued edit' });
    await requestMatterScopeSelection(issueAllMattersScopeSelection());
    releaseHeldWrite();
    await flushMattersWorkspaceDiskWrites();

    const raw = files.get(mattersFilePath('/wsA'));
    expect(raw).toBeDefined();
    const disk = JSON.parse(raw ?? '{}') as {
      state?: { selectionHint?: unknown };
    };
    expect(disk.state?.selectionHint).toEqual({
      version: 1,
      source: 'specific-matter',
      matterId: selected.id,
    });
  });
});

// ── (a) fresh-profile durability — the reproduced Windows-bench data loss ────

describe('workspace-disk durability (fresh profile wipe)', () => {
  it('matters created in a workspace survive a full profile wipe (localStorage gone, workspace files intact)', async () => {
    setDevFlagOverride('selection-authority-boot-gate', false);
    requestClearClientSelection();
    setDevFlagOverride('selection-authority-boot-gate', true);
    await requestMatterScopeSelection(issueAllMattersScopeSelection());
    const { service, files } = createMockWorkspaceService('/wsA');
    await openWorkspace('/wsA', service);

    const m = useMatterStore.getState().createMatter({
      name: 'Acme Family Trust',
      client: 'Acme',
      folderPaths: ['/wsA/Clients/Acme'],
    });
    await requestMatterScopeSelection(issueMatterScopeSelection(m.id));
    await vi.waitFor(() => {
      expect(useMatterStore.getState().activeMatterId).toBe(m.id);
      expect(useClientContextStore.getState().followerStatus).toBe('converged');
    });
    await flushMattersWorkspaceDiskWrites();

    // The record reached the WORKSPACE's own folder, not just the profile.
    expect(readDiskMatterIds(files, '/wsA')).toEqual([m.id]);

    // Profile reset (the WebView2 wipe reproduced on the bench).
    wipeProfile();
    expect(localStorage.getItem(scopedMattersKey('/wsA'))).toBeNull();
    expect(getMatters()).toEqual([]);

    // Reopen the same workspace → organization restored from disk.
    await openWorkspace('/wsA', service);
    expect(getMatters().map((x) => x.id)).toEqual([m.id]);
    expect(getMatters()[0]?.name).toBe('Acme Family Trust');
    await vi.waitFor(() => {
      expect(useMatterStore.getState().activeMatterId).toBe(m.id);
      expect(useClientContextStore.getState().followerStatus).toBe('converged');
    });

    // And the localStorage fast-cache was repopulated for next boot.
    const cached = localStorage.getItem(scopedMattersKey('/wsA'));
    expect(cached).not.toBeNull();
    expect(cached).toContain(m.id);
  });

  it('write-through keeps the disk file current: deleting a matter removes it from the workspace file', async () => {
    const { service, files } = createMockWorkspaceService('/wsA');
    await openWorkspace('/wsA', service);
    const m1 = useMatterStore.getState().createMatter({ name: 'Keep', client: 'Keep', folderPaths: ['/wsA/Keep'] });
    const m2 = useMatterStore.getState().createMatter({ name: 'Drop', client: 'Drop', folderPaths: ['/wsA/Drop'] });
    await flushMattersWorkspaceDiskWrites();
    expect(readDiskMatterIds(files, '/wsA')).toEqual([m1.id, m2.id].sort());

    useMatterStore.getState().deleteMatter(m2.id);
    await flushMattersWorkspaceDiskWrites();
    expect(readDiskMatterIds(files, '/wsA')).toEqual([m1.id]);
  });
});

// ── (b) legacy migration — pre-fix installs whose records are cache-only ─────

describe('legacy migration to the workspace folder', () => {
  it('matters that exist only in the scoped localStorage cache are committed to disk on open, then survive a wipe', async () => {
    // A pre-fix install: scoped cache has the records; no workspace file yet.
    seedLocalStorage(scopedMattersKey('/wsA'), {
      state: { matters: [persistedMatter('m_legacy', '/wsA', 'Legacy')], activeMatterId: null },
      version: 10,
    });
    const { service, files } = createMockWorkspaceService('/wsA');
    expect(files.has(mattersFilePath('/wsA'))).toBe(false);

    await openWorkspace('/wsA', service);
    // One-time migration wrote the workspace file.
    expect(readDiskMatterIds(files, '/wsA')).toEqual(['m_legacy']);

    wipeProfile();
    await openWorkspace('/wsA', service);
    expect(getMatters().map((m) => m.id)).toEqual(['m_legacy']);
  });

  it('matters that exist only under the legacy GLOBAL key (pre-QA-93) also end up on disk after the first scoped open', async () => {
    seedLocalStorage(SK_MATTERS, {
      state: { matters: [persistedMatter('m_global', '/wsA', 'Global')], activeMatterId: null },
      version: 10,
    });
    const { service, files } = createMockWorkspaceService('/wsA');

    await openWorkspace('/wsA', service); // QA-93 global→scoped migration + disk commit
    expect(readDiskMatterIds(files, '/wsA')).toEqual(['m_global']);

    wipeProfile();
    await openWorkspace('/wsA', service);
    expect(getMatters().map((m) => m.id)).toEqual(['m_global']);
  });

  it('an empty workspace with an empty cache writes no matters file (no pointless dirtying)', async () => {
    const { service, files } = createMockWorkspaceService('/wsA');
    await openWorkspace('/wsA', service);
    expect(files.has(mattersFilePath('/wsA'))).toBe(false);
  });
});

// ── (c) multi-workspace isolation ─────────────────────────────────────────────

describe('multi-workspace isolation', () => {
  it('each workspace stores its own records in its own folder; a wipe + reopen restores each correctly with no bleed', async () => {
    const wsA = createMockWorkspaceService('/wsA');
    const wsB = createMockWorkspaceService('/wsB');

    await openWorkspace('/wsA', wsA.service);
    const a = useMatterStore.getState().createMatter({ name: 'Alpha', client: 'Alpha', folderPaths: ['/wsA/Alpha'] });
    await flushMattersWorkspaceDiskWrites();

    await openWorkspace('/wsB', wsB.service);
    const b = useMatterStore.getState().createMatter({ name: 'Beta', client: 'Beta', folderPaths: ['/wsB/Beta'] });
    await flushMattersWorkspaceDiskWrites();

    // Each workspace folder holds ONLY its own records.
    expect(readDiskMatterIds(wsA.files, '/wsA')).toEqual([a.id]);
    expect(readDiskMatterIds(wsB.files, '/wsB')).toEqual([b.id]);
    expect(wsA.files.has(mattersFilePath('/wsB'))).toBe(false);
    expect(wsB.files.has(mattersFilePath('/wsA'))).toBe(false);

    wipeProfile();

    await openWorkspace('/wsA', wsA.service);
    expect(getMatters().map((m) => m.id)).toEqual([a.id]);

    await openWorkspace('/wsB', wsB.service);
    expect(getMatters().map((m) => m.id)).toEqual([b.id]);

    // Switching back still shows A's set — nothing bled between scopes.
    await openWorkspace('/wsA', wsA.service);
    expect(getMatters().map((m) => m.id)).toEqual([a.id]);
  });
});

describe('fast workspace switch', () => {
  it('a change made just before switching workspaces still reaches the OUTGOING workspace file', async () => {
    const wsA = createMockWorkspaceService('/wsA');
    const wsB = createMockWorkspaceService('/wsB');

    await openWorkspace('/wsA', wsA.service);
    const a = useMatterStore.getState().createMatter({ name: 'LastMinute', client: 'LastMinute', folderPaths: ['/wsA/LastMinute'] });
    // Do NOT flush — switch immediately, with A's final write still queued.
    setActiveWorkspaceService(wsB.service);
    setActiveWorkspaceScopeRoot('/wsB');
    await useMatterStore.persist.rehydrate();
    await hydrateMattersFromWorkspaceDisk('/wsB');
    await flushMattersWorkspaceDiskWrites();

    // The queued write landed in /wsA's own file, not /wsB's, and wasn't dropped.
    expect(readDiskMatterIds(wsA.files, '/wsA')).toEqual([a.id]);
    expect(wsB.files.has(mattersFilePath('/wsB'))).toBe(false);

    // And a later fresh-profile reopen of /wsA sees it (disk-wins can't discard it).
    wipeProfile();
    await openWorkspace('/wsA', wsA.service);
    expect(getMatters().map((m) => m.id)).toEqual([a.id]);
  });
});

// ── conflict + corruption handling ───────────────────────────────────────────

describe('disk is the source of truth', () => {
  it('when both exist, the workspace file wins over a stale localStorage cache', async () => {
    const { service, files } = createMockWorkspaceService('/wsA');
    seedDiskFile(files, '/wsA', [persistedMatter('m_disk', '/wsA', 'FromDisk')]);
    seedLocalStorage(scopedMattersKey('/wsA'), {
      state: { matters: [persistedMatter('m_stale', '/wsA', 'StaleCache')], activeMatterId: 'm_stale' },
      version: 10,
    });

    await openWorkspace('/wsA', service);
    expect(getMatters().map((m) => m.id)).toEqual(['m_disk']);
    // Stale active id from the cache never survives disk hydration.
    expect(useMatterStore.getState().activeMatterId).toBeNull();
    // Cache refreshed to match disk.
    expect(localStorage.getItem(scopedMattersKey('/wsA'))).toContain('m_disk');
    expect(localStorage.getItem(scopedMattersKey('/wsA'))).not.toContain('m_stale');
  });

  it('a client created in the instant after open is unioned with the disk restore, never clobbered', async () => {
    const { service, files } = createMockWorkspaceService('/wsA');
    seedDiskFile(files, '/wsA', [persistedMatter('m_disk', '/wsA', 'FromDisk')]);
    setActiveWorkspaceService(service);
    setActiveWorkspaceScopeRoot('/wsA');
    await useMatterStore.persist.rehydrate();

    const hydrating = hydrateMattersFromWorkspaceDisk('/wsA');
    // User acts before the disk read lands (fresh profile: list looked empty).
    const created = useMatterStore.getState().createMatter({
      name: 'JustNow',
      client: 'JustNow',
      folderPaths: ['/wsA/JustNow'],
    });
    await hydrating;
    await flushMattersWorkspaceDiskWrites();

    const expected = ['m_disk', created.id].sort();
    expect(getMatters().map((m) => m.id).sort()).toEqual(expected);
    expect(readDiskMatterIds(files, '/wsA')).toEqual(expected);
  });

  it('an EDIT to an existing client made during the disk read is preserved (three-way merge)', async () => {
    const { service, files } = createMockWorkspaceService('/wsA');
    seedDiskFile(files, '/wsA', [persistedMatter('m1', '/wsA', 'Original')]);
    seedLocalStorage(scopedMattersKey('/wsA'), {
      state: { matters: [persistedMatter('m1', '/wsA', 'Original')], activeMatterId: null },
      version: 10,
    });
    setActiveWorkspaceService(service);
    setActiveWorkspaceScopeRoot('/wsA');
    await useMatterStore.persist.rehydrate();

    const hydrating = hydrateMattersFromWorkspaceDisk('/wsA');
    useMatterStore.getState().renameMatter('m1', { name: 'Renamed Mid-Read' });
    await hydrating;
    await flushMattersWorkspaceDiskWrites();

    expect(getMatters().find((m) => m.id === 'm1')?.name).toBe('Renamed Mid-Read');
    const raw = files.get(mattersFilePath('/wsA')) ?? '';
    expect(raw).toContain('Renamed Mid-Read');
  });

  it('a DELETE of an existing client made during the disk read is honored, not resurrected', async () => {
    const { service, files } = createMockWorkspaceService('/wsA');
    seedDiskFile(files, '/wsA', [
      persistedMatter('m1', '/wsA', 'Keep'),
      persistedMatter('m2', '/wsA', 'Drop'),
    ]);
    seedLocalStorage(scopedMattersKey('/wsA'), {
      state: {
        matters: [persistedMatter('m1', '/wsA', 'Keep'), persistedMatter('m2', '/wsA', 'Drop')],
        activeMatterId: null,
      },
      version: 10,
    });
    setActiveWorkspaceService(service);
    setActiveWorkspaceScopeRoot('/wsA');
    await useMatterStore.persist.rehydrate();

    const hydrating = hydrateMattersFromWorkspaceDisk('/wsA');
    useMatterStore.getState().deleteMatter('m2');
    await hydrating;
    await flushMattersWorkspaceDiskWrites();

    expect(getMatters().map((m) => m.id)).toEqual(['m1']);
    expect(readDiskMatterIds(files, '/wsA')).toEqual(['m1']);
  });

  it('after a read ERROR on reopen, writes stay blocked — the unreadable file is never overwritten', async () => {
    const { service, files } = createMockWorkspaceService('/wsA');
    // First open: healthy, gate opens, record lands on disk.
    await openWorkspace('/wsA', service);
    const m = useMatterStore.getState().createMatter({ name: 'Existing', client: 'Existing', folderPaths: ['/wsA/Existing'] });
    await flushMattersWorkspaceDiskWrites();
    const goodBytes = files.get(mattersFilePath('/wsA'));
    expect(goodBytes).toContain(m.id);

    // Reopen the SAME workspace in the same session, but now reads fail (disk trouble).
    const failingService = {
      ...(service as unknown as Record<string, unknown>),
      exists: () => Promise.reject(new Error('EIO: disk unreadable')),
    } as unknown as WorkspaceService;
    setActiveWorkspaceService(failingService);
    setActiveWorkspaceScopeRoot('/wsA');
    await useMatterStore.persist.rehydrate();
    await hydrateMattersFromWorkspaceDisk('/wsA');

    // A change made in this degraded session must not clobber the file we couldn't read.
    useMatterStore.getState().createMatter({ name: 'Degraded', client: 'Degraded', folderPaths: ['/wsA/Degraded'] });
    await flushMattersWorkspaceDiskWrites();
    expect(files.get(mattersFilePath('/wsA'))).toBe(goodBytes);
  });

  it('when the corrupt-file backup itself fails, the corrupt file is left untouched (only recoverable copy)', async () => {
    const { service, files } = createMockWorkspaceService('/wsA');
    const corruptRaw = '{"broken';
    files.set(mattersFilePath('/wsA'), corruptRaw);
    seedLocalStorage(scopedMattersKey('/wsA'), {
      state: { matters: [persistedMatter('m_cache', '/wsA', 'CacheCopy')], activeMatterId: null },
      version: 10,
    });
    // Backup writes (.corrupt-*) fail; everything else works.
    const realWrite = service.writeFile.bind(service);
    (service as unknown as { writeFile: (p: string, c: string) => Promise<void> }).writeFile = (
      p: string,
      c: string,
    ) => (p.includes('.corrupt-') ? Promise.reject(new Error('ENOSPC')) : realWrite(p, c));

    await openWorkspace('/wsA', service);

    // Cache still serves the session…
    expect(getMatters().map((m) => m.id)).toEqual(['m_cache']);
    // …but the corrupt bytes were NOT replaced, and later writes stay blocked.
    expect(files.get(mattersFilePath('/wsA'))).toBe(corruptRaw);
    useMatterStore.getState().createMatter({ name: 'Later', client: 'Later', folderPaths: ['/wsA/Later'] });
    await flushMattersWorkspaceDiskWrites();
    expect(files.get(mattersFilePath('/wsA'))).toBe(corruptRaw);
  });

  it('recovers from the .bak sibling when the main file vanished mid-replacement, and re-commits it', async () => {
    const { service, files } = createMockWorkspaceService('/wsA');
    files.set(
      `${mattersFilePath('/wsA')}.bak`,
      JSON.stringify({
        version: 10,
        savedAt: '2026-07-01T00:00:00Z',
        state: { matters: [persistedMatter('m_bak', '/wsA', 'FromBak')], activeMatterId: null, snapshots: {}, cache: {} },
      }),
    );
    expect(files.has(mattersFilePath('/wsA'))).toBe(false);

    await openWorkspace('/wsA', service);
    expect(getMatters().map((m) => m.id)).toEqual(['m_bak']);
    // The recovered state was re-committed to the MAIN file.
    expect(readDiskMatterIds(files, '/wsA')).toEqual(['m_bak']);
  });

  it('a well-formed-JSON but structurally-empty file is treated as corrupt (backed up, cache kept)', async () => {
    const { service, files } = createMockWorkspaceService('/wsA');
    const malformedRaw = '{"version":10,"state":{}}'; // valid JSON, no matters array
    files.set(mattersFilePath('/wsA'), malformedRaw);
    seedLocalStorage(scopedMattersKey('/wsA'), {
      state: { matters: [persistedMatter('m_cache', '/wsA', 'CacheCopy')], activeMatterId: null },
      version: 10,
    });

    await openWorkspace('/wsA', service);

    expect(getMatters().map((m) => m.id)).toEqual(['m_cache']);
    const backupEntry = [...files.entries()].find(([p]) =>
      p.startsWith(`${mattersFilePath('/wsA')}.corrupt-`),
    );
    expect(backupEntry?.[1]).toBe(malformedRaw);
    expect(readDiskMatterIds(files, '/wsA')).toEqual(['m_cache']);
  });

  it('a corrupt workspace file is backed up (never silently destroyed) and rebuilt from the cache', async () => {
    const { service, files } = createMockWorkspaceService('/wsA');
    const corruptRaw = '{"version":10, this is not json';
    files.set(mattersFilePath('/wsA'), corruptRaw);
    seedLocalStorage(scopedMattersKey('/wsA'), {
      state: { matters: [persistedMatter('m_cache', '/wsA', 'CacheCopy')], activeMatterId: null },
      version: 10,
    });

    await openWorkspace('/wsA', service);

    // Cache copy stayed in charge…
    expect(getMatters().map((m) => m.id)).toEqual(['m_cache']);
    // …the corrupt bytes were preserved under a backup name…
    const backupEntry = [...files.entries()].find(([p]) =>
      p.startsWith(`${mattersFilePath('/wsA')}.corrupt-`),
    );
    expect(backupEntry?.[1]).toBe(corruptRaw);
    // …and the main file was rebuilt from the cache.
    expect(readDiskMatterIds(files, '/wsA')).toEqual(['m_cache']);
  });
});

// ── lifecycle wiring ─────────────────────────────────────────────────────────

describe('reloadWorkspaceScopedStores wiring', () => {
  it('the workspace-open choke-point itself triggers the disk hydrate (fresh profile, records only on disk)', async () => {
    setDevFlagOverride('selection-authority-boot-gate', false);
    requestClearClientSelection();
    setDevFlagOverride('selection-authority-boot-gate', true);
    await requestMatterScopeSelection(issueAllMattersScopeSelection());
    const { service, files } = createMockWorkspaceService('/wsA');
    seedDiskFile(files, '/wsA', [persistedMatter('m_wired', '/wsA', 'Wired')], 'm_wired');

    setActiveWorkspaceService(service);
    reloadWorkspaceScopedStores('/wsA');
    await flushMattersWorkspaceDiskWrites();

    expect(getMatters().map((m) => m.id)).toEqual(['m_wired']);
    await vi.waitFor(() => {
      expect(useMatterStore.getState().activeMatterId).toBe('m_wired');
      expect(useClientContextStore.getState().followerStatus).toBe('converged');
    });
  });
});
