import * as Y from 'yjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type { MatterSyncCallbacks } from '@/platform/firm/MatterSyncClient';

const relay = vi.hoisted(() => ({
  options: [] as Array<{ doc: Y.Doc; callbacks?: MatterSyncCallbacks }>,
}));

vi.mock('@/platform/firm/coedit/MatterDocSyncClient', () => ({
  MatterDocSyncClient: vi.fn().mockImplementation(function (options: {
    doc: Y.Doc;
    callbacks?: MatterSyncCallbacks;
  }) {
    relay.options.push(options);
    return { start: () => Promise.resolve(), stop: vi.fn() };
  }),
}));
vi.mock('@/platform/firm/matterKeyService', () => ({
  obtainMatterKey: () => Promise.resolve('synthetic-key'),
}));
vi.mock('@/platform/firm/firmStore', () => ({
  useFirmStore: {
    getState: () => ({
      seatToken: 'seat-token',
      client: () => ({
        matterMine: () =>
          Promise.resolve({
            matters: [{ matter_id: 'firm-matter-1', key_epoch: 1 }],
          }),
      }),
    }),
  },
}));

import {
  clearLiveRecordRelay,
  ensureLiveRecordRelay,
  publishLiveRecord,
} from '@/platform/crm/liveRecordRelay';

afterEach(() => {
  clearLiveRecordRelay();
  relay.options.length = 0;
  vi.clearAllMocks();
});

describe('meetings relay visibility', () => {
  it('publishes the meeting record into the real encrypted-document adapter and applies a peer update', async () => {
    const received: LiveCrmRecord[] = [];
    await ensureLiveRecordRelay('firm-matter-1', (record) => {
      received.push(structuredClone(record));
      return Promise.resolve();
    });
    const options = relay.options.at(-1);
    expect(options).toBeDefined();

    publishLiveRecord({
      id: 'meeting-1',
      kind: 'meeting',
      matterId: 'local-matter-1',
      relayMatterId: 'firm-matter-1',
      householdRef: 'household-1',
      ownerRef: 'member-1',
      visibilityPolicyId: 'inherit',
    });
    const records = options?.doc.getMap<Y.Map<string>>('records');
    const encoded = records?.get('meeting-1');
    expect(encoded?.get('householdRef')).toBe(JSON.stringify('household-1'));

    publishLiveRecord({
      id: 'meeting-1',
      kind: 'meeting',
      matterId: 'local-matter-1',
      relayMatterId: 'firm-matter-1',
      householdRef: 'household-1',
      ownerRef: 'member-1',
    });
    expect(encoded?.has('visibilityPolicyId')).toBe(false);

    encoded?.set('ownerRef', JSON.stringify('peer-member'));
    options?.callbacks?.onRemoteUpdate?.(options.doc);
    await vi.waitFor(() => {
      expect(received.at(-1)).toMatchObject({
        id: 'meeting-1',
        householdRef: 'household-1',
        ownerRef: 'peer-member',
      });
      expect(received.at(-1)).not.toHaveProperty('visibilityPolicyId');
    });
  });
});
