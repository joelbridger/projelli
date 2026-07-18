import { describe, expect, it, vi } from 'vitest';
import { WorkspaceDocumentRefError } from '@/features/crm-documents';
import type { TaskRecord, TaskRecordStore } from '@/features/crm-tasks';
import type { Matter } from '@/platform/types/matter';
import type { FileNode } from '@/platform/types/workspace';
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
      {
        id: 'summary',
        name: 'summary.pdf',
        path: '/workspace/Clients/River/summary.pdf',
        type: 'file',
      },
      {
        id: 'installer',
        name: 'installer.exe',
        path: '/workspace/Clients/River/installer.exe',
        type: 'file',
      },
      {
        id: 'other',
        name: 'plan.pdf',
        path: '/workspace/Clients/Lake/plan.pdf',
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
  {
    id: 'matter-lake',
    name: 'Lake',
    client: 'Lake',
    folderPaths: ['/workspace/Clients/Lake'],
    createdAt: '2026-01-01T00:00:00Z',
  },
];

function task(contextRefs: TaskRecord['contextRefs'] = []): TaskRecord {
  return {
    id: 'task-1',
    title: 'Review plan',
    body: 'Keep this body.',
    householdRef: {
      kind: 'household',
      id: 'household-river',
      matterId: 'matter-river',
    },
    assigneeUserId: 'advisor-1',
    status: 'open',
    dueTime: '09:30',
    priority: 'high',
    category: 'Planning',
    tagIds: ['tag:planning'],
    contextRefs,
  };
}

function storeFor(record: TaskRecord): TaskRecordStore & {
  update: ReturnType<typeof vi.fn<TaskRecordStore['update']>>;
} {
  const update = vi.fn<TaskRecordStore['update']>((_id, patch) =>
    Promise.resolve({
      ...record,
      householdRef: patch.householdRef ?? record.householdRef,
      contextRefs: patch.contextRefs ?? record.contextRefs,
    })
  );
  return {
    get: vi.fn(() => Promise.resolve(record)),
    create: vi.fn(),
    update,
    remove: vi.fn(),
  };
}

const input = {
  taskId: 'task-1',
  targetHouseholdId: 'household-river',
  targetMatterId: 'matter-river',
  workspaceRoot: '/workspace',
  fileTree,
  matters,
};

describe('task attachment foundation adapter', () => {
  it.each([
    ['malformed', '', 'malformed'],
    ['outside workspace', '/outside/review.docx', 'unsafe_path'],
    ['traversal', '../River/review.docx', 'unsafe_path'],
    ['absent', '/workspace/Clients/River/missing.docx', 'not_found'],
    ['unsupported', '/workspace/Clients/River/installer.exe', 'unsupported'],
    ['wrong matter', '/workspace/Clients/Lake/plan.pdf', 'wrong_matter'],
  ] as const)(
    'refuses a %s file without saving or changing the tree',
    async (_label, path, code) => {
      const before = structuredClone(fileTree);
      const store = storeFor(task());

      await expect(
        attachWorkspaceDocumentToTask(store, { ...input, path })
      ).rejects.toEqual(
        expect.objectContaining<Partial<WorkspaceDocumentRefError>>({ code })
      );

      expect(store.update).not.toHaveBeenCalled();
      expect(fileTree).toEqual(before);
    }
  );

  it('rejects a duplicate portable pointer without saving', async () => {
    const existing = {
      kind: 'document' as const,
      id: 'Clients/River/review.docx',
      label: 'review.docx',
      matterId: 'matter-river',
    };
    const store = storeFor(task([existing]));

    await expect(
      attachWorkspaceDocumentToTask(store, {
        ...input,
        path: '/workspace/Clients/River/review.docx',
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkspaceDocumentRefError>>({
        code: 'duplicate',
      })
    );
    expect(store.update).not.toHaveBeenCalled();
  });

  it('stores only a validated workspace-relative document pointer', async () => {
    const before = structuredClone(fileTree);
    const store = storeFor(task());

    await expect(
      attachWorkspaceDocumentToTask(store, {
        ...input,
        path: '/workspace/Clients/River/review.docx',
      })
    ).resolves.toMatchObject({
      contextRefs: [
        {
          kind: 'document',
          id: 'Clients/River/review.docx',
          label: 'review.docx',
          matterId: 'matter-river',
        },
      ],
      tagIds: ['tag:planning'],
      category: 'Planning',
      dueTime: '09:30',
    });
    expect(store.update).toHaveBeenCalledWith('task-1', {
      householdRef: {
        kind: 'household',
        id: 'household-river',
        matterId: 'matter-river',
      },
      contextRefs: [
        {
          kind: 'document',
          id: 'Clients/River/review.docx',
          label: 'review.docx',
          matterId: 'matter-river',
        },
      ],
    });
    expect(fileTree).toEqual(before);
  });

  it('removes only the requested pointer through the task update operation', async () => {
    const review = {
      kind: 'document' as const,
      id: 'Clients/River/review.docx',
      label: 'review.docx',
      matterId: 'matter-river',
    };
    const summary = {
      kind: 'document' as const,
      id: 'Clients/River/summary.pdf',
      label: 'summary.pdf',
      matterId: 'matter-river',
    };
    const store = storeFor(task([review, summary]));

    await detachWorkspaceDocumentFromTask(
      store,
      'task-1',
      'Clients/River/review.docx',
      {
        targetHouseholdId: 'household-river',
        targetMatterId: 'matter-river',
      }
    );

    expect(store.update).toHaveBeenCalledWith('task-1', {
      householdRef: {
        kind: 'household',
        id: 'household-river',
        matterId: 'matter-river',
      },
      contextRefs: [summary],
    });
  });

  it('refuses to attach against an unsaved client change', async () => {
    const store = storeFor(task());

    await expect(
      attachWorkspaceDocumentToTask(store, {
        ...input,
        targetHouseholdId: 'household-lake',
        targetMatterId: 'matter-lake',
        path: '/workspace/Clients/Lake/plan.pdf',
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkspaceDocumentRefError>>({
        code: 'wrong_matter',
      })
    );
    expect(store.update).not.toHaveBeenCalled();
  });

  it('refuses a different matter even when the household ID is unchanged', async () => {
    const store = storeFor(task());

    await expect(
      attachWorkspaceDocumentToTask(store, {
        ...input,
        targetMatterId: 'matter-lake',
        path: '/workspace/Clients/Lake/plan.pdf',
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkspaceDocumentRefError>>({
        code: 'wrong_matter',
      })
    );
    expect(store.update).not.toHaveBeenCalled();
  });
});
