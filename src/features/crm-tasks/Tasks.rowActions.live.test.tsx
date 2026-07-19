import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type { TrashedCrmRecord } from '@/features/crm-trash';
import type { PlatformFlagsMockState } from '@/testing/platform-flags';

const {
  mockPlatformFlags,
  resetPlatformFlagsOverrides,
  setPlatformFlagsOverrides,
} = await vi.hoisted(async () => import('@/testing/platform-flags'));

const canonical = vi.hoisted(() => ({
  records: [] as LiveCrmRecord[],
  trash: [] as TrashedCrmRecord[],
  commands: [] as string[],
  invoke:
    vi.fn<
      (command: string, args?: Record<string, unknown>) => Promise<unknown>
    >(),
}));
const flagsMock = vi.hoisted(() => ({
  overrides: { isEnabled: undefined } as PlatformFlagsMockState['overrides'],
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (command: string, args?: Record<string, unknown>) =>
    canonical.invoke(command, args),
}));
vi.mock('@/platform/flags', async (importOriginal) =>
  mockPlatformFlags(importOriginal, flagsMock)
);
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

import { CrmHome } from '@/features/crm-home/CrmHome';

const sourceTask: LiveCrmRecord = {
  id: 'task-source',
  kind: 'task',
  matterId: 'firm_home',
  createdAt: '2026-07-18T10:00:00.000Z',
  createdBy: { userId: 'advisor-1', display: 'Advisor', kind: 'user' },
  updatedAt: '2026-07-18T10:00:00.000Z',
  updatedBy: { userId: 'advisor-1', display: 'Advisor', kind: 'user' },
  source: { origin: 'user', sources: [] },
  deleted: false,
  externalRefs: [],
  schemaVersion: 1,
  title: 'Prepare annual review',
  body: 'Use the signed plan.',
  householdRef: {
    kind: 'household',
    id: 'household-1',
    matterId: 'matter-1',
    label: 'Morgan household',
  },
  assigneeUserId: null,
  status: 'done',
  due: '2026-08-03',
  dueTime: '09:30',
  recurrence: {
    freq: 'yearly',
    interval: 1,
    regenerateOnComplete: true,
  },
  priority: 'high',
  category: 'Annual review',
  tagIds: ['tag:review'],
  contextRefs: [
    {
      kind: 'document',
      id: 'Clients/Morgan/plan.docx',
      matterId: 'matter-1',
      label: 'Signed plan',
    },
  ],
  customFields: {},
};

