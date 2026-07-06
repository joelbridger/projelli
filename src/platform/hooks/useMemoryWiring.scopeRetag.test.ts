/* eslint-disable @typescript-eslint/unbound-method -- vi.mocked(Service.method) reads the mock registry; the method is never called unbound, so `this` binding is irrelevant in these tests */
/**
 * QA-44 — wiring test for the three scope-update reactions.
 *
 * Proves each reaction now routes its re-tag through the durable, visible,
 * fail-closed scheduler instead of swallowing failures with `.catch(() => {})`:
 *   - folder->matter: schedules a 'matter' task that EXCLUDES the changed
 *     folders from retrieval (fail closed) and re-indexes them;
 *   - mail folder->matter: schedules a 'mail' task that re-tags the folder;
 *   - source privilege: schedules a 'privilege' task that re-tags the source
 *     with its CURRENT resolved privilege.
 *
 * A null scheduler (the brief window before the per-workspace scheduler mounts)
 * still runs the re-tag best-effort rather than dropping it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/platform/utils/mail-commands', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/platform/utils/mail-commands')>();
  return { ...original, mailRetagFolderMatter: vi.fn().mockResolvedValue(1) };
});

vi.mock('@/platform/rag/MemoryService', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/platform/rag/MemoryService')>();
  return {
    ...original,
    MemoryService: {
      ...original.MemoryService,
      retagPrivilege: vi.fn().mockResolvedValue(1),
      // reindexPaths returns the count of files that FAILED (never throws);
      // reindexFolderPaths turns a nonzero count into a thrown error, which is
      // what drives the scheduler's fail-closed retry/exclusion.
      reindexPaths: vi.fn().mockResolvedValue(0),
      // retagMatterBatch is the in-place boot retag for FILE folders; rejecting
      // it drives retagFolderPathsInPlace's fail-closed `matter:boot-retag` write.
      retagMatterBatch: vi.fn().mockResolvedValue(1),
    },
  };
});

import {
  restoreFolderHolds,
  restoreMailHolds,
  retagExistingMailFolders,
  retagExistingMatterFolderPaths,
  scheduleFolderMatterRetag,
  scheduleMailMatterRetag,
  schedulePrivilegeRetag,
  shouldExcludeHitFromRetrieval,
} from './useMemoryWiring';
import { useMatterStore } from '@/platform/matter/matterStore';
import {
  __resetPendingMailRetagHydrationSuspect,
  sanitizePersistedMailRetag,
  usePendingMailRetagStore,
} from '@/platform/rag/pendingMailRetagStore';
import {
  __resetPendingFolderRetagHydrationSuspect,
  sanitizePersistedFolderRetag,
  usePendingFolderRetagStore,
} from '@/platform/rag/pendingFolderRetagStore';
import type { Matter } from '@/platform/types/matter';
import type { RetagScheduler, RetagTask } from '@/platform/rag/retagScheduler';
import { createRetagScheduler } from '@/platform/rag/retagScheduler';
import { MemoryService } from '@/platform/rag/MemoryService';
import {
  getExcludedMailMatters,
  getExcludedMatterFolders,
  useScopeUpdateStore,
} from '@/platform/rag/scopeUpdateStore';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { mailRetagFolderMatter } from '@/platform/utils/mail-commands';
import { usePrivilegeStore } from '@/platform/firm/privilegeStore';

function recordingScheduler(): { scheduler: RetagScheduler; tasks: RetagTask[] } {
  const tasks: RetagTask[] = [];
  return {
    tasks,
    scheduler: {
      run: (task) => {
        tasks.push(task);
      },
      disposeAll: () => {
        /* no-op */
      },
    },
  };
}

/** Assert exactly one task was scheduled and return it (no non-null assertion). */
function onlyTask(tasks: RetagTask[]): RetagTask {
  expect(tasks).toHaveLength(1);
  const [task] = tasks;
  if (!task) throw new Error('expected one scheduled task');
  return task;
}

beforeEach(() => {
  vi.clearAllMocks();
  useScopeUpdateStore.getState().clearAll();
  __resetPendingMailRetagHydrationSuspect(); // R7-6 global flag must not leak between tests
  usePrivilegeStore.setState({ privilegeBySource: {}, includePrivileged: false });
});

afterEach(() => {
  usePrivilegeStore.setState({ privilegeBySource: {}, includePrivileged: false });
});

describe('scheduleFolderMatterRetag', () => {
  it('schedules ONE fail-closed matter task per folder (per-folder keying)', () => {
    const { scheduler, tasks } = recordingScheduler();

    scheduleFolderMatterRetag(['/ws/Beta', '/ws/Acme'], null, scheduler);

    // One task per folder, each keyed by (and excluding) only its own folder — so
    // a later single-folder re-tag supersedes exactly its own hold rather than
    // colliding with a grouped id that would strand the folder excluded.
    expect(tasks).toHaveLength(2);
    for (const task of tasks) expect(task.kind).toBe('matter');
    const byId = new Map(tasks.map((t) => [t.id, t]));
    expect(byId.get('matter:/ws/Beta')?.excludeFolders).toEqual(['/ws/Beta']);
    expect(byId.get('matter:/ws/Acme')?.excludeFolders).toEqual(['/ws/Acme']);
  });

  it('does nothing when no folders changed', () => {
    const { scheduler, tasks } = recordingScheduler();
    scheduleFolderMatterRetag([], null, scheduler);
    expect(tasks).toHaveLength(0);
  });
});

describe('scheduleMailMatterRetag', () => {
  it('schedules a mail task whose op re-tags the parsed folder', async () => {
    const { scheduler, tasks } = recordingScheduler();

    scheduleMailMatterRetag(
      [{ key: 'm365/acct/Inbox', matterId: 'm1', prevMatterId: 'unassigned' }],
      scheduler,
    );

    const task = onlyTask(tasks);
    expect(task.kind).toBe('mail');
    expect(task.id).toBe('mail:m365/acct/Inbox');
    // Fresh mapping (was unassigned) → no old-client hold-out.
    expect(task.excludeMailMatters).toBeUndefined();

    await task.op(() => false);
    // First four args are the folder + target; the 5th (R7-5b workspace pin)
    // depends on the ambient rootPath, so assert only the folder/target here.
    const call = vi.mocked(mailRetagFolderMatter).mock.calls[0];
    expect(call?.slice(0, 4)).toEqual(['m365', 'acct', 'Inbox', 'm1']);
  });

  it('holds out the OLD client mail when a folder is re-mapped between real clients', () => {
    const { scheduler, tasks } = recordingScheduler();

    scheduleMailMatterRetag(
      [{ key: 'm365/acct/Inbox', matterId: 'clientB', prevMatterId: 'clientA' }],
      scheduler,
    );

    const task = onlyTask(tasks);
    // clientA's mail is held out of retrieval until the re-tag to clientB lands.
    expect(task.excludeMailMatters).toEqual(['clientA']);
  });

  it('skips a malformed mail-folder key', () => {
    const { scheduler, tasks } = recordingScheduler();
    scheduleMailMatterRetag([{ key: 'nope', matterId: 'm1', prevMatterId: 'unassigned' }], scheduler);
    expect(tasks).toHaveLength(0);
  });
});

