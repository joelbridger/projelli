import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

const boundary = vi.hoisted(() => ({
  records: [] as LiveCrmRecord[],
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

import { useCapacityTriagePreference } from './index';

const savedPreference = {
  assignee: 'user:advisor-1' as const,
  duePressure: 'due_now' as const,
  priority: 'high' as const,
  tagIds: ['tag:review'],
};

describe('capacity triage encrypted preference round trip', () => {
  beforeEach(() => {
    boundary.records = [];
    boundary.invoke.mockReset();
    boundary.invoke.mockImplementation((command, args) => {
      if (command === 'crm_live_list') {
        return Promise.resolve(structuredClone(boundary.records));
      }
      if (command === 'crm_live_upsert' && args?.record) {
        const record = structuredClone(args.record);
        boundary.records = boundary.records.some(
          (candidate) => candidate.id === record.id
        )
          ? boundary.records.map((candidate) =>
              candidate.id === record.id ? record : candidate
            )
          : [...boundary.records, record];
        return Promise.resolve(structuredClone(record));
      }
      return Promise.reject(new Error(`Unexpected command ${command}`));
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('saves, reloads, discards the writer, and reopens from a fresh list response', async () => {
    const writer = renderHook(() => useCapacityTriagePreference());
    await waitFor(() => {
      expect(
        boundary.invoke.mock.calls.some(
          ([command]) => command === 'crm_live_list'
        )
      ).toBe(true);
    });
    boundary.invoke.mockClear();

    await act(async () => {
      await writer.result.current.save(savedPreference);
    });

    const saveCommands = boundary.invoke.mock.calls.map(([command]) => command);
    const upsert = saveCommands.indexOf('crm_live_upsert');
    expect(upsert).toBeGreaterThanOrEqual(0);
    expect(saveCommands.slice(upsert + 1)).toContain('crm_live_list');
    expect(boundary.records).toContainEqual(
      expect.objectContaining({
        kind: 'task_capacity_triage_preference',
        preference: savedPreference,
      })
    );
    writer.unmount();

    boundary.invoke.mockClear();
    const reader = renderHook(() => useCapacityTriagePreference());
    await waitFor(() => {
      expect(reader.result.current.preference).toEqual(savedPreference);
    });
    expect(
      boundary.invoke.mock.calls.filter(
        ([command]) => command === 'crm_live_list'
      )
    ).toHaveLength(1);
    expect(
      boundary.invoke.mock.calls.some(
        ([command]) => command === 'crm_live_upsert'
      )
    ).toBe(false);
    reader.unmount();
  });
});
