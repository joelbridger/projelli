import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FirmTagStore } from '@/features/crm-tags';
import type { TaskRecord, TaskRecordStore } from '@/features/crm-tasks';
import type { FileNode } from '@/platform/types/workspace';
import type { PlatformFlagsMockState } from '@/testing/platform-flags';

const { mockPlatformFlags, resetPlatformFlagsOverrides, setPlatformFlagsOverrides } =
  await vi.hoisted(async () => import('@/testing/platform-flags'));

const boundary = vi.hoisted(() => ({
  enabled: false,
  fileTree: [] as FileNode[],
  taskRecord: undefined as TaskRecord | undefined,
  useTaskRecordStore: vi.fn<() => TaskRecordStore>(),
  useFirmTagStore: vi.fn<() => FirmTagStore>(),
  workspaceReads: 0,
  matterReads: 0,
}));
const flagsMock = vi.hoisted(() => ({
  overrides: { useFlag: undefined } as PlatformFlagsMockState['overrides'],
}));

vi.mock('@/platform/flags', async (importOriginal) =>
  mockPlatformFlags(importOriginal, flagsMock)
);
vi.mock('@/features/crm-tasks', () => ({
  useTaskRecordStore: () => boundary.useTaskRecordStore(),
}));
vi.mock('@/features/crm-tags', () => ({
  useFirmTagStore: () => boundary.useFirmTagStore(),
}));
vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: <T,>(
    selector: (state: { rootPath: string; fileTree: FileNode[] }) => T
  ) => {
    boundary.workspaceReads += 1;
    return selector({ rootPath: '/workspace', fileTree: boundary.fileTree });
  },
}));
vi.mock('@/platform/matter/matterStore', () => ({
  useMatterStore: <T,>(
    selector: (state: {
      matters: Array<{
        id: string;
        name: string;
        client: string;
        folderPaths: string[];
        createdAt: string;
      }>;
    }) => T
  ) => {
    boundary.matterReads += 1;
    return selector({
      matters: [
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
      ],
    });
  },
}));

import { TaskAttachmentsField } from './TaskAttachmentsField';

const updateTask = vi.fn<TaskRecordStore['update']>();
const getTask = vi.fn<TaskRecordStore['get']>();
const updateDraft = vi.fn();
const setPersistenceBusy = vi.fn();

const context = {
  task: {
    id: 'task-1',
    title: 'Review plan',
    assigneeUserId: null,
    status: 'open' as const,
    priority: 'normal' as const,
    tagIds: ['tag:planning'],
    householdId: 'household-river',
    householdLabel: 'River household',
    contextRefs: ['household-river'],
    documentRefs: [],
  },
  updateTask: updateDraft,
  setPersistenceBusy,
  households: [
    {
      id: 'household-river',
      name: 'River household',
      matterId: 'matter-river',
    },
  ],
};

function taggedTask(): TaskRecord {
  return {
    id: 'task-1',
    title: 'Review plan',
    body: 'Keep this body.',
    householdRef: {
      kind: 'household',
      id: 'household-river',
      matterId: 'matter-river',
    },
    assigneeUserId: null,
    status: 'open',
    dueTime: '09:30',
    priority: 'normal',
    category: 'Planning',
    tagIds: ['tag:planning'],
    contextRefs: [],
  };
}

