import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

const boundary = vi.hoisted(() => ({
  records: [] as LiveCrmRecord[],
  invoke: vi.fn<(command: string, args?: { record?: LiveCrmRecord }) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (command: string, args?: { record?: LiveCrmRecord }) => boundary.invoke(command, args),
}));
vi.mock('@/platform/utils/wealthbox-commands', () => ({ crmSetWorkspace: () => Promise.resolve() }));
vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: <T,>(selector: (state: { rootPath: string }) => T) => selector({ rootPath: '/workspace' }),
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

import { LIVE_CRM_RECORDS_CHANGED } from '@/platform/crm/useLiveCrmRecords';
import { useTaskRecordStore } from '@/features/crm-tasks';
import {
  issueAllMattersScopeSelection,
  issueMatterScopeSelection,
  readAuthoritativeMatterScope,
  rehydrateSelectionHint,
  replaceCanonicalHouseholdDirectory,
  requestClearClientSelection,
  requestMatterScopeSelection,
  useClientContextStore,
} from '@/platform/client-context';
import { setDevFlagOverride } from '@/platform/flags/router';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { Matter } from '@/platform/types/matter';

const alphaMatter: Matter = {
  id: 'matter-alpha',
  name: 'Alpha plan',
  client: 'Alpha household',
  folderPaths: ['/workspace/Alpha'],
  crmHouseholdKeys: ['household-alpha'],
  createdAt: '2026-07-18T00:00:00.000Z',
};

async function waitForSelectionProjection(value: string | null): Promise<void> {
  await waitFor(() => {
    expect(useMatterStore.getState().activeMatterId).toBe(value);
    expect(useClientContextStore.getState().followerStatus).toBe('converged');
  });
}

async function selectAllMatters(): Promise<void> {
  await requestMatterScopeSelection(issueAllMattersScopeSelection());
  await waitForSelectionProjection(null);
}

async function selectAlphaMatter(): Promise<void> {
  await requestMatterScopeSelection(issueMatterScopeSelection(alphaMatter.id));
  await waitForSelectionProjection(alphaMatter.id);
}

function blockSelection(): void {
  rehydrateSelectionHint({
    kind: 'persisted-hint',
    value: { version: 1, source: 'blocked/refused' },
  });
}

