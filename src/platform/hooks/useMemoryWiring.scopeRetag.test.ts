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
  restoreMailHolds,
  retagExistingMailFolders,
  retagExistingMatterFolderPaths,
  scheduleFolderMatterRetag,
  scheduleMailMatterRetag,
  schedulePrivilegeRetag,
} from './useMemoryWiring';
import { useMatterStore } from '@/platform/matter/matterStore';
import { usePendingMailRetagStore } from '@/platform/rag/pendingMailRetagStore';
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

    await task.op();
    expect(vi.mocked(mailRetagFolderMatter)).toHaveBeenCalledWith('m365', 'acct', 'Inbox', 'm1');
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

    await task.op();
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

  it('re-tags every mapped mail folder to its CURRENT matter on boot', async () => {
    useMatterStore.setState({
      matters: [matter({ id: 'B', mailFolderPaths: ['m365/acct/Inbox'] })],
    });
    vi.mocked(mailRetagFolderMatter).mockResolvedValue(3);

    await retagExistingMailFolders();

    expect(vi.mocked(mailRetagFolderMatter)).toHaveBeenCalledWith('m365', 'acct', 'Inbox', 'B');
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
    expect(vi.mocked(mailRetagFolderMatter)).toHaveBeenCalledWith('m365', 'acct', 'Inbox', 'unassigned');
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
