import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

const canonical = vi.hoisted(() => ({
  records: [] as LiveCrmRecord[],
  commands: [] as string[],
  invoke: vi.fn<(command: string, args?: { record?: LiveCrmRecord }) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (command: string, args?: { record?: LiveCrmRecord }) => canonical.invoke(command, args),
}));
vi.mock('@/platform/utils/wealthbox-commands', () => ({ crmSetWorkspace: () => Promise.resolve() }));
vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: <T,>(selector: (state: { rootPath: string }) => T) => selector({ rootPath: '/workspace' }),
}));
vi.mock('@/platform/matter/matterStore', () => ({
  useMatterStore: <T,>(selector: (state: { matters: []; activeMatterId: null }) => T) => selector({ matters: [], activeMatterId: null }),
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

import { useContactRecordStore, type ContactCreateInput } from '@/features/crm-contacts';

const inputs: readonly ContactCreateInput[] = [
  { kind: 'household', matterId: 'matter-1', name: 'Chen household' },
  { kind: 'person', matterId: 'matter-1', firstName: 'Maya', lastName: 'Chen' },
  { kind: 'organization', matterId: 'matter-1', name: 'Lee Legal' },
  { kind: 'trust', matterId: 'matter-1', name: 'Chen Family Trust' },
];

describe('contact record store canonical live-route integration', () => {
  beforeEach(() => {
    canonical.records = [];
    canonical.commands = [];
    canonical.invoke.mockReset();
    canonical.invoke.mockImplementation((command, args) => {
      canonical.commands.push(command);
      if (command === 'crm_live_list') return Promise.resolve(structuredClone(canonical.records));
      if (command === 'crm_live_upsert' && args?.record) {
        const canonicalRecord = {
          ...structuredClone(args.record),
          createdAt: args.record.createdAt ?? '2026-07-16T00:00:00.000Z',
          updatedAt: '2026-07-16T00:00:00.000Z',
          canonicalMarker: 'loaded-from-crm-live-list',
        };
        canonical.records = canonical.records.some((record) => record.id === canonicalRecord.id)
          ? canonical.records.map((record) => record.id === canonicalRecord.id ? canonicalRecord : record)
          : [...canonical.records, canonicalRecord];
        return Promise.resolve({
          ...structuredClone(canonicalRecord),
          canonicalMarker: 'returned-from-crm-live-upsert',
        });
      }
      return Promise.reject(new Error(`Unexpected command ${command}`));
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('reopens all four kinds and a household-owned relationship through crm_live_list', async () => {
    const first = renderHook(() => useContactRecordStore());
    const created = [] as Awaited<ReturnType<typeof first.result.current.create>>[];
    await act(async () => {
      for (const input of inputs) created.push(await first.result.current.create(input));
    });
    expect(created.every((contact) => contact.source['canonicalMarker'] === 'loaded-from-crm-live-list')).toBe(true);
    expect(canonical.commands.filter((command) => command === 'crm_live_upsert')).toHaveLength(4);
    first.unmount();

    const reopened = renderHook(() => useContactRecordStore());
    await waitFor(() => {
      expect(reopened.result.current.records).toHaveLength(4);
    });
    for (const contact of created) {
      await expect(reopened.result.current.resolve({
        kind: contact.kind,
        id: contact.id,
        matterId: contact.matterId,
      })).resolves.toMatchObject({
        title: contact.displayName,
        contact: {
          kind: contact.kind,
          source: { canonicalMarker: 'loaded-from-crm-live-list' },
        },
      });
    }

    const household = created.find((contact) => contact.kind === 'household');
    const person = created.find((contact) => contact.kind === 'person');
    expect(household).toBeDefined();
    expect(person).toBeDefined();
    if (!household || !person) throw new Error('Four-kind fixture did not create its required records.');
    await act(async () => {
      await reopened.result.current.linkContact(
        { kind: 'household', id: household.id, matterId: household.matterId },
        { kind: 'person', id: person.id, matterId: person.matterId },
        'Primary contact',
      );
    });
    reopened.unmount();

    const relatedReopen = renderHook(() => useContactRecordStore());
    await waitFor(() => {
      expect(relatedReopen.result.current.records).toHaveLength(4);
    });
    await expect(relatedReopen.result.current.listRelated({
      kind: 'household',
      id: household.id,
      matterId: household.matterId,
    })).resolves.toMatchObject([{
      ref: { kind: 'person', id: person.id },
      role: 'Primary contact',
    }]);
    expect(canonical.commands.filter((command) => command === 'crm_live_list').length).toBeGreaterThanOrEqual(3);
    relatedReopen.unmount();
  });
});