describe('task record store canonical reload integration', () => {
  beforeEach(() => {
    localStorage.clear();
    setDevFlagOverride('selection-authority-boot-gate', false);
    readAuthoritativeMatterScope();
    useMatterStore.setState({ matters: [alphaMatter], activeMatterId: null });
    requestClearClientSelection();
    replaceCanonicalHouseholdDirectory('wealthbox', [
      {
        provider: 'wealthbox',
        householdId: 'household-alpha',
        displayName: 'Alpha household',
      },
    ]);
    setDevFlagOverride('selection-authority-boot-gate', true);
    readAuthoritativeMatterScope();
    boundary.records = [];
    boundary.invoke.mockReset();
    boundary.invoke.mockImplementation((command, args) => {
      if (command === 'crm_live_list') return Promise.resolve(structuredClone(boundary.records));
      if (command === 'crm_live_upsert' && args?.record) {
        const record = structuredClone(args.record);
        boundary.records = boundary.records.some((item) => item.id === record.id)
          ? boundary.records.map((item) => item.id === record.id ? record : item)
          : [...boundary.records, record];
        return Promise.resolve(structuredClone(record));
      }
      return Promise.reject(new Error(`Unexpected command ${command}`));
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    setDevFlagOverride('selection-authority-boot-gate', false);
    readAuthoritativeMatterScope();
    useMatterStore.setState({ matters: [], activeMatterId: null });
    requestClearClientSelection();
    replaceCanonicalHouseholdDirectory('wealthbox', null);
    setDevFlagOverride('selection-authority-boot-gate', undefined);
    localStorage.clear();
  });

  it('retains foundation fields through create, canonical reopen, update, and peer refresh', async () => {
    const first = renderHook(() => useTaskRecordStore());
    const created = await first.result.current.create({
      title: 'Prepare annual review',
      householdRef: { kind: 'household', id: 'household-1', matterId: 'matter-1' },
      due: '2026-08-03',
      dueTime: '09:30',
      category: 'Annual review',
      tagIds: ['tag:review'],
      contextRefs: [{ kind: 'document', id: 'Clients/River/review.docx', matterId: 'matter-1', label: 'Review packet' }],
    });
    first.unmount();

    const reopened = renderHook(() => useTaskRecordStore());
    await waitFor(async () => {
      await expect(reopened.result.current.get(created.id)).resolves.toMatchObject({
        dueTime: '09:30',
        category: 'Annual review',
        tagIds: ['tag:review'],
        contextRefs: [{ kind: 'document', id: 'Clients/River/review.docx' }],
      });
    });
    await reopened.result.current.update(created.id, { title: 'Prepare updated review', priority: 'high' });
    await waitFor(async () => {
      await expect(reopened.result.current.get(created.id)).resolves.toMatchObject({
        title: 'Prepare updated review',
        priority: 'high',
        dueTime: '09:30',
        tagIds: ['tag:review'],
      });
    });

    boundary.records = boundary.records.map((record) => record.id === created.id
      ? { ...record, category: 'Peer category' }
      : record);
    act(() => {
      window.dispatchEvent(new Event(LIVE_CRM_RECORDS_CHANGED));
    });
    await waitFor(async () => {
      await expect(reopened.result.current.get(created.id)).resolves.toMatchObject({ category: 'Peer category' });
    });
    reopened.unmount();
  });

  it('task-round-trip x reader-migration interaction', async () => {
    boundary.records = [
      {
        id: 'task-selection-proof',
        kind: 'task',
        matterId: 'firm',
        title: 'Review beneficiary notes',
        body: 'Original task metadata',
        assigneeUserId: null,
        status: 'open',
        priority: 'normal',
        category: 'Annual review',
        tagIds: ['tag:original'],
        contextRefs: [],
      },
    ];

    const roundTripEdit = async (
      select: () => Promise<void>,
      priority: 'high' | 'low',
      category: string,
      tagId: string,
    ) => {
      await select();
      const writer = renderHook(() => useTaskRecordStore());
      await waitFor(async () => {
        await expect(writer.result.current.get('task-selection-proof')).resolves.toBeDefined();
      });
      await act(async () => {
        await writer.result.current.update('task-selection-proof', {
          priority,
          category,
          tagIds: [tagId],
        });
      });
      writer.unmount();

      const reader = renderHook(() => useTaskRecordStore());
      await waitFor(async () => {
        await expect(reader.result.current.get('task-selection-proof')).resolves.toMatchObject({
          priority,
          category,
          tagIds: [tagId],
        });
      });
      reader.unmount();
    };

    await roundTripEdit(selectAllMatters, 'high', 'All-matters review', 'tag:all');
    await roundTripEdit(selectAlphaMatter, 'low', 'Alpha review', 'tag:alpha');

    blockSelection();
    await waitForSelectionProjection(null);
    expect(readAuthoritativeMatterScope()).toEqual({ kind: 'blocked-unresolved' });
    const blockedWriter = renderHook(() => useTaskRecordStore());
    await waitFor(async () => {
      await expect(blockedWriter.result.current.get('task-selection-proof')).resolves.toBeDefined();
    });
    await expect(
      blockedWriter.result.current.update('task-selection-proof', {
        priority: 'high',
        category: 'Must not save',
      }),
    ).rejects.toThrow('still unresolved');
    expect(boundary.records[0]).toMatchObject({
      priority: 'low',
      category: 'Alpha review',
      tagIds: ['tag:alpha'],
    });
    blockedWriter.unmount();
  });
});
