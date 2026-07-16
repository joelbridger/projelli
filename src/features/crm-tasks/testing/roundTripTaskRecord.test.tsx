import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

const canonical = vi.hoisted(() => ({
  records: [] as LiveCrmRecord[],
  commands: [] as string[],
  saveEcho: null as LiveCrmRecord | null,
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

import { roundTripTaskRecord } from '@/features/crm-tasks/testing';

describe('roundTripTaskRecord', () => {
  beforeEach(() => {
    canonical.records = [];
    canonical.commands = [];
    canonical.saveEcho = null;
    canonical.invoke.mockReset();
    canonical.invoke.mockImplementation((command, args) => {
      canonical.commands.push(command);
      if (command === 'crm_live_list') {
        return Promise.resolve(structuredClone(canonical.records));
      }
      if (command === 'crm_live_upsert' && args?.record) {
        const saveEcho = structuredClone(args.record);
        canonical.saveEcho = saveEcho;
        const stored = {
          ...saveEcho,
          body: 'Loaded from the canonical live-record route',
        };
        canonical.records = canonical.records.some((item) => item.id === stored.id)
          ? canonical.records.map((item) => item.id === stored.id ? stored : item)
          : [...canonical.records, stored];
        return Promise.resolve(structuredClone(saveEcho));
      }
      return Promise.reject(new Error(`Unexpected command ${command}`));
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns a fresh canonical reload rather than the save echo or its clone', async () => {
    const reloaded = await roundTripTaskRecord({
      title: 'Prove the shared round trip',
      body: 'Returned by save only',
      due: '2026-08-03',
      tagIds: ['tag:proof'],
    });

    expect(canonical.saveEcho?.['body']).toBe('Returned by save only');
    expect(reloaded).toMatchObject({
      title: 'Prove the shared round trip',
      body: 'Loaded from the canonical live-record route',
      due: '2026-08-03',
      tagIds: ['tag:proof'],
    });
    expect(reloaded).not.toBe(canonical.saveEcho);
    const upsertIndex = canonical.commands.indexOf('crm_live_upsert');
    expect(upsertIndex).toBeGreaterThanOrEqual(0);
    expect(canonical.commands.slice(upsertIndex + 1)).toContain('crm_live_list');
  });
});