describe('task row actions through canonical persistence', () => {
  beforeEach(() => {
    resetPlatformFlagsOverrides(flagsMock);
    setPlatformFlagsOverrides(flagsMock, { isEnabled: () => true });
    canonical.records = [structuredClone(sourceTask)];
    canonical.trash = [];
    canonical.commands = [];
    canonical.invoke.mockReset();
    canonical.invoke.mockImplementation((command, args) => {
      canonical.commands.push(command);
      if (command === 'crm_live_list') {
        return Promise.resolve(structuredClone(canonical.records));
      }
      if (command === 'crm_live_upsert') {
        const record = structuredClone(args?.['record']) as LiveCrmRecord;
        canonical.records = canonical.records.some(
          (candidate) => candidate.id === record.id
        )
          ? canonical.records.map((candidate) =>
              candidate.id === record.id ? record : candidate
            )
          : [...canonical.records, record];
        return Promise.resolve(structuredClone(record));
      }
      if (command === 'crm_trash_soft_delete') {
        const recordId = String(args?.['recordId']);
        const matterId = String(args?.['matterId']);
        const record = canonical.records.find(
          (candidate) =>
            candidate.id === recordId && candidate.matterId === matterId
        );
        if (!record) {
          return Promise.reject(new Error('Task is no longer available.'));
        }
        const trashed: TrashedCrmRecord = {
          recordId,
          recordType: record.kind,
          matterId,
          record: structuredClone(record),
          deletedAt: '2026-07-19T02:00:00.000Z',
          deletedBy: String(args?.['deletedBy']),
          expiresAt: '2026-08-18T02:00:00.000Z',
        };
        canonical.records = canonical.records.filter(
          (candidate) =>
            !(candidate.id === recordId && candidate.matterId === matterId)
        );
        canonical.trash = [...canonical.trash, trashed];
        return Promise.resolve(structuredClone(trashed));
      }
      return Promise.reject(new Error(`Unexpected command ${command}`));
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    resetPlatformFlagsOverrides(flagsMock);
  });

  it('keeps the source, saves a fresh open duplicate, survives fresh readers, and deletes only to recoverable Trash', async () => {
    const sourceBefore = structuredClone(sourceTask);
    let mounted = render(<CrmHome initialRoute="tasks" />);
    await screen.findByTestId('crm-task-record-task-source');

    fireEvent.click(
      screen.getByRole('button', { name: 'Duplicate Prepare annual review' })
    );

    await waitFor(() => {
      expect(
        canonical.records.filter((record) => record.kind === 'task')
      ).toHaveLength(2);
      expect(screen.getByTestId('crm-task-detail')).toBeInTheDocument();
    });
    const duplicate = canonical.records.find(
      (record) => record.kind === 'task' && record.id !== sourceTask.id
    );
    expect(duplicate).toMatchObject({
      title: 'Prepare annual review',
      body: 'Use the signed plan.',
      householdRef: sourceTask['householdRef'],
      assigneeUserId: null,
      status: 'open',
      due: '2026-08-03',
      dueTime: '09:30',
      recurrence: sourceTask['recurrence'],
      priority: 'high',
      category: 'Annual review',
      tagIds: ['tag:review'],
      contextRefs: sourceTask['contextRefs'],
    });
    expect(duplicate?.id).not.toBe(sourceTask.id);
    expect(
      canonical.records.find((record) => record.id === sourceTask.id)
    ).toEqual(sourceBefore);

    fireEvent.click(screen.getByTestId('crm-task-save'));
    await waitFor(() => {
      expect(screen.queryByTestId('crm-task-detail')).not.toBeInTheDocument();
    });
    const duplicateId = duplicate?.id;
    expect(duplicateId).toBeTruthy();
    mounted.unmount();

    mounted = render(<CrmHome initialRoute="tasks" />);
    await screen.findByTestId(`crm-task-record-${String(duplicateId)}`);
    expect(
      screen.getByTestId('crm-task-record-task-source')
    ).toBeInTheDocument();
    expect(
      canonical.commands.filter((command) => command === 'crm_live_list').length
    ).toBeGreaterThan(1);

    fireEvent.click(
      screen.getByTestId(`crm-task-delete-${String(duplicateId)}`)
    );
    const rejectedConfirmation = await screen.findByTestId(
      'crm-task-delete-confirmation'
    );
    fireEvent.click(
      within(rejectedConfirmation).getByRole('button', { name: 'Cancel' })
    );
    mounted.unmount();

    mounted = render(<CrmHome initialRoute="tasks" />);
    await screen.findByTestId(`crm-task-record-${String(duplicateId)}`);
    expect(canonical.trash).toHaveLength(0);

    fireEvent.click(
      screen.getByTestId(`crm-task-delete-${String(duplicateId)}`)
    );
    const acceptedConfirmation = await screen.findByTestId(
      'crm-task-delete-confirmation'
    );
    fireEvent.click(
      within(acceptedConfirmation).getByRole('button', { name: 'Delete' })
    );
    await waitFor(() => {
      expect(canonical.commands).toContain('crm_trash_soft_delete');
      expect(canonical.trash).toEqual([
        expect.objectContaining({
          recordId: duplicateId,
          recordType: 'task',
          matterId: 'firm_home',
        }),
      ]);
    });
    mounted.unmount();

    render(<CrmHome initialRoute="tasks" />);
    await screen.findByTestId('crm-task-record-task-source');
    expect(
      screen.queryByTestId(`crm-task-record-${String(duplicateId)}`)
    ).not.toBeInTheDocument();
    expect(
      canonical.records.find((record) => record.id === sourceTask.id)
    ).toEqual(sourceBefore);
  });
});
