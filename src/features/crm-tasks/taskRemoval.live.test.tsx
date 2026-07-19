import { act, renderHook, waitFor } from '@testing-library/react';
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
  invoke: vi.fn<
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

import { useTaskRecordStore } from '@/features/crm-tasks';
import {
  listTrashedCrmRecords,
  restoreTrashedCrmRecord,
} from '@/features/crm-trash/trashClient';

describe('canonical task removal and recovery integration', () => {
  beforeEach(() => {
    resetPlatformFlagsOverrides(flagsMock);
    setPlatformFlagsOverrides(flagsMock, { isEnabled: () => true });
    canonical.records = [];
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
        const tombstoned = canonical.trash.some(
          (item) =>
            item.recordId === record.id && item.matterId === record.matterId
        );
        if (tombstoned) {
          return Promise.reject(
            new Error('CRM record has an active trash tombstone')
          );
        }
        canonical.records = canonical.records.some(
          (item) => item.id === record.id && item.matterId === record.matterId
        )
          ? canonical.records.map((item) =>
              item.id === record.id && item.matterId === record.matterId
                ? record
                : item
            )
          : [...canonical.records, record];
        return Promise.resolve(structuredClone(record));
      }
      if (command === 'crm_trash_soft_delete') {
        const recordId = String(args?.['recordId']);
        const matterId = String(args?.['matterId']);
        const record = canonical.records.find(
          (item) => item.id === recordId && item.matterId === matterId
        );
        if (!record) {
          return Promise.reject(
            new Error('CRM record is not available for deletion')
          );
        }
        const trashed: TrashedCrmRecord = {
          recordId,
          recordType: record.kind,
          matterId,
          record: structuredClone(record),
          deletedAt: '2026-07-18T12:00:00Z',
          deletedBy: String(args?.['deletedBy']),
          expiresAt: '2026-08-17T12:00:00Z',
        };
        canonical.records = canonical.records.filter(
          (item) => !(item.id === recordId && item.matterId === matterId)
        );
        canonical.trash = [...canonical.trash, trashed];
        return Promise.resolve(structuredClone(trashed));
      }
      if (command === 'crm_trash_list') {
        return Promise.resolve(structuredClone(canonical.trash));
      }
      if (command === 'crm_trash_restore') {
        const recordId = String(args?.['recordId']);
        const matterId = String(args?.['matterId']);
        const trashed = canonical.trash.find(
          (item) => item.recordId === recordId && item.matterId === matterId
        );
        if (!trashed) {
          return Promise.reject(
            new Error('CRM record is no longer recoverable')
          );
        }
        canonical.trash = canonical.trash.filter((item) => item !== trashed);
        canonical.records = [
          ...canonical.records,
          structuredClone(trashed.record) as LiveCrmRecord,
        ];
        return Promise.resolve(structuredClone(trashed));
      }
      return Promise.reject(new Error(`Unexpected command ${command}`));
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    resetPlatformFlagsOverrides(flagsMock);
  });

  it('round-trips remove to trash to restore through the public stores and fresh readers', async () => {
    const creator = renderHook(() => useTaskRecordStore());
    const created = await act(() =>
      creator.result.current.create({
        title: 'Prepare annual review',
        householdRef: {
          kind: 'household',
          id: 'household-1',
          matterId: 'matter-1',
        },
      })
    );
    creator.unmount();

    const remover = renderHook(() => useTaskRecordStore());
    await waitFor(async () => {
      await expect(remover.result.current.get(created.id)).resolves.toBeDefined();
    });
    await act(() => remover.result.current.remove(created.id));
    remover.unmount();

    const afterRemoval = renderHook(() => useTaskRecordStore());
    await waitFor(async () => {
      await expect(afterRemoval.result.current.get(created.id)).resolves.toBeUndefined();
    });
    afterRemoval.unmount();

    const trash = await listTrashedCrmRecords('/workspace');
    expect(trash).toEqual([
      expect.objectContaining({
        recordId: created.id,
        recordType: 'task',
        matterId: 'firm_home',
        deletedBy: 'local-user',
      }),
    ]);
    await restoreTrashedCrmRecord({
      workspaceRoot: '/workspace',
      recordId: created.id,
      matterId: 'firm_home',
      actorId: 'advisor-2',
    });

    const afterRestore = renderHook(() => useTaskRecordStore());
    await waitFor(async () => {
      await expect(afterRestore.result.current.get(created.id)).resolves.toMatchObject({
        id: created.id,
        title: 'Prepare annual review',
      });
    });
    afterRestore.unmount();

    expect(canonical.commands).toEqual(
      expect.arrayContaining([
        'crm_live_upsert',
        'crm_trash_soft_delete',
        'crm_trash_list',
        'crm_trash_restore',
      ])
    );
  });
});
