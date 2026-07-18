import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type { Matter } from '@/platform/types/matter';
import type { FileNode } from '@/platform/types/workspace';

const boundary = vi.hoisted(() => ({
  committedRecords: [] as LiveCrmRecord[],
  writerEcho: undefined as LiveCrmRecord | undefined,
  invoke:
    vi.fn<
      (command: string, args?: { record?: LiveCrmRecord }) => Promise<unknown>
    >(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (command: string, args?: { record?: LiveCrmRecord }) =>
    boundary.invoke(command, args),
}));
vi.mock('@/platform/utils/wealthbox-commands', () => ({
  crmSetWorkspace: () => Promise.resolve(),
}));
vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: <T,>(selector: (state: { rootPath: string }) => T) =>
    selector({ rootPath: '/workspace' }),
}));
vi.mock('@/platform/client-context', () => ({
  useSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
  readSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
}));
vi.mock('@/platform/matter/matterStore', () => ({
  useMatterStore: <T,>(
    selector: (state: { matters: []; activeMatterId: null }) => T
  ) => selector({ matters: [], activeMatterId: null }),
}));
vi.mock('@/platform/crm/store', () => ({
  getCrmEngineFreshness: () => ({ kind: 'idle' }),
  subscribeCrmEngineFreshness: () => () => undefined,
}));
vi.mock('@/platform/crm/liveRecordRelay', () => ({
  clearLiveRecordRelay: vi.fn(),
  ensureLiveRecordRelay: vi.fn(() => Promise.resolve(null)),
  removeLiveRecordRelayWriter: vi.fn(),
  publishLiveRecord: vi.fn(),
}));

import { useTaskRecordStore } from '@/features/crm-tasks';
import {
  attachWorkspaceDocumentToTask,
  detachWorkspaceDocumentFromTask,
} from './persistence';

const fileTree: readonly FileNode[] = [
  {
    id: 'clients',
    name: 'Clients',
    path: '/workspace/Clients',
    type: 'folder',
    children: [
      {
        id: 'review',
        name: 'review.docx',
        path: '/workspace/Clients/River/review.docx',
        type: 'file',
      },
    ],
  },
];

const matters: readonly Matter[] = [
  {
    id: 'matter-river',
    name: 'River',
    client: 'River',
    folderPaths: ['/workspace/Clients/River'],
    createdAt: '2026-01-01T00:00:00Z',
  },
];

function taskRecord(): LiveCrmRecord {
  return {
    id: 'task-1',
    kind: 'task',
    matterId: 'firm_home',
    title: 'Prepare annual review',
    body: 'Keep this body.',
    householdRef: {
      kind: 'household',
      id: 'household-river',
      matterId: 'matter-river',
    },
    assigneeUserId: 'advisor-1',
    status: 'open',
    priority: 'high',
    category: 'Annual review',
    dueTime: '09:30',
    tagIds: ['tag:review'],
    contextRefs: [
      {
        kind: 'household',
        id: 'household-river',
        matterId: 'matter-river',
      },
    ],
    connectorOwned: 'keep me',
  };
}

function expectSaveThenReload(): void {
  const commands = boundary.invoke.mock.calls.map(([command]) => command);
  const save = commands.indexOf('crm_live_upsert');
  expect(save).toBeGreaterThanOrEqual(0);
  expect(commands.slice(save + 1)).toContain('crm_live_list');
}

describe('task attachment canonical store reload proof', () => {
  beforeEach(() => {
    boundary.committedRecords = [taskRecord()];
    boundary.writerEcho = undefined;
    boundary.invoke.mockReset();
    boundary.invoke.mockImplementation((command, args) => {
      if (command === 'crm_live_list') {
        return Promise.resolve(structuredClone(boundary.committedRecords));
      }
      if (command === 'crm_live_upsert' && args?.record) {
        const saved = structuredClone(args.record);
        boundary.writerEcho = saved;
        boundary.committedRecords = boundary.committedRecords.map((record) =>
          record.id === saved.id ? saved : record
        );
        return Promise.resolve(structuredClone(saved));
      }
      return Promise.reject(new Error(`Unexpected command ${command}`));
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('survives fresh store state after add and remove while retaining task data', async () => {
    const sourceBefore = structuredClone(fileTree);
    const writer = renderHook(() => useTaskRecordStore());
    await waitFor(async () => {
      await expect(writer.result.current.get('task-1')).resolves.toBeDefined();
    });
    boundary.invoke.mockClear();

    await act(async () => {
      await attachWorkspaceDocumentToTask(writer.result.current, {
        taskId: 'task-1',
        targetHouseholdId: 'household-river',
        targetMatterId: 'matter-river',
        path: '/workspace/Clients/River/review.docx',
        workspaceRoot: '/workspace',
        fileTree,
        matters,
      });
    });
    expectSaveThenReload();
    writer.unmount();
    boundary.writerEcho = undefined;

    const reopened = renderHook(() => useTaskRecordStore());
    await waitFor(async () => {
      await expect(
        reopened.result.current.get('task-1')
      ).resolves.toMatchObject({
        category: 'Annual review',
        dueTime: '09:30',
        tagIds: ['tag:review'],
        contextRefs: [
          {
            kind: 'household',
            id: 'household-river',
            matterId: 'matter-river',
          },
          {
            kind: 'document',
            id: 'Clients/River/review.docx',
            matterId: 'matter-river',
          },
        ],
      });
    });
    expect(boundary.writerEcho).toBeUndefined();
    const persistedAfterAdd = boundary.committedRecords[0];
    expect(persistedAfterAdd?.['connectorOwned']).toBe('keep me');
    expect(persistedAfterAdd?.['contextRefs']).toEqual(
      expect.arrayContaining([
        {
          kind: 'household',
          id: 'household-river',
          matterId: 'matter-river',
        },
      ])
    );
    boundary.invoke.mockClear();

    await act(async () => {
      await detachWorkspaceDocumentFromTask(
        reopened.result.current,
        'task-1',
        'Clients/River/review.docx',
        {
          targetHouseholdId: 'household-river',
          targetMatterId: 'matter-river',
        }
      );
    });
    expectSaveThenReload();
    reopened.unmount();
    boundary.writerEcho = undefined;

    const removedReopen = renderHook(() => useTaskRecordStore());
    await waitFor(async () => {
      await expect(
        removedReopen.result.current.get('task-1')
      ).resolves.toMatchObject({
        category: 'Annual review',
        dueTime: '09:30',
        tagIds: ['tag:review'],
        contextRefs: [
          {
            kind: 'household',
            id: 'household-river',
            matterId: 'matter-river',
          },
        ],
      });
    });
    expect(boundary.committedRecords[0]).toMatchObject({
      connectorOwned: 'keep me',
      contextRefs: [
        {
          kind: 'household',
          id: 'household-river',
          matterId: 'matter-river',
        },
      ],
    });
    expect(fileTree).toEqual(sourceBefore);
    removedReopen.unmount();
  });
});
