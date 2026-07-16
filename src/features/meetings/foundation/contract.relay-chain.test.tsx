import * as Y from 'yjs';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type { MatterSyncCallbacks } from '@/platform/firm/MatterSyncClient';

// This test follows the REAL production relay chain end to end — nothing about
// the relay is stubbed except the encrypted transport client itself:
//   peer Yjs update -> real liveRecordRelay.applyRemote -> useLiveCrmRecords
//   onRemote writer -> saveLiveCrmRecord (crm_live_upsert) ->
//   LIVE_CRM_RECORDS_CHANGED -> reload (crm_live_list) -> a fresh public reader.
const bus = vi.hoisted(() => ({
  records: [] as LiveCrmRecord[],
  commands: [] as string[],
  relay: [] as Array<{ doc: Y.Doc; callbacks?: MatterSyncCallbacks }>,
  invoke:
    vi.fn<
      (command: string, args?: { record?: LiveCrmRecord }) => Promise<unknown>
    >(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (command: string, args?: { record?: LiveCrmRecord }) =>
    bus.invoke(command, args),
}));
vi.mock('@/platform/utils/wealthbox-commands', () => ({
  crmSetWorkspace: () => Promise.resolve(),
}));
vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: <T,>(selector: (state: { rootPath: string }) => T) =>
    selector({ rootPath: '/workspace' }),
}));
vi.mock('@/platform/matter/matterStore', () => {
  // An active SHARED client, so useLiveCrmRecords starts the firm relay.
  const state: {
    matters: { id: string; shared?: boolean; firmMatterId?: string }[];
    activeMatterId: string | null;
  } = {
    matters: [
      { id: 'local-matter-1', shared: true, firmMatterId: 'firm-matter-1' },
    ],
    activeMatterId: 'local-matter-1',
  };
  const useMatterStore = Object.assign(
    <T,>(selector: (s: typeof state) => T): T => selector(state),
    { getState: () => state }
  );
  return { useMatterStore };
});
vi.mock('@/platform/crm/store', () => ({
  getCrmEngineFreshness: () => ({ kind: 'idle' }),
  subscribeCrmEngineFreshness: () => () => undefined,
  setCrmEngineFreshness: vi.fn(),
}));
vi.mock('@/platform/firm/coedit/MatterDocSyncClient', () => ({
  MatterDocSyncClient: vi.fn().mockImplementation(function (options: {
    doc: Y.Doc;
    callbacks?: MatterSyncCallbacks;
  }) {
    bus.relay.push(options);
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

import { clearLiveRecordRelay } from '@/platform/crm/liveRecordRelay';
import {
  useMeetingArtifactStore,
  useMeetingFoundationStore,
} from './contract';

const client = { householdRef: 'household-1', matterId: 'local-matter-1' };

const peerMeeting: LiveCrmRecord = {
  id: 'peer-meeting-1',
  kind: 'meeting',
  matterId: 'local-matter-1',
  relayMatterId: 'firm-matter-1',
  workspaceId: 'workspace-1',
  householdRef: 'household-1',
  typeId: 'review',
  ownerRef: 'member-1',
  scheduledStartUtc: '2026-07-20T09:00:00.000Z',
  scheduledEndUtc: '2026-07-20T10:00:00.000Z',
  timezone: 'America/Chicago',
  state: 'draft',
  references: ['peer-ref'],
  createdAt: '2026-07-20T08:00:00.000Z',
  updatedAt: '2026-07-20T08:00:00.000Z',
};

const peerArtifact: LiveCrmRecord = {
  id: 'peer-artifact-1',
  kind: 'meeting_artifact',
  matterId: 'local-matter-1',
  relayMatterId: 'firm-matter-1',
  householdRef: 'household-1',
  meetingId: 'peer-meeting-1',
  artifactKind: 'structured-notes',
  schemaVersion: 2,
  producedAt: '2026-07-20T10:00:00.000Z',
  artifactState: 'produced',
  sourceRefs: [],
  provenance: 'local-entry',
  payload: { summary: 'peer notes' },
  createdAt: '2026-07-20T10:00:00.000Z',
  updatedAt: '2026-07-20T10:00:00.000Z',
};

function pushPeerRecord(doc: Y.Doc, record: LiveCrmRecord): void {
  const records = doc.getMap<Y.Map<string>>('records');
  doc.transact(() => {
    const target = new Y.Map<string>();
    records.set(record.id, target);
    for (const [field, value] of Object.entries(record))
      target.set(field, JSON.stringify(value));
  });
}

describe('meetings production relay chain', () => {
  beforeEach(() => {
    bus.records = [];
    bus.commands = [];
    bus.relay = [];
    bus.invoke.mockReset();
    bus.invoke.mockImplementation((command, args) => {
      bus.commands.push(command);
      if (command === 'crm_live_list')
        return Promise.resolve(structuredClone(bus.records));
      if (command === 'crm_live_upsert' && args?.record) {
        const saved = structuredClone(args.record);
        bus.records = bus.records.some((item) => item.id === saved.id)
          ? bus.records.map((item) => (item.id === saved.id ? saved : item))
          : [...bus.records, saved];
        return Promise.resolve(saved);
      }
      return Promise.reject(new Error(`Unexpected command ${command}`));
    });
  });

  afterEach(() => {
    clearLiveRecordRelay();
    vi.clearAllMocks();
  });

  it('delivers a peer meeting and artifact through save + change event to a fresh public reader', async () => {
    const meetings = renderHook(() => useMeetingFoundationStore());
    const artifacts = renderHook(() => useMeetingArtifactStore());

    // Wait until the real relay session is built and holds the transport doc.
    await waitFor(() => {
      expect(bus.relay.length).toBeGreaterThan(0);
    });
    const session = bus.relay.at(-1);
    if (!session) throw new Error('relay session was not created');

    // A peer publishes a meeting into the encrypted stream.
    await act(async () => {
      pushPeerRecord(session.doc, peerMeeting);
      session.callbacks?.onRemoteUpdate?.(session.doc);
      await Promise.resolve();
    });

    // The chain saved it canonically and a fresh public reader now sees it.
    await waitFor(() => {
      expect(
        meetings.result.current.list.some(
          (meeting) => meeting.id === 'peer-meeting-1'
        )
      ).toBe(true);
    });
    expect(bus.commands).toContain('crm_live_upsert');
    expect(bus.records.some((record) => record.id === 'peer-meeting-1')).toBe(
      true
    );
    // The meeting is client-bound: a full read resolves only for its own client.
    await expect(
      meetings.result.current.get('peer-meeting-1')
    ).resolves.toMatchObject({ references: ['peer-ref'] });

    // The same chain also carries an artifact to a fresh, client-bound reader.
    await act(async () => {
      pushPeerRecord(session.doc, peerArtifact);
      session.callbacks?.onRemoteUpdate?.(session.doc);
      await Promise.resolve();
    });
    await waitFor(() => {
      const reader = artifacts.result.current.readerFor(
        meetings.result.current,
        client,
        [{ kind: 'structured-notes', minimumSchemaVersion: 2 }]
      );
      expect(reader.get('peer-artifact-1')).toMatchObject({
        state: 'produced',
        payload: { summary: 'peer notes' },
      });
    });

    meetings.unmount();
    artifacts.unmount();
  });
});