describe('schedulePrivilegeRetag', () => {
  it('schedules a privilege task whose op re-tags the source with its current privilege', async () => {
    usePrivilegeStore.getState().setPrivilege('/ws/secret.docx', 'attorney-client');
    const { scheduler, tasks } = recordingScheduler();

    schedulePrivilegeRetag(['/ws/secret.docx'], scheduler);

    const task = onlyTask(tasks);
    expect(task.kind).toBe('privilege');
    expect(task.id).toBe('privilege:/ws/secret.docx');

    await task.op(() => false);
    expect(vi.mocked(MemoryService.retagPrivilege)).toHaveBeenCalledWith(
      '/ws/secret.docx',
      'attorney-client',
    );
  });
});

describe('null-scheduler fallback (still best-effort, never dropped)', () => {
  it('runs the privilege re-tag directly when no scheduler is mounted', () => {
    usePrivilegeStore.getState().setPrivilege('/ws/x', 'work-product');

    schedulePrivilegeRetag(['/ws/x'], null);

    expect(vi.mocked(MemoryService.retagPrivilege)).toHaveBeenCalledWith('/ws/x', 'work-product');
  });
});

// ── Codex round-2 lifecycle repros: the exclusion set must track the ACTUAL
//    index state across REPEATED remaps, driven through the REAL scheduler +
//    scopeUpdateStore (not the recording stub). ────────────────────────────────

describe('scheduleMailMatterRetag — stale-matter hold survives a second re-map (P1 leak)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useScopeUpdateStore.getState().clearAll();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    useScopeUpdateStore.getState().clearAll();
  });

  it('keeps holding out the ORIGINAL client after re-mapping again before the first re-tag succeeds', async () => {
    const scheduler = createRetagScheduler();
    // Inbox A->B: the re-tag fails permanently. Messages stay physically tagged A.
    vi.mocked(mailRetagFolderMatter).mockRejectedValue(new Error('down'));

    scheduleMailMatterRetag(
      [{ key: 'm365/acct/Inbox', matterId: 'B', prevMatterId: 'A' }],
      scheduler,
    );
    await vi.runAllTimersAsync();
    expect(getExcludedMailMatters()).toContain('A'); // fail-closed on A

    // User re-maps the SAME folder B->C before A->B ever landed. The old code
    // superseded the hold with [B] and DROPPED A — but the messages are still
    // physically tagged A, so A would surface under the wrong client.
    scheduleMailMatterRetag(
      [{ key: 'm365/acct/Inbox', matterId: 'C', prevMatterId: 'B' }],
      scheduler,
    );
    await vi.runAllTimersAsync();

    const held = getExcludedMailMatters();
    expect(held).toContain('A'); // ORIGINAL client still held out — no leak
    expect(held).toContain('B'); // and the intermediate client too
    expect(held).not.toContain('C'); // never hold out the current (correct) target
  });

  it('clears the whole accumulated hold once a re-tag finally succeeds', async () => {
    const scheduler = createRetagScheduler();
    vi.mocked(mailRetagFolderMatter).mockRejectedValue(new Error('down'));
    scheduleMailMatterRetag(
      [{ key: 'm365/acct/Inbox', matterId: 'B', prevMatterId: 'A' }],
      scheduler,
    );
    await vi.runAllTimersAsync();
    expect(getExcludedMailMatters()).toContain('A');

    // The next re-map succeeds — the folder is physically re-tagged, so NO stale
    // tag remains and the entire hold (A included) must clear.
    vi.mocked(mailRetagFolderMatter).mockReset();
    vi.mocked(mailRetagFolderMatter).mockResolvedValue(1);
    scheduleMailMatterRetag(
      [{ key: 'm365/acct/Inbox', matterId: 'C', prevMatterId: 'B' }],
      scheduler,
    );
    await vi.runAllTimersAsync();

    expect(getExcludedMailMatters()).toHaveLength(0);
  });
});

describe('scheduleFolderMatterRetag — a later single-folder success clears its own hold (P2 stranding)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useScopeUpdateStore.getState().clearAll();
    useWorkspaceStore.setState({
      rootPath: '/ws',
      fileTree: [
        { id: 'A', type: 'folder', name: 'A', path: '/ws/A', children: [
          { id: 'A/a', type: 'file', name: 'a.docx', path: '/ws/A/a.docx' },
        ] },
        { id: 'B', type: 'folder', name: 'B', path: '/ws/B', children: [
          { id: 'B/b', type: 'file', name: 'b.docx', path: '/ws/B/b.docx' },
        ] },
      ],
    });
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    useScopeUpdateStore.getState().clearAll();
  });

  it('does not strand folder A excluded after A re-indexes, when an earlier grouped A+B re-tag failed', async () => {
    const scheduler = createRetagScheduler();

    // Folders A and B change TOGETHER and the re-index fails (reindexPaths reports
    // a failure) → both folders held out, fail-closed.
    vi.mocked(MemoryService.reindexPaths).mockResolvedValue(1);
    scheduleFolderMatterRetag(['/ws/A', '/ws/B'], null, scheduler);
    await vi.runAllTimersAsync();
    expect(getExcludedMatterFolders()).toEqual(
      expect.arrayContaining(['/ws/A', '/ws/B']),
    );

    // Later, ONLY folder A changes and its re-index succeeds. With per-folder
    // keying this supersedes A's own hold and clears it; B stays held. The old
    // grouped-id code left an untouched `matter:/ws/A|/ws/B` entry, so A stayed
    // wrongly excluded from search until the next boot reconcile.
    vi.mocked(MemoryService.reindexPaths).mockResolvedValue(0);
    scheduleFolderMatterRetag(['/ws/A'], null, scheduler);
    await vi.runAllTimersAsync();

    const excluded = getExcludedMatterFolders();
    expect(excluded).not.toContain('/ws/A'); // A's success cleared its own hold
    expect(excluded).toContain('/ws/B'); // B still fail-closed until it re-tags
  });
});

// ── Codex round-3: the DEEPEST layer — a failed mail re-map's exclusion is
//    in-memory only, so a workspace close/switch drops it. Files are healed on
//    reopen by `retagExistingMatterFolderPaths`; mail had no such boot heal, so
//    still-old-client-tagged mail surfaced under the WRONG client next session.
//    `retagExistingMailFolders` is the mail mirror of that boot heal. ──────────

