import { act, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatterSyncCallbacks } from '@/platform/firm/MatterSyncClient';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

const peer = vi.hoisted(() => ({
  doc: null as Y.Doc | null,
  callbacks: null as MatterSyncCallbacks | null,
  records: [] as LiveCrmRecord[],
  invoke: vi.fn<(command: string, args?: { record?: LiveCrmRecord }) => Promise<unknown>>(),
}));

vi.mock('@/platform/flags', () => ({ isEnabled: () => true }));
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (command: string, args?: { record?: LiveCrmRecord }) => peer.invoke(command, args),
}));
vi.mock('@/platform/utils/wealthbox-commands', () => ({
  crmSetWorkspace: () => Promise.resolve(),
}));
vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: <T,>(selector: (state: { rootPath: string }) => T) => selector({ rootPath: '/firm' }),
}));
vi.mock('@/platform/matter/matterStore', () => ({
  useMatterStore: <T,>(selector: (state: {
    matters: Array<{ id: string; shared: boolean; firmMatterId: string }>;
    activeMatterId: string;
  }) => T) => selector({
    matters: [{ id: 'local-firm', shared: true, firmMatterId: 'firm-delivery-matter' }],
    activeMatterId: 'local-firm',
  }),
}));
vi.mock('@/platform/firm/matterKeyService', () => ({
  obtainMatterKey: () => Promise.resolve('test-key'),
}));
vi.mock('@/platform/firm/firmStore', () => ({
  useFirmStore: {
    getState: () => ({
      seatToken: 'seat-token',
      client: () => ({ matterMine: () => Promise.resolve({ matters: [] }) }),
    }),
  },
}));
vi.mock('@/platform/firm/coedit/MatterDocSyncClient', () => ({
  MatterDocSyncClient: vi.fn().mockImplementation(function (options: {
    doc: Y.Doc;
    callbacks: MatterSyncCallbacks;
  }) {
    peer.doc = options.doc;
    peer.callbacks = options.callbacks;
    return { start: () => Promise.resolve(), stop: vi.fn() };
  }),
}));

import { clearLiveRecordRelay, publishLiveRecord } from '@/platform/crm/liveRecordRelay';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import { UniversalTagsSettingsMount } from './settingsModule';

function tag(name: string): LiveCrmRecord {
  return {
    id: 'tag:planning', kind: 'tag', matterId: 'firm_home', name, color: '#2563eb', deleted: false,
    createdAt: '2026-01-01T00:00:00.000Z', createdBy: { userId: 'u1', display: 'You', kind: 'user' },
    updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: { userId: 'u1', display: 'You', kind: 'user' },
    source: { origin: 'user', sources: [] }, externalRefs: [], schemaVersion: 1,
  };
}

function deliverPeerRecord(record: LiveCrmRecord) {
  const doc = peer.doc;
  if (!doc) throw new Error('The real relay did not start.');
  doc.transact(() => {
    const records = doc.getMap<Y.Map<string>>('records');
    const encoded = new Y.Map<string>();
    for (const [field, value] of Object.entries(record)) encoded.set(field, JSON.stringify(value));
    records.set(record.id, encoded);
  });
  const onRemoteUpdate = peer.callbacks?.onRemoteUpdate;
  if (!onRemoteUpdate) throw new Error('The real relay has no remote-update callback.');
  onRemoteUpdate(doc);
}

// This mounts first, so its callback owns the relay singleton. The Settings
// panel is a separate mounted consumer that can update only through the shared
// change event emitted after the relay persists the peer record.
function RelayOwner() {
  useLiveCrmRecords();
  return null;
}

describe('UniversalTagsSettingsMount peer relay integration', () => {
  beforeEach(() => {
    peer.doc = null;
    peer.callbacks = null;
    peer.records = [tag('Planning')];
    peer.invoke.mockReset();
    peer.invoke.mockImplementation((command: string, args?: { record?: LiveCrmRecord }) => {
      if (command === 'crm_live_list') return Promise.resolve(structuredClone(peer.records));
      const record = args?.record;
      if (command === 'crm_live_upsert' && record) {
        peer.records = peer.records.some((item) => item.id === record.id)
          ? peer.records.map((item) => item.id === record.id ? structuredClone(record) : item)
          : [...peer.records, structuredClone(record)];
        return Promise.resolve(structuredClone(record));
      }
      return Promise.reject(new Error(`Unexpected command ${command}`));
    });
  });

  afterEach(() => {
    clearLiveRecordRelay();
    vi.clearAllMocks();
  });

  it('fans a peer tag through the real firm relay to an already-mounted panel', async () => {
    const { unmount } = render(<><RelayOwner /><UniversalTagsSettingsMount /></>);
    const panel = await screen.findByTestId('firm-tags-settings');
    expect(screen.getByTestId('firm-tag-name-tag:planning')).toHaveValue('Planning');
    await waitFor(() => {
      expect(peer.callbacks?.onRemoteUpdate).toBeTypeOf('function');
    });

    // `firm_home` is the canonical whole-firm scope, not the delivery matter
    // ID. The real publish guard must still put it in that matter's stream.
    publishLiveRecord(tag('Outgoing planning'));
    expect(peer.doc?.getMap<Y.Map<string>>('records').get('tag:planning')?.get('name'))
      .toBe(JSON.stringify('Outgoing planning'));

    act(() => {
      deliverPeerRecord(tag('Peer planning'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('firm-tag-name-tag:planning')).toHaveValue('Peer planning');
    });
    expect(screen.getByTestId('firm-tags-settings')).toBe(panel);
    const remoteSave = peer.invoke.mock.calls.find(([command]) => command === 'crm_live_upsert');
    expect(remoteSave?.[1]?.record).toMatchObject({
      id: 'tag:planning', matterId: 'firm_home', name: 'Peer planning',
    });
    unmount();
  });
});
