import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatterSyncCallbacks, SyncStatus } from '@/platform/firm/MatterSyncClient';

/**
 * "Working offline" (crm.offline.message) is driven by CrmEngineFreshness,
 * which this relay is the only real production writer of. Before this fix,
 * MatterDocSyncClient was constructed with no `onStatus` callback at all, so
 * a real relay reaching 'live' never told the freshness store — it stayed
 * stuck on its 'offline' default forever, even while everything (including
 * unrelated Cloud AI requests) was working. These tests drive the relay's
 * real status callback and assert the store — not the banner copy — reflects
 * the truth in both directions.
 */
const { capturedOptions, startMock, stopMock } = vi.hoisted(() => ({
  capturedOptions: [] as Array<{ callbacks?: MatterSyncCallbacks }>,
  startMock: vi.fn(() => Promise.resolve()),
  stopMock: vi.fn(),
}));

vi.mock('@/platform/firm/coedit/MatterDocSyncClient', () => ({
  MatterDocSyncClient: vi.fn().mockImplementation(function (opts: { callbacks?: MatterSyncCallbacks }) {
    capturedOptions.push(opts);
    return { start: startMock, stop: stopMock };
  }),
}));

vi.mock('@/platform/firm/matterKeyService', () => ({
  obtainMatterKey: vi.fn(() => Promise.resolve('fake-matter-key-b64')),
}));

vi.mock('@/platform/firm/firmStore', () => ({
  useFirmStore: {
    getState: () => ({
      seatToken: 'seat-token-1',
      client: () => ({
        matterMine: () => Promise.resolve({ matters: [] }),
      }),
    }),
  },
}));

import { getCrmEngineFreshness, setCrmEngineFreshness } from '@/platform/crm/store';
import { ensureLiveRecordRelay, stopLiveRecordRelay } from './liveRecordRelay';

function latestStatusCallback(): ((status: SyncStatus) => void) | undefined {
  return capturedOptions[capturedOptions.length - 1]?.callbacks?.onStatus;
}

afterEach(() => {
  stopLiveRecordRelay();
  setCrmEngineFreshness({ kind: 'offline' });
  capturedOptions.length = 0;
  vi.clearAllMocks();
});

describe('live CRM record relay drives the real offline/live banner state', () => {
  it('reports live once the real delivery relay actually connects, clearing a false offline banner', async () => {
    await ensureLiveRecordRelay('matter-1', () => Promise.resolve());

    // Sanity: nothing has told the store it's live yet.
    expect(getCrmEngineFreshness()).toEqual({ kind: 'offline' });

    const onStatus = latestStatusCallback();
    expect(onStatus).toBeTypeOf('function');
    onStatus?.('connecting');
    expect(getCrmEngineFreshness()).toEqual({ kind: 'syncing' });
    onStatus?.('live');

    expect(getCrmEngineFreshness()).toEqual({ kind: 'live' });
  });

  it('still honestly reports offline once delivery is truly stopped', async () => {
    await ensureLiveRecordRelay('matter-1', () => Promise.resolve());
    latestStatusCallback()?.('live');
    expect(getCrmEngineFreshness()).toEqual({ kind: 'live' });

    stopLiveRecordRelay();

    expect(getCrmEngineFreshness()).toEqual({ kind: 'offline' });
  });
});