function matter(over: Partial<Matter> & { id: string }): Matter {
  return {
    name: over.id,
    client: over.id,
    folderPaths: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

// ── Codex round-4: make the mail hold DURABLE + PER-WORKSPACE so it survives a
//    close/switch and any number of failed re-taps, and so one workspace's holds
//    never bleed into another. `usePendingMailRetagStore` is the durable backing;
//    `restoreMailHolds` re-establishes the exclusion on open (fail closed FIRST);
//    a boot re-tag discharges it only on SUCCESS. ──────────────────────────────

/** Mirror the workspace-switch cleanup the scheduler effect performs. */
function simulateWorkspaceClose(scheduler: { disposeAll: () => void }): void {
  scheduler.disposeAll();
  useScopeUpdateStore.getState().clearAll();
}

describe('durable per-workspace mail hold (round 4)', () => {
  beforeEach(() => {
    useScopeUpdateStore.getState().clearAll();
    useMatterStore.setState({ matters: [] });
    usePendingMailRetagStore.setState({ intents: {} });
    useWorkspaceStore.setState({ rootPath: '/wsA' });
  });
  afterEach(() => {
    useScopeUpdateStore.getState().clearAll();
    useMatterStore.setState({ matters: [] });
    usePendingMailRetagStore.setState({ intents: {} });
    useWorkspaceStore.setState({ rootPath: null });
  });

  it('R7-6: surfaces a failed banner when the durable store hydrated incompletely', () => {
    // A corrupt/partial persisted blob dropped a malformed record → suspect.
    sanitizePersistedMailRetag({ intents: { bad: { staleMatters: 5 } } });
    useScopeUpdateStore.getState().clearAll();

    restoreMailHolds('/wsA');

    // A visible failed banner signals the mail scope may still be settling — the
    // hold set could be missing records, so we don't fail SILENTLY open.
    const entry = useScopeUpdateStore.getState().entries['mail:hydration-suspect'];
    expect(entry?.status).toBe('failed');
    expect(entry?.kind).toBe('mail');
  });

  it('R7-6: does NOT surface the suspect banner when hydration was clean', () => {
    restoreMailHolds('/wsA');
    expect(useScopeUpdateStore.getState().entries['mail:hydration-suspect']).toBeUndefined();
  });

  it('re-tags every mapped mail folder to its CURRENT matter on boot', async () => {
    useMatterStore.setState({
      matters: [matter({ id: 'B', mailFolderPaths: ['m365/acct/Inbox'] })],
    });
    vi.mocked(mailRetagFolderMatter).mockResolvedValue(3);

    await retagExistingMailFolders();

    // R7-5b: the captured workspace root is passed as the pin (5th arg).
    expect(vi.mocked(mailRetagFolderMatter)).toHaveBeenCalledWith('m365', 'acct', 'Inbox', 'B', '/wsA');
  });

  // FINDING #1 — the double-failure leak. A live re-map fails, the workspace is
  // closed (in-memory hold dropped), reopened (hold re-established from the
  // durable record), and the BOOT re-tag ALSO fails → the mail must STILL be held
  // out. Previously the boot catch only showed a banner and installed no
  // exclusion, so the mail leaked under the old client on the double failure.
  it('keeps the mail excluded across close + reopen + a double-failing boot retag (no leak)', async () => {
    vi.useFakeTimers();
    const scheduler = createRetagScheduler();
    useMatterStore.setState({
      matters: [matter({ id: 'B', mailFolderPaths: ['m365/acct/Inbox'] })],
    });

    // Live re-map A->B fails permanently.
    vi.mocked(mailRetagFolderMatter).mockRejectedValue(new Error('down'));
    scheduleMailMatterRetag(
      [{ key: 'm365/acct/Inbox', matterId: 'B', prevMatterId: 'A' }],
      scheduler,
    );
    await vi.runAllTimersAsync();
    expect(getExcludedMailMatters()).toContain('A');
    // The hold is now DURABLE, keyed by workspace.
    expect(usePendingMailRetagStore.getState().forWorkspace('/wsA')).toHaveLength(1);
    vi.useRealTimers();

    // Close/switch: the in-memory hold is dropped, but the durable record stays.
    simulateWorkspaceClose(scheduler);
    expect(getExcludedMailMatters()).not.toContain('A');
    expect(usePendingMailRetagStore.getState().forWorkspace('/wsA')).toHaveLength(1);

    // Reopen: re-establish the exclusion FIRST from the durable record.
    restoreMailHolds('/wsA');
    expect(getExcludedMailMatters()).toContain('A');

    // The boot re-tag ALSO fails → the exclusion + record MUST survive (no leak).
    await retagExistingMailFolders();
    expect(getExcludedMailMatters()).toContain('A');
    expect(usePendingMailRetagStore.getState().forWorkspace('/wsA')).toHaveLength(1);
  });

  it('discharges the hold and clears the durable record when the boot retag finally succeeds', async () => {
    vi.useFakeTimers();
    const scheduler = createRetagScheduler();
    useMatterStore.setState({
      matters: [matter({ id: 'B', mailFolderPaths: ['m365/acct/Inbox'] })],
    });
    vi.mocked(mailRetagFolderMatter).mockRejectedValue(new Error('down'));
    scheduleMailMatterRetag(
      [{ key: 'm365/acct/Inbox', matterId: 'B', prevMatterId: 'A' }],
      scheduler,
    );
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    simulateWorkspaceClose(scheduler);
    restoreMailHolds('/wsA');
    expect(getExcludedMailMatters()).toContain('A');

    // Reopen's boot re-tag succeeds → mail physically at B → hold + record clear.
    vi.mocked(mailRetagFolderMatter).mockReset();
    vi.mocked(mailRetagFolderMatter).mockResolvedValue(2);
    await retagExistingMailFolders();
    expect(getExcludedMailMatters()).not.toContain('A');
    expect(usePendingMailRetagStore.getState().forWorkspace('/wsA')).toHaveLength(0);
  });

  it('drives an UNMAPPED folder with a pending hold to resolution on boot (no permanent hide)', async () => {
    // A durable hold exists for a folder that is no longer in any matter mapping
    // (it was unmapped -> target 'unassigned'), so no mapped-folder pass covers it.
    useMatterStore.setState({ matters: [] });
    usePendingMailRetagStore.getState().record({
      workspaceRoot: '/wsA',
      provider: 'm365',
      account: 'acct',
      folderId: 'Inbox',
      targetMatter: 'unassigned',
      staleMatters: ['A'],
    });
    restoreMailHolds('/wsA');
    expect(getExcludedMailMatters()).toContain('A');

    // The boot pass still re-tags it (to the intent's own target) and, on success,
    // discharges the hold — the mail isn't stranded held-out forever.
    vi.mocked(mailRetagFolderMatter).mockResolvedValue(1);
    await retagExistingMailFolders();
    expect(vi.mocked(mailRetagFolderMatter)).toHaveBeenCalledWith('m365', 'acct', 'Inbox', 'unassigned', '/wsA');
    expect(getExcludedMailMatters()).not.toContain('A');
    expect(usePendingMailRetagStore.getState().forWorkspace('/wsA')).toHaveLength(0);
  });

  // FINDING #2 — no cross-workspace bleed. A boot-retag hold in workspace A (both
  // the file `matter:boot-retag` entry AND a restored mail hold) must be gone
  // after switching to workspace B, which has no mappings.
  it('does not bleed workspace A holds/paths into workspace B on switch', () => {
    const scheduler = createRetagScheduler();
    // A has a durable mail hold and a failed file boot-retag entry.
    usePendingMailRetagStore.getState().record({
      workspaceRoot: '/wsA',
      provider: 'm365',
      account: 'acct',
      folderId: 'Inbox',
      targetMatter: 'B',
      staleMatters: ['A'],
    });
    restoreMailHolds('/wsA');
    useScopeUpdateStore.getState().begin({
      id: 'matter:boot-retag',
      kind: 'matter',
      label: 'Applying client scope to search',
      excludeFolders: ['/wsA/Acme/file.docx'],
    });
    useScopeUpdateStore.getState().markFailed('matter:boot-retag');
    expect(getExcludedMatterFolders()).toContain('/wsA/Acme/file.docx');
    expect(getExcludedMailMatters()).toContain('A');

    // Switch to B (no mappings).
    simulateWorkspaceClose(scheduler);
    useWorkspaceStore.setState({ rootPath: '/wsB' });
    useMatterStore.setState({ matters: [] });
    restoreMailHolds('/wsB');

    // B sees NONE of A's holds — the un-owned boot-retag entry was cleared on
    // switch, and B's own durable records are empty (A's stay keyed to A).
    expect(getExcludedMatterFolders()).toHaveLength(0);
    expect(getExcludedMailMatters()).toHaveLength(0);
    expect(usePendingMailRetagStore.getState().forWorkspace('/wsB')).toHaveLength(0);
    expect(usePendingMailRetagStore.getState().forWorkspace('/wsA')).toHaveLength(1);
  });

  // FINDING #2 — the late-write half. A's async file boot retag can resolve AFTER
  // the switch; its `matter:boot-retag` write must be skipped so it can't land in
  // B (whose own retag early-returns with no mapped folders).
  it('skips the boot-retag write when the workspace switched mid-retag', async () => {
    useMatterStore.setState({
      matters: [matter({ id: 'M', folderPaths: ['/wsA/Acme'] })],
    });
    useWorkspaceStore.setState({
      rootPath: '/wsA',
      fileTree: [
        { id: 'Acme', type: 'folder', name: 'Acme', path: '/wsA/Acme', children: [
          { id: 'Acme/f', type: 'file', name: 'file.docx', path: '/wsA/Acme/file.docx' },
        ] },
      ],
    });
    // The batched file retag fails AND the workspace switches mid-flight.
    vi.mocked(MemoryService.retagMatterBatch).mockImplementation(() => {
      useWorkspaceStore.setState({ rootPath: '/wsB' });
      return Promise.reject(new Error('down'));
    });

    await retagExistingMatterFolderPaths(null);

    // Guard tripped: no stale hold bled into the now-active workspace B.
    expect(getExcludedMatterFolders()).toHaveLength(0);
  });
});

// ── Final round P2: a boot-time `matter:boot-retag` hold (a DIFFERENT id from the
//    live per-folder `matter:<folder>` entries) must be discharged when a later
//    LIVE folder retag succeeds in the same session — otherwise its files stay
//    HIDDEN from search until a clean boot. ─────────────────────────────────────

describe('scheduleFolderMatterRetag — live success discharges the boot-retag hold', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useScopeUpdateStore.getState().clearAll();
    useWorkspaceStore.setState({
      rootPath: '/ws',
      fileTree: [
        { id: 'A', type: 'folder', name: 'A', path: '/ws/A', children: [
          { id: 'A/f', type: 'file', name: 'file.docx', path: '/ws/A/file.docx' },
        ] },
      ],
    });
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    useScopeUpdateStore.getState().clearAll();
    useWorkspaceStore.setState({ rootPath: null });
  });

  it('makes boot-retag-held files under a folder visible once its LIVE retag succeeds', async () => {
    // A boot-time in-place retag FAILED on a file under /ws/A: the aggregate
    // `matter:boot-retag` hold keeps it excluded from search.
    useScopeUpdateStore.getState().begin({
      id: 'matter:boot-retag',
      kind: 'matter',
      label: 'Applying client scope to search',
      excludeFolders: ['/ws/A/file.docx'],
    });
    useScopeUpdateStore.getState().markFailed('matter:boot-retag');
    expect(getExcludedMatterFolders()).toContain('/ws/A/file.docx');

    // A LIVE folder retag of /ws/A now SUCCEEDS (different id `matter:/ws/A`).
    const scheduler = createRetagScheduler();
    vi.mocked(MemoryService.reindexPaths).mockResolvedValue(0);
    scheduleFolderMatterRetag(['/ws/A'], null, scheduler);
    await vi.runAllTimersAsync();

    // The file was re-tagged by the live success, so it is discharged from the
    // boot hold and VISIBLE again — not stranded until a clean boot.
    expect(getExcludedMatterFolders()).not.toContain('/ws/A/file.docx');
  });

  it('leaves boot-retag paths OUTSIDE the retagged folder still held', async () => {
    useScopeUpdateStore.getState().begin({
      id: 'matter:boot-retag',
      kind: 'matter',
      label: 'Applying client scope to search',
      excludeFolders: ['/ws/A/file.docx', '/ws/B/other.docx'],
    });
    useScopeUpdateStore.getState().markFailed('matter:boot-retag');

    const scheduler = createRetagScheduler();
    vi.mocked(MemoryService.reindexPaths).mockResolvedValue(0);
    scheduleFolderMatterRetag(['/ws/A'], null, scheduler);
    await vi.runAllTimersAsync();

    // Only /ws/A's file is discharged; /ws/B's still-failed file stays held.
    expect(getExcludedMatterFolders()).not.toContain('/ws/A/file.docx');
    expect(getExcludedMatterFolders()).toContain('/ws/B/other.docx');
  });
});

