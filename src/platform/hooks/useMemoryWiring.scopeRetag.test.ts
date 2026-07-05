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
    MemoryService: { ...original.MemoryService, retagPrivilege: vi.fn().mockResolvedValue(1) },
  };
});

import {
  scheduleFolderMatterRetag,
  scheduleMailMatterRetag,
  schedulePrivilegeRetag,
} from './useMemoryWiring';
import type { RetagScheduler, RetagTask } from '@/platform/rag/retagScheduler';
import { MemoryService } from '@/platform/rag/MemoryService';
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
  usePrivilegeStore.setState({ privilegeBySource: {}, includePrivileged: false });
});

afterEach(() => {
  usePrivilegeStore.setState({ privilegeBySource: {}, includePrivileged: false });
});

describe('scheduleFolderMatterRetag', () => {
  it('schedules a fail-closed matter task that excludes the changed folders', () => {
    const { scheduler, tasks } = recordingScheduler();

    scheduleFolderMatterRetag(['/ws/Beta', '/ws/Acme'], null, scheduler);

    const task = onlyTask(tasks);
    expect(task.kind).toBe('matter');
    // Id is order-independent (sorted) so the same change dedupes to one entry.
    expect(task.id).toBe('matter:/ws/Acme|/ws/Beta');
    expect(task.excludeFolders).toEqual(['/ws/Beta', '/ws/Acme']);
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