describe('TaskAttachmentsField', () => {
  beforeEach(() => {
    resetPlatformFlagsOverrides(flagsMock);
    setPlatformFlagsOverrides(flagsMock, { useFlag: () => boundary.enabled });
    boundary.enabled = false;
    boundary.taskRecord = taggedTask();
    boundary.fileTree = [
      {
        id: 'clients',
        name: 'Clients',
        path: '/workspace/Clients',
        type: 'folder',
        children: [
          {
            id: 'file-1',
            name: 'Plan.pdf',
            path: '/workspace/Clients/River/Plan.pdf',
            type: 'file',
          },
          {
            id: 'file-2',
            name: 'Private Lake.pdf',
            path: '/workspace/Clients/Lake/Private Lake.pdf',
            type: 'file',
          },
          {
            id: 'file-3',
            name: 'raw.bin',
            path: '/workspace/Clients/River/raw.bin',
            type: 'file',
          },
        ],
      },
    ];
    boundary.useTaskRecordStore.mockReset();
    boundary.useFirmTagStore.mockReset();
    boundary.workspaceReads = 0;
    boundary.matterReads = 0;
    updateTask.mockReset();
    getTask.mockReset();
    updateDraft.mockReset();
    setPersistenceBusy.mockReset();
    getTask.mockImplementation(() => Promise.resolve(boundary.taskRecord));
    updateTask.mockImplementation((_id, patch) => {
      const current = boundary.taskRecord;
      if (!current) return Promise.reject(new Error('missing task'));
      const next: TaskRecord = {
        ...current,
        householdRef: patch.householdRef ?? current.householdRef,
        contextRefs: patch.contextRefs ?? current.contextRefs,
      };
      boundary.taskRecord = next;
      return Promise.resolve(next);
    });
    const store: TaskRecordStore = {
      get: getTask,
      create: vi.fn(),
      update: updateTask,
      remove: vi.fn(),
    };
    boundary.useTaskRecordStore.mockReturnValue(store);
    boundary.useFirmTagStore.mockReturnValue({
      catalog: {
        version: 1,
        tags: [
          {
            id: 'tag:planning',
            name: 'Planning',
            color: '#2563eb',
            status: 'active',
          },
        ],
      },
      list: () =>
        Promise.resolve({
          version: 1,
          tags: [
            {
              id: 'tag:planning',
              name: 'Planning',
              color: '#2563eb',
              status: 'active',
            },
          ],
        }),
      errorCode: null,
      create: () => Promise.reject(new Error('not used in this test')),
      rename: () => Promise.reject(new Error('not used in this test')),
      setColor: () => Promise.reject(new Error('not used in this test')),
      retire: () => Promise.reject(new Error('not used in this test')),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('does not load file, matter, task, or tag data while the flag is off', () => {
    const { container } = render(<TaskAttachmentsField {...context} />);

    expect(container).toBeEmptyDOMElement();
    expect(boundary.workspaceReads).toBe(0);
    expect(boundary.matterReads).toBe(0);
    expect(boundary.useTaskRecordStore).not.toHaveBeenCalled();
    expect(boundary.useFirmTagStore).not.toHaveBeenCalled();
  });

  it('uses public task, document, and tag doorways and stores a portable pointer', async () => {
    boundary.enabled = true;
    const before = structuredClone(boundary.fileTree);
    render(<TaskAttachmentsField {...context} />);

    expect(
      await screen.findByTestId('crm-task-attachment-tag-tag:planning')
    ).toHaveTextContent('Planning');
    await waitFor(() => {
      expect(screen.getByTestId('crm-task-attachment-add')).not.toBeDisabled();
    });
    fireEvent.change(screen.getByTestId('crm-task-attachment-file'), {
      target: { value: '/workspace/Clients/River/Plan.pdf' },
    });
    fireEvent.click(screen.getByTestId('crm-task-attachment-add'));
    expect(setPersistenceBusy).toHaveBeenCalledWith(true);

    await screen.findByTestId('crm-task-attachment-Clients/River/Plan.pdf');
    expect(updateTask).toHaveBeenCalledWith('task-1', {
      householdRef: {
        kind: 'household',
        id: 'household-river',
        matterId: 'matter-river',
      },
      contextRefs: [
        {
          kind: 'document',
          id: 'Clients/River/Plan.pdf',
          label: 'Plan.pdf',
          matterId: 'matter-river',
        },
      ],
    });
    expect(boundary.taskRecord).toMatchObject({
      tagIds: ['tag:planning'],
      category: 'Planning',
      dueTime: '09:30',
    });
    expect(boundary.fileTree).toEqual(before);
  });

  it("shows only supported documents owned by the task's client", async () => {
    boundary.enabled = true;
    render(<TaskAttachmentsField {...context} />);

    const selector = await screen.findByTestId('crm-task-attachment-file');
    expect(selector).toHaveTextContent('Plan.pdf');
    expect(selector).not.toHaveTextContent('Private Lake.pdf');
    expect(selector).not.toHaveTextContent('raw.bin');
  });

  it('does not guess a client matter from a matching display name', async () => {
    boundary.enabled = true;
    render(
      <TaskAttachmentsField
        {...context}
        task={{
          ...context.task,
          householdId: 'household-without-matter',
          householdLabel: 'River',
          contextRefs: ['household-without-matter'],
        }}
        households={[{ id: 'household-without-matter', name: 'River' }]}
      />
    );

    const selector = await screen.findByTestId('crm-task-attachment-file');
    expect(selector).toBeDisabled();
    expect(selector).not.toHaveTextContent('Plan.pdf');
  });

  it('preserves newer draft edits while an attachment save finishes', async () => {
    boundary.enabled = true;
    const ref = {
      kind: 'document' as const,
      id: 'Clients/River/Plan.pdf',
      label: 'Plan.pdf',
      matterId: 'matter-river',
    };
    let finishUpdate: ((task: TaskRecord) => void) | undefined;
    updateTask.mockImplementationOnce(
      () =>
        new Promise<TaskRecord>((resolve) => {
          finishUpdate = resolve;
        })
    );
    const { rerender } = render(<TaskAttachmentsField {...context} />);
    await waitFor(() => {
      expect(screen.getByTestId('crm-task-attachment-add')).not.toBeDisabled();
    });
    fireEvent.change(screen.getByTestId('crm-task-attachment-file'), {
      target: { value: '/workspace/Clients/River/Plan.pdf' },
    });
    fireEvent.click(screen.getByTestId('crm-task-attachment-add'));
    expect(updateDraft).toHaveBeenCalledWith(
      expect.objectContaining({ documentRefs: [ref] })
    );
    await waitFor(() => {
      expect(updateTask).toHaveBeenCalledTimes(1);
    });

    rerender(
      <TaskAttachmentsField
        {...context}
        task={{ ...context.task, title: 'Newest unsaved title' }}
      />
    );
    act(() => {
      finishUpdate?.({ ...taggedTask(), contextRefs: [ref] });
    });

    await waitFor(() => {
      expect(setPersistenceBusy).toHaveBeenLastCalledWith(false);
      expect(updateDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Newest unsaved title',
          documentRefs: [ref],
        })
      );
    });
  });

  it('shows duplicate refusal without another task update', async () => {
    boundary.enabled = true;
    const ref = {
      kind: 'document' as const,
      id: 'Clients/River/Plan.pdf',
      label: 'Plan.pdf',
      matterId: 'matter-river',
    };
    boundary.taskRecord = { ...taggedTask(), contextRefs: [ref] };
    const task = { ...context.task, documentRefs: [ref] };
    render(<TaskAttachmentsField {...context} task={task} />);

    await waitFor(() => {
      expect(screen.getByTestId('crm-task-attachment-add')).not.toBeDisabled();
    });
    fireEvent.change(screen.getByTestId('crm-task-attachment-file'), {
      target: { value: '/workspace/Clients/River/Plan.pdf' },
    });
    fireEvent.click(screen.getByTestId('crm-task-attachment-add'));

    await screen.findByText('That document is already attached.');
    await waitFor(() => {
      expect(updateTask).not.toHaveBeenCalled();
    });
  });

  it('keeps documents with their original client until they are removed', async () => {
    boundary.enabled = true;
    const ref = {
      kind: 'document' as const,
      id: 'Clients/River/Plan.pdf',
      label: 'Plan.pdf',
      matterId: 'matter-river',
    };
    boundary.taskRecord = { ...taggedTask(), contextRefs: [ref] };
    const { rerender } = render(
      <TaskAttachmentsField
        {...context}
        task={{ ...context.task, documentRefs: [ref] }}
      />
    );

    rerender(
      <TaskAttachmentsField
        {...context}
        task={{
          ...context.task,
          householdId: 'household-lake',
          householdLabel: 'Lake household',
          contextRefs: ['household-lake'],
          documentRefs: [ref],
        }}
      />
    );

    await waitFor(() => {
      expect(updateDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          householdId: 'household-river',
          householdLabel: 'River household',
          documentRefs: [ref],
        })
      );
    });
    expect(
      await screen.findByText(
        "Remove its attachments before changing this task's client."
      )
    ).toBeInTheDocument();
  });

  it('preserves a newer client choice after the final attachment is removed', async () => {
    boundary.enabled = true;
    const ref = {
      kind: 'document' as const,
      id: 'Clients/River/Plan.pdf',
      label: 'Plan.pdf',
      matterId: 'matter-river',
    };
    boundary.taskRecord = { ...taggedTask(), contextRefs: [ref] };
    let finishUpdate: ((task: TaskRecord) => void) | undefined;
    updateTask.mockImplementationOnce(
      () =>
        new Promise<TaskRecord>((resolve) => {
          finishUpdate = resolve;
        })
    );
    const { rerender } = render(
      <TaskAttachmentsField
        {...context}
        task={{ ...context.task, documentRefs: [ref] }}
      />
    );
    await waitFor(() => {
      expect(
        screen.getByTestId(
          'crm-task-attachment-remove-Clients/River/Plan.pdf'
        )
      ).not.toBeDisabled();
    });
    fireEvent.click(
      screen.getByTestId('crm-task-attachment-remove-Clients/River/Plan.pdf')
    );
    await waitFor(() => {
      expect(updateTask).toHaveBeenCalledTimes(1);
    });

    const lakeDraft = {
      ...context.task,
      householdId: 'household-lake',
      householdLabel: 'Lake household',
      contextRefs: ['household-lake'],
      documentRefs: [],
    };
    rerender(<TaskAttachmentsField {...context} task={lakeDraft} />);
    act(() => {
      finishUpdate?.({ ...taggedTask(), contextRefs: [] });
    });

    await waitFor(() => {
      expect(updateDraft).toHaveBeenLastCalledWith(
        expect.objectContaining({
          householdId: 'household-lake',
          householdLabel: 'Lake household',
          contextRefs: ['household-lake'],
          documentRefs: [],
        })
      );
    });
  });

  it('disables the field until a new task exists in the canonical store', async () => {
    boundary.enabled = true;
    boundary.taskRecord = undefined;
    render(
      <TaskAttachmentsField
        {...context}
        task={{ ...context.task, id: 'new-task-1' }}
      />
    );

    expect(
      await screen.findByTestId('crm-task-attachments-save-first')
    ).toHaveTextContent('Save this client task before adding documents.');
    expect(screen.getByTestId('crm-task-attachment-file')).toBeDisabled();
    expect(screen.getByTestId('crm-task-attachment-add')).toBeDisabled();
    expect(updateTask).not.toHaveBeenCalled();
  });

  it('rechecks an initially empty store and enables an existing task after hydration', async () => {
    boundary.enabled = true;
    getTask.mockResolvedValueOnce(undefined).mockResolvedValue(taggedTask());

    render(<TaskAttachmentsField {...context} />);

    await screen.findByTestId('crm-task-attachments-save-first');
    await waitFor(() => {
      expect(screen.getByTestId('crm-task-attachment-add')).not.toBeDisabled();
    });
    expect(getTask).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByTestId('crm-task-attachments-save-first')
    ).not.toBeInTheDocument();
  });

  it('stops checking when an unsaved task never appears', async () => {
    vi.useFakeTimers();
    boundary.enabled = true;
    boundary.taskRecord = undefined;
    render(
      <TaskAttachmentsField
        {...context}
        task={{ ...context.task, id: 'new-task-never-saved' }}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(getTask).toHaveBeenCalledTimes(7);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(getTask).toHaveBeenCalledTimes(7);
  });
});