// ── R7-1 · the semantic half of the merge with origin's workspace-identity guards:
//    an identity-abort (workspace switch / in-place reload) mid-re-tag must be a
//    DISTINCT outcome that NEVER reads as a clean success. Origin's guards make
//    `reindexFolderPaths` return quietly on a switch; the scheduler op therefore
//    must re-check identity after it resolves and KEEP the fail-closed hold rather
//    than discharge it, or a stale wrong-client tag becomes retrievable. ─────────
describe('scheduleFolderMatterRetag — a mid-flight workspace switch never clears a fail-closed hold (R7-1)', () => {
  beforeEach(() => {
    useScopeUpdateStore.getState().clearAll();
    useWorkspaceStore.setState({ rootPath: '/ws/A', rootGeneration: 1, fileTree: [] });
  });
  afterEach(() => {
    useScopeUpdateStore.getState().clearAll();
    useWorkspaceStore.setState({ rootPath: null });
  });

  it('does NOT discharge the boot-retag hold when the workspace switches while a folder re-tag is in flight', async () => {
    // A boot-time in-place retag FAILED on a file under /ws/A — held out of search.
    useScopeUpdateStore.getState().begin({
      id: 'matter:boot-retag',
      kind: 'matter',
      label: 'Applying client scope to search',
      excludeFolders: ['/ws/A/file.docx'],
    });
    useScopeUpdateStore.getState().markFailed('matter:boot-retag');
    expect(getExcludedMatterFolders()).toContain('/ws/A/file.docx');

    // A controllable fresh-scan lets us switch the workspace WHILE the op is in
    // flight (before reindexFolderPaths' first identity check).
    let resolveTree!: (tree: never[]) => void;
    const ws = {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      exists: vi.fn(),
      getFileTree: vi.fn().mockImplementation(
        () =>
          new Promise<never[]>((resolve) => {
            resolveTree = resolve;
          }),
      ),
    };

    const { scheduler, tasks } = recordingScheduler();
    scheduleFolderMatterRetag(['/ws/A'], ws as never, scheduler);
    const task = onlyTask(tasks);

    // Op captures identity {/ws/A, gen1} and awaits the fresh scan… (driving the
    // op directly, so stand in for the scheduler's supersession check: never
    // superseded here — the identity-abort is what must keep the hold).
    const opPromise = task.op(() => false);
    // …then the user switches workspace before the scan resolves.
    useWorkspaceStore.getState().setRootPath('/ws/B');
    resolveTree([]);
    // A bail rejects (the op throws a sentinel so the scheduler keeps the hold);
    // we assert on the store state below, so intentionally ignore it here.
    // eslint-disable-next-line lantern-async/no-silent-failure -- test deliberately swallows the sentinel rejection; the fail-closed assertions below are the real check
    await opPromise.catch(() => undefined);

    // Nothing was re-tagged (identity-abort), so the boot hold for /ws/A MUST
    // survive — an aborted op is NOT a clean success.
    expect(vi.mocked(MemoryService.reindexPaths)).not.toHaveBeenCalled();
    expect(getExcludedMatterFolders()).toContain('/ws/A/file.docx');
  });
});

