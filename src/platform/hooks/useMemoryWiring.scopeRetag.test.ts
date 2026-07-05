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
    },
  };
});

import {
  scheduleFolderMatterRetag,
  scheduleMailMatterRetag,
  schedulePrivilegeRetag,
} from './useMemoryWiring';
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
    // eslint-disable-next-line @typescript-eslint/unbound-method
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

    // eslint-disable-next-line @typescript-eslint/unbound-method
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