// ── R7-3 · durable per-workspace FILE-folder holds (the file mirror of the mail
//    hold). A live folder re-map that never lands must leave a hold that survives a
//    close and is re-established synchronously on next open, so the files aren't
//    retrievable under the wrong client in the window before the slow boot retag. ─
describe('durable per-workspace FILE-folder hold (R7-3)', () => {
  beforeEach(() => {
    useScopeUpdateStore.getState().clearAll();
    usePendingFolderRetagStore.setState({ heldByWorkspace: {} });
    useWorkspaceStore.setState({ rootPath: '/wsA', rootGeneration: 1, fileTree: [] });
  });
  afterEach(() => {
    useScopeUpdateStore.getState().clearAll();
    usePendingFolderRetagStore.setState({ heldByWorkspace: {} });
    useWorkspaceStore.setState({ rootPath: null });
  });

  it('records a re-mapped folder durably up front and restores its hold on next open', () => {
    // A live folder re-map is scheduled but never lands (recordingScheduler never
    // runs the op — the app closed, or every retry failed).
    const { scheduler } = recordingScheduler();
    scheduleFolderMatterRetag(['/wsA/Acme'], null, scheduler);
    expect(usePendingFolderRetagStore.getState().forWorkspace('/wsA')).toContain('/wsA/Acme');

    // Close: the in-memory scope holds are wiped (the mount cleanup's clearAll).
    useScopeUpdateStore.getState().clearAll();
    expect(getExcludedMatterFolders()).toHaveLength(0);

    // Reopen: the durable record re-establishes the fail-closed hold SYNCHRONOUSLY,
    // before the slow boot retag runs — so /wsA/Acme's files are held out now.
    restoreFolderHolds('/wsA');
    expect(getExcludedMatterFolders()).toContain('/wsA/Acme');
  });

  it('does not bleed one workspace hold into another on switch', () => {
    const { scheduler } = recordingScheduler();
    scheduleFolderMatterRetag(['/wsA/Acme'], null, scheduler);
    // Switch to workspace B and restore ITS holds — A's hold must not appear.
    useScopeUpdateStore.getState().clearAll();
    restoreFolderHolds('/wsB');
    expect(getExcludedMatterFolders()).toHaveLength(0);
  });

  it('a live folder re-map SUCCESS discharges the durable hold (no stale hold next open)', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(MemoryService.reindexPaths).mockResolvedValue(0); // clean re-index
      const scheduler = createRetagScheduler();
      scheduleFolderMatterRetag(['/wsA/Acme'], null, scheduler);
      // Recorded up front…
      expect(usePendingFolderRetagStore.getState().forWorkspace('/wsA')).toContain('/wsA/Acme');
      // …then the op succeeds and discharges it, so nothing survives to next open.
      await vi.runAllTimersAsync();
      expect(usePendingFolderRetagStore.getState().forWorkspace('/wsA')).toHaveLength(0);
      restoreFolderHolds('/wsA');
      expect(getExcludedMatterFolders()).toHaveLength(0);
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  const treeAcme = [
    {
      id: 'Acme',
      type: 'folder' as const,
      name: 'Acme',
      path: '/wsA/Acme',
      children: [
        { id: 'Acme/f', type: 'file' as const, name: 'f.docx', path: '/wsA/Acme/f.docx' },
      ],
    },
  ];

  it('a boot in-place retag FAILURE records the folder durably', async () => {
    useMatterStore.setState({
      matters: [matter({ id: 'M', folderPaths: ['/wsA/Acme'] })],
      activeMatterId: null,
    });
    useWorkspaceStore.setState({ rootPath: '/wsA', rootGeneration: 1, fileTree: treeAcme });
    vi.mocked(MemoryService.retagMatterBatch).mockRejectedValue(new Error('down'));

    await retagExistingMatterFolderPaths(null);

    // The failed folder is recorded durably so next open re-holds it synchronously.
    expect(usePendingFolderRetagStore.getState().forWorkspace('/wsA')).toContain('/wsA/Acme');
  });

  it('a clean boot in-place retag discharges a prior durable folder hold', async () => {
    // A durable hold survives from a prior session and is restored on open.
    usePendingFolderRetagStore.getState().hold('/wsA', ['/wsA/Acme']);
    restoreFolderHolds('/wsA');
    expect(getExcludedMatterFolders()).toContain('/wsA/Acme');

    useMatterStore.setState({
      matters: [matter({ id: 'M', folderPaths: ['/wsA/Acme'] })],
      activeMatterId: null,
    });
    useWorkspaceStore.setState({ rootPath: '/wsA', rootGeneration: 1, fileTree: treeAcme });
    vi.mocked(MemoryService.retagMatterBatch).mockResolvedValue([]); // clean, no misses

    await retagExistingMatterFolderPaths(null);

    // A clean boot re-tag discharges the durable record AND prunes the restored hold.
    expect(usePendingFolderRetagStore.getState().forWorkspace('/wsA')).toHaveLength(0);
    expect(getExcludedMatterFolders()).not.toContain('/wsA/Acme');
  });

  // R8 (P1) — supersession race across sessions. A folder is re-mapped, then
  // re-mapped AGAIN before the first re-tag lands. Op bodies run to completion
  // even once superseded (serialization only delays the NEXT op, it can't abort
  // an already-running one), so the OLDER op finishes LAST-ish and — keyed only
  // by folder path — used to clear the durable record the NEWER pending re-tag
  // just wrote. Close the app before the newer re-tag succeeds and reopen: NO
  // hold is restored, so stale wrong-client chunks are searchable across
  // sessions. The durable release must be tied to the generation that wrote it:
  // a stale generation's release is a no-op.
  it('an OLDER superseded re-tag does NOT clear the durable hold a NEWER pending re-tag wrote (cross-session fail-closed)', async () => {
    vi.useFakeTimers();
    try {
      useWorkspaceStore.setState({ rootPath: '/wsA', rootGeneration: 1, fileTree: treeAcme });
      let call = 0;
      vi.mocked(MemoryService.reindexPaths).mockImplementation(() => {
        call += 1;
        // Call 1 = the OLDER (gen1) op: re-indexes cleanly but is already
        // superseded. Call 2 = the NEWER (gen2) op: still in flight (never lands)
        // when the app closes.
        return call === 1 ? Promise.resolve(0) : new Promise<number>(() => {});
      });

      const scheduler = createRetagScheduler();
      // Same folder, same `matter:/wsA/Acme` id → the second run() supersedes the
      // first. Both record the folder durably up front.
      scheduleFolderMatterRetag(['/wsA/Acme'], null, scheduler); // gen1 (older)
      scheduleFolderMatterRetag(['/wsA/Acme'], null, scheduler); // gen2 (newer)
      expect(usePendingFolderRetagStore.getState().forWorkspace('/wsA')).toContain('/wsA/Acme');

      // Run the older op to completion (clean re-index) and start the newer op
      // (which hangs, in flight).
      await vi.runAllTimersAsync();

      // The older, superseded op must NOT have cleared the durable record — it
      // re-tagged to a STALE mapping; only the newest generation's op may clear.
      expect(usePendingFolderRetagStore.getState().forWorkspace('/wsA')).toContain('/wsA/Acme');

      // Close before the newer re-tag lands, then reopen: the hold MUST come back
      // (fail closed across sessions).
      scheduler.disposeAll();
      useScopeUpdateStore.getState().clearAll();
      expect(getExcludedMatterFolders()).toHaveLength(0);
      restoreFolderHolds('/wsA');
      expect(getExcludedMatterFolders()).toContain('/wsA/Acme');
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });
});

// ── F2 (R8) · the R7-6 mail hydration-suspect banner was DISHONEST: it claimed
//    "content is held out of search until it applies" but installed NO exclusion, so
//    nothing was actually held. It must fail closed for real — exclude EVERY mail hit
//    while the suspect hold exists — and clear only once the boot mail retag completes
//    cleanly for the workspace. ───────────────────────────────────────────────────
describe('mail hydration-suspect actually fails closed on ALL mail (F2, R8)', () => {
  const mailHit = { path: 'mail:m1', chunkText: '', score: 1, paragraphIndex: 0, sourceType: 'mail' as const, matterId: 'X', sourceId: 'mail:m1' };
  const fileHit = { path: '/wsA/doc.docx', chunkText: '', score: 1, paragraphIndex: 0, sourceType: 'docx' as const, sourceId: '/wsA/doc.docx' };
  beforeEach(() => {
    useScopeUpdateStore.getState().clearAll();
    useMatterStore.setState({ matters: [] });
    usePendingMailRetagStore.setState({ intents: {} });
    __resetPendingMailRetagHydrationSuspect();
    useWorkspaceStore.setState({ rootPath: '/wsA', rootGeneration: 1, fileTree: [] });
  });
  afterEach(() => {
    useScopeUpdateStore.getState().clearAll();
    useMatterStore.setState({ matters: [] });
    usePendingMailRetagStore.setState({ intents: {} });
    __resetPendingMailRetagHydrationSuspect();
    useWorkspaceStore.setState({ rootPath: null });
  });

  it('excludes EVERY mail hit while the suspect hold exists (word matches deed)', () => {
    // A corrupt/partial persisted blob dropped a malformed record → suspect.
    sanitizePersistedMailRetag({ intents: { bad: { staleMatters: 5 } } });
    useScopeUpdateStore.getState().clearAll();

    restoreMailHolds('/wsA');

    // The banner's promise is now real: a mail hit — under ANY matter — is dropped
    // from retrieval, not silently surfaced.
    expect(shouldExcludeHitFromRetrieval(mailHit)).toBe(true);
    // R8 hardening: an older/odd mail row that carries NO sourceType and NO sourceId,
    // identified only by a `mail:`-prefixed `path`, is still caught by the blanket hold.
    const legacyMailHit = { path: 'mail:legacy', chunkText: '', score: 1, paragraphIndex: 0 };
    expect(shouldExcludeHitFromRetrieval(legacyMailHit)).toBe(true);
    // …but FILE hits are unaffected by a MAIL-store suspicion.
    expect(shouldExcludeHitFromRetrieval(fileHit)).toBe(false);
  });

  it('releases the all-mail hold once the boot mail retag completes cleanly', async () => {
    sanitizePersistedMailRetag({ intents: { bad: { staleMatters: 5 } } });
    useScopeUpdateStore.getState().clearAll();
    restoreMailHolds('/wsA');
    expect(shouldExcludeHitFromRetrieval(mailHit)).toBe(true);

    // A mapped mail folder retags cleanly → every mapped tag reconverged → safe to
    // release the blanket hold for this session.
    useMatterStore.setState({ matters: [matter({ id: 'B', mailFolderPaths: ['m365/acct/Inbox'] })] });
    vi.mocked(mailRetagFolderMatter).mockResolvedValue(3);
    await retagExistingMailFolders();

    expect(shouldExcludeHitFromRetrieval(mailHit)).toBe(false);
  });

  it('keeps the all-mail hold when the boot mail retag FAILS (still fail closed)', async () => {
    sanitizePersistedMailRetag({ intents: { bad: { staleMatters: 5 } } });
    useScopeUpdateStore.getState().clearAll();
    restoreMailHolds('/wsA');

    useMatterStore.setState({ matters: [matter({ id: 'B', mailFolderPaths: ['m365/acct/Inbox'] })] });
    vi.mocked(mailRetagFolderMatter).mockRejectedValue(new Error('down'));
    await retagExistingMailFolders();

    // A failed retag means tags may still be stale — the blanket hold MUST survive.
    expect(shouldExcludeHitFromRetrieval(mailHit)).toBe(true);
  });
});

// ── F3 (R8) · the durable FOLDER store had NO corruption guard (the mail store got
//    one in R7-6). A corrupt/partial blob silently lost holds (fail open). It must
//    validate its hydrated shape AND — when suspect — fail closed on ALL files until
//    the boot in-place folder retag reconverges every mapped folder's tag. ─────────
describe('folder hydration-suspect fails closed on ALL files (F3, R8)', () => {
  const fileHit = { path: '/wsA/doc.docx', chunkText: '', score: 1, paragraphIndex: 0, sourceType: 'docx' as const, sourceId: '/wsA/doc.docx' };
  const mailHit = { path: 'mail:m1', chunkText: '', score: 1, paragraphIndex: 0, sourceType: 'mail' as const, matterId: 'X', sourceId: 'mail:m1' };
  const treeAcme = [
    {
      id: 'Acme',
      type: 'folder' as const,
      name: 'Acme',
      path: '/wsA/Acme',
      children: [
        { id: 'Acme/f', type: 'file' as const, name: 'f.docx', path: '/wsA/Acme/f.docx' },
      ],
    },
  ];
  beforeEach(() => {
    useScopeUpdateStore.getState().clearAll();
    usePendingFolderRetagStore.setState({ heldByWorkspace: {} });
    __resetPendingFolderRetagHydrationSuspect();
    useMatterStore.setState({ matters: [], activeMatterId: null });
    useWorkspaceStore.setState({ rootPath: '/wsA', rootGeneration: 1, fileTree: [] });
  });
  afterEach(() => {
    useScopeUpdateStore.getState().clearAll();
    usePendingFolderRetagStore.setState({ heldByWorkspace: {} });
    __resetPendingFolderRetagHydrationSuspect();
    useMatterStore.setState({ matters: [], activeMatterId: null });
    useWorkspaceStore.setState({ rootPath: null });
  });

  it('excludes EVERY file hit while the folder store is hydration-suspect', () => {
    // A corrupt/partial persisted blob dropped a malformed workspace entry → suspect.
    sanitizePersistedFolderRetag({ heldByWorkspace: { '/wsBad': 'not-an-array' } });
    useScopeUpdateStore.getState().clearAll();

    restoreFolderHolds('/wsA');

    // Every FILE hit is dropped (fail closed) — not just ones under a known folder…
    expect(shouldExcludeHitFromRetrieval(fileHit)).toBe(true);
    // …but MAIL hits are unaffected by a FOLDER-store suspicion.
    expect(shouldExcludeHitFromRetrieval(mailHit)).toBe(false);
  });

  it('releases the all-files hold once the boot folder retag completes cleanly', async () => {
    sanitizePersistedFolderRetag({ heldByWorkspace: { '/wsBad': 'not-an-array' } });
    useScopeUpdateStore.getState().clearAll();
    restoreFolderHolds('/wsA');
    expect(shouldExcludeHitFromRetrieval(fileHit)).toBe(true);

    // A mapped folder retags cleanly → every mapped tag reconverged → release.
    useMatterStore.setState({ matters: [matter({ id: 'M', folderPaths: ['/wsA/Acme'] })], activeMatterId: null });
    useWorkspaceStore.setState({ rootPath: '/wsA', rootGeneration: 1, fileTree: treeAcme });
    vi.mocked(MemoryService.retagMatterBatch).mockResolvedValue([]);
    await retagExistingMatterFolderPaths(null);

    expect(shouldExcludeHitFromRetrieval(fileHit)).toBe(false);
  });

  it('keeps the all-files hold when the boot folder retag FAILS (still fail closed)', async () => {
    sanitizePersistedFolderRetag({ heldByWorkspace: { '/wsBad': 'not-an-array' } });
    useScopeUpdateStore.getState().clearAll();
    restoreFolderHolds('/wsA');

    useMatterStore.setState({ matters: [matter({ id: 'M', folderPaths: ['/wsA/Acme'] })], activeMatterId: null });
    useWorkspaceStore.setState({ rootPath: '/wsA', rootGeneration: 1, fileTree: treeAcme });
    vi.mocked(MemoryService.retagMatterBatch).mockRejectedValue(new Error('down'));
    await retagExistingMatterFolderPaths(null);

    expect(shouldExcludeHitFromRetrieval(fileHit)).toBe(true);
  });
});

// ── F1 (R8) · a durable FILE-folder hold for a folder that was UNMAPPED/removed
//    while its retag was still pending strands FOREVER: the boot pass built its
//    folder list ONLY from currently-mapped folders, so it never retagged the
//    unmapped folder — `restoreFolderHolds` re-held it every open, nothing ever
//    discharged it. The boot pass must UNION the durable pending paths (mirror of
//    `retagExistingMailFolders`), retag each to its CURRENT matter (unmapped →
//    unassigned), and discharge the hold on success. ─────────────────────────────
describe('durable FILE-folder hold for an UNMAPPED folder is retagged + discharged on boot (F1, R8)', () => {
  const treeGamma = [
    {
      id: 'Gamma',
      type: 'folder' as const,
      name: 'Gamma',
      path: '/wsA/Gamma',
      children: [
        { id: 'Gamma/g', type: 'file' as const, name: 'g.docx', path: '/wsA/Gamma/g.docx' },
      ],
    },
  ];
  beforeEach(() => {
    useScopeUpdateStore.getState().clearAll();
    usePendingFolderRetagStore.setState({ heldByWorkspace: {} });
    useMatterStore.setState({ matters: [], activeMatterId: null });
    useWorkspaceStore.setState({ rootPath: '/wsA', rootGeneration: 1, fileTree: treeGamma });
  });
  afterEach(() => {
    useScopeUpdateStore.getState().clearAll();
    usePendingFolderRetagStore.setState({ heldByWorkspace: {} });
    useMatterStore.setState({ matters: [], activeMatterId: null });
    useWorkspaceStore.setState({ rootPath: null });
  });

  it('retags an unmapped-but-held folder to unassigned and discharges its durable hold', async () => {
    // A prior session left /wsA/Gamma held (a pending re-map), then the folder was
    // UNMAPPED — no matter maps it anymore.
    usePendingFolderRetagStore.getState().hold('/wsA', ['/wsA/Gamma']);
    restoreFolderHolds('/wsA');
    expect(getExcludedMatterFolders()).toContain('/wsA/Gamma');

    // Boot pass, no MAPPED folders at all. The clean retag lands.
    vi.mocked(MemoryService.retagMatterBatch).mockResolvedValue([]);
    await retagExistingMatterFolderPaths(null);

    // The held folder's file was retagged to its CURRENT matter (unassigned) — not
    // skipped just because no matter maps it anymore…
    expect(vi.mocked(MemoryService.retagMatterBatch)).toHaveBeenCalledWith(
      ['/wsA/Gamma/g.docx'],
      'unassigned',
    );
    // …and the durable hold + scope exclusion are discharged, so it isn't stranded.
    expect(usePendingFolderRetagStore.getState().forWorkspace('/wsA')).toHaveLength(0);
    expect(getExcludedMatterFolders()).not.toContain('/wsA/Gamma');
  });
});

// ── R7-4 · the boot passes snapshot their targets once but write over time; a
//    folder re-mapped mid-pass (the live scheduler already re-tagged it + cleared
//    its hold) must NOT get the stale snapshot matter written last. Both boot
//    passes re-resolve each target's CURRENT matter right before the write. ───────
describe('boot passes re-resolve targets at write time (R7-4)', () => {
  beforeEach(() => {
    useScopeUpdateStore.getState().clearAll();
    usePendingFolderRetagStore.setState({ heldByWorkspace: {} });
    usePendingMailRetagStore.setState({ intents: {} });
    useWorkspaceStore.setState({ rootPath: '/wsA', rootGeneration: 1, fileTree: [] });
  });
  afterEach(() => {
    useScopeUpdateStore.getState().clearAll();
    usePendingFolderRetagStore.setState({ heldByWorkspace: {} });
    usePendingMailRetagStore.setState({ intents: {} });
    useMatterStore.setState({ matters: [], activeMatterId: null });
    useWorkspaceStore.setState({ rootPath: null });
  });

  it('FILE boot pass skips a folder re-mapped mid-pass (no stale write)', async () => {
    useWorkspaceStore.setState({
      rootPath: '/wsA',
      rootGeneration: 1,
      fileTree: [
        {
          id: 'A',
          type: 'folder',
          name: 'A',
          path: '/wsA/A',
          children: [{ id: 'A/f', type: 'file', name: 'a.docx', path: '/wsA/A/a.docx' }],
        },
        {
          id: 'B',
          type: 'folder',
          name: 'B',
          path: '/wsA/B',
          children: [{ id: 'B/f', type: 'file', name: 'b.docx', path: '/wsA/B/b.docx' }],
        },
      ],
    });
    useMatterStore.setState({
      matters: [
        matter({ id: 'mA', folderPaths: ['/wsA/A'] }),
        matter({ id: 'mB', folderPaths: ['/wsA/B'] }),
      ],
      activeMatterId: null,
    });

    const written: string[] = [];
    vi.mocked(MemoryService.retagMatterBatch).mockImplementation((_paths, m) => {
      written.push(m);
      // While re-tagging folder A, the user unmaps folder B (b.docx stops
      // resolving to mB) — the classic mid-pass re-map.
      if (m === 'mA') {
        useMatterStore.setState({
          matters: [matter({ id: 'mA', folderPaths: ['/wsA/A'] }), matter({ id: 'mB', folderPaths: [] })],
        });
      }
      return Promise.resolve([]);
    });

    await retagExistingMatterFolderPaths(null);

    // mA's batch wrote; mB's batch was SKIPPED because b.docx no longer resolves to
    // mB — the stale mB tag was never re-written.
    expect(written).toContain('mA');
    expect(written).not.toContain('mB');
  });

  it('MAIL boot pass writes a re-mapped folder to its CURRENT matter, not the stale one', async () => {
    useMatterStore.setState({
      matters: [
        matter({ id: 'X', mailFolderPaths: ['m365/acct/Inbox'] }),
        matter({ id: 'Y', mailFolderPaths: ['m365/acct/Sent'] }),
      ],
    });

    const calls: Array<{ folder: string; matter: string }> = [];
    vi.mocked(mailRetagFolderMatter).mockImplementation((_p, _a, folder, m) => {
      calls.push({ folder, matter: m });
      if (folder === 'Inbox') {
        // While re-tagging Inbox, the user re-maps Sent from Y → Z.
        useMatterStore.setState({
          matters: [
            matter({ id: 'X', mailFolderPaths: ['m365/acct/Inbox'] }),
            matter({ id: 'Z', mailFolderPaths: ['m365/acct/Sent'] }),
          ],
        });
      }
      return Promise.resolve(1);
    });

    await retagExistingMailFolders();

    const sent = calls.find((c) => c.folder === 'Sent');
    expect(sent?.matter).toBe('Z'); // current matter, not the stale snapshot Y
  });
});

// ── R7-1 · the other half of the merge with origin's per-path-misses retag API:
//    a MISS returned by `retagMatterBatch` is a never-indexed file, NOT a failure,
//    so it is re-indexed — but if that RE-INDEX itself fails, the file may still
//    carry the OLD matter tag and MUST join the fail-closed hold (the auto-merge
//    dropped `reindexPaths`' failure count, which would have silently leaked). ────
describe('retagExistingMatterFolderPaths — a MISS that fails to re-index joins the fail-closed hold (R7-1)', () => {
  const treeWithMiss = [
    {
      id: 'Acme',
      type: 'folder' as const,
      name: 'Acme',
      path: '/wsA/Acme',
      children: [
        { id: 'Acme/f', type: 'file' as const, name: 'miss.docx', path: '/wsA/Acme/miss.docx' },
      ],
    },
  ];

  beforeEach(() => {
    useScopeUpdateStore.getState().clearAll();
    useMatterStore.setState({
      matters: [matter({ id: 'M', folderPaths: ['/wsA/Acme'] })],
      activeMatterId: null,
    });
    useWorkspaceStore.setState({ rootPath: '/wsA', rootGeneration: 1, fileTree: treeWithMiss });
    // The in-place batch reports the file as a per-path MISS (it never got rows).
    vi.mocked(MemoryService.retagMatterBatch).mockImplementation((paths: string[]) =>
      Promise.resolve(paths),
    );
  });
  afterEach(() => {
    useScopeUpdateStore.getState().clearAll();
    useWorkspaceStore.setState({ rootPath: null });
    useMatterStore.setState({ matters: [], activeMatterId: null });
  });

  it('holds a never-indexed miss out of retrieval when RE-INDEXING it also fails', async () => {
    // Re-indexing the miss FAILS (non-zero failure count).
    vi.mocked(MemoryService.reindexPaths).mockResolvedValue(1);

    await retagExistingMatterFolderPaths(null);

    const held = getExcludedMatterFolders();
    expect(held.some((p) => p.includes('miss.docx'))).toBe(true);
  });

  it('does NOT hold a miss that re-indexes cleanly', async () => {
    // Re-indexing the miss SUCCEEDS (0 failures) → now correctly tagged → NOT held.
    vi.mocked(MemoryService.reindexPaths).mockResolvedValue(0);

    await retagExistingMatterFolderPaths(null);

    expect(getExcludedMatterFolders()).toHaveLength(0);
  });
});
