/**
 * Live CRM record relay.
 *
 * The CRM screens persist records in SQLCipher.  A shared client also needs a
 * live, end-to-end encrypted copy of those records so another authorised seat
 * can render the same work without a refresh.  This adapter deliberately uses
 * the existing per-matter relay and key path: there is no CRM-specific server
 * endpoint and the relay only receives encrypted Yjs updates.
 */
import * as Y from 'yjs';
import { MatterDocSyncClient } from '@/platform/firm/coedit/MatterDocSyncClient';
import type { SyncStatus } from '@/platform/firm/MatterSyncClient';
import { obtainMatterKey } from '@/platform/firm/matterKeyService';
import { useFirmStore } from '@/platform/firm/firmStore';
import { setCrmEngineFreshness, type CrmEngineFreshness } from '@/platform/crm/store';
import type { LiveCrmRecord } from './liveRecords';

const CRM_LIVE_RECORDS_DOC_ID = 'crm:live-records';

/**
 * This relay is the only thing that actually delivers CRM records live, so it
 * is the one true source for the "Working offline" banner (crm.offline.message
 * says "delivery waits until you reconnect" — this transport IS that delivery).
 * Before this wiring existed, the banner read a freshness store nothing ever
 * updated in production and was permanently stuck on its 'offline' default.
 */
function mapSyncStatusToFreshness(status: SyncStatus): CrmEngineFreshness {
  switch (status) {
    case 'live':
      return { kind: 'live' };
    case 'connecting':
    case 'catching-up':
      return { kind: 'syncing' };
    case 'error':
      return { kind: 'error', error: 'CRM record delivery hit an error and could not sync.' };
    case 'idle':
    case 'offline':
      return { kind: 'offline' };
  }
}

type RemoteWriter = (record: LiveCrmRecord) => Promise<void>;

interface LiveRecordSession {
  readonly firmMatterId: string;
  readonly doc: Y.Doc;
  readonly records: Y.Map<Y.Map<string>>;
  readonly sync: MatterDocSyncClient;
  readonly onRemote: RemoteWriter;
  readonly lastRecords: Map<string, LiveCrmRecord>;
  applyingRemote: boolean;
}

let session: LiveRecordSession | null = null;
let pending: Promise<LiveRecordSession | null> | null = null;

function decodeRecord(value: Y.Map<string>): LiveCrmRecord | null {
  try {
    const record = Object.fromEntries(
      [...value.entries()].map(([field, encoded]) => [field, JSON.parse(encoded)]),
    ) as LiveCrmRecord;
    return typeof record.id === 'string' && typeof record.kind === 'string'
      ? record
      : null;
  } catch {
    return null;
  }
}

function relayEpoch(
  matterId: string,
  seatToken: string,
): Promise<number> {
  return useFirmStore.getState().client().matterMine(seatToken)
    .then(({ matters }) => matters.find((matter) => matter.matter_id === matterId)?.key_epoch ?? 1)
    .catch(() => 1);
}

/**
 * Start one document stream for the shared client currently open in this app.
 * A missing key is a deliberate fail-closed result (wall, no membership, or
 * key not yet published), never a fallback to an unencrypted local channel.
 */
export function ensureLiveRecordRelay(
  firmMatterId: string,
  onRemote: RemoteWriter,
): Promise<LiveRecordSession | null> {
  if (session?.firmMatterId === firmMatterId) return Promise.resolve(session);
  if (pending) return pending;
  // Reaching this function means the workspace really has firm delivery
  // configured. Until the transport reports live, disconnected is the honest
  // state (including missing-seat or missing-key failures during bootstrap).
  setCrmEngineFreshness({ kind: 'offline' });
  pending = build(firmMatterId, onRemote).finally(() => { pending = null; });
  return pending;
}

async function build(firmMatterId: string, onRemote: RemoteWriter): Promise<LiveRecordSession | null> {
  stopLiveRecordRelay();
  const firm = useFirmStore.getState();
  if (!firm.seatToken) return null;
  const client = firm.client();
  const keyB64 = await obtainMatterKey(client, firmMatterId, firm.seatToken);
  if (!keyB64) return null;

  const doc = new Y.Doc();
  const records = doc.getMap<Y.Map<string>>('records');
  const live: LiveRecordSession = {
    firmMatterId,
    doc,
    records,
    sync: null as unknown as MatterDocSyncClient,
    onRemote,
    lastRecords: new Map(),
    applyingRemote: false,
  };
  const sync = new MatterDocSyncClient({
    matterId: firmMatterId,
    docId: CRM_LIVE_RECORDS_DOC_ID,
    doc,
    keyB64,
    keyEpoch: await relayEpoch(firmMatterId, firm.seatToken),
    seatToken: firm.seatToken,
    client,
    callbacks: {
      onRemoteUpdate: () => { void applyRemote(live); },
      onStatus: (status) => { setCrmEngineFreshness(mapSyncStatusToFreshness(status)); },
    },
  });
  (live as { sync: MatterDocSyncClient }).sync = sync;
  session = live;
  await sync.start();
  await applyRemote(live);
  return live;
}

async function applyRemote(live: LiveRecordSession): Promise<void> {
  if (live.applyingRemote) return;
  live.applyingRemote = true;
  try {
    for (const value of live.records.values()) {
      const record = decodeRecord(value);
      if (record && record.matterId === live.firmMatterId) {
        live.lastRecords.set(record.id, record);
        await live.onRemote(record);
      }
    }
  } finally {
    live.applyingRemote = false;
  }
}

/** Put one local SQLCipher record into the encrypted shared-client stream. */
export function publishLiveRecord(record: LiveCrmRecord): void {
  const activeSession = session;
  if (!activeSession || activeSession.applyingRemote || record.matterId !== activeSession.firmMatterId) return;
  const baseline: Record<string, unknown> = activeSession.lastRecords.get(record.id) ?? {};
  activeSession.doc.transact(() => {
    let target = activeSession.records.get(record.id);
    if (!target) {
      target = new Y.Map<string>();
      activeSession.records.set(record.id, target);
    }
    // Each field is its own CRDT cell.  Two advisors changing title and due
    // date from the same stale task view therefore converge without either
    // app writing back the other's old field value.
    for (const [field, value] of Object.entries(record)) {
      const encoded = JSON.stringify(value);
      if (encoded !== JSON.stringify(baseline[field])) target.set(field, encoded);
    }
  });
  activeSession.lastRecords.set(record.id, record);
}

export function stopLiveRecordRelay(): void {
  if (session) {
    session.sync.stop();
    session.doc.destroy();
    session = null;
  }
  // Delivery has genuinely stopped for this matter — report it honestly rather
  // than leaving the last live/syncing state stranded on screen.
  setCrmEngineFreshness({ kind: 'offline' });
}

/** Stop delivery because this workspace has no firm relay configured. */
export function clearLiveRecordRelay(): void {
  if (session) {
    session.sync.stop();
    session.doc.destroy();
    session = null;
  }
  setCrmEngineFreshness({ kind: 'idle' });
}

/** Test-only visibility into the relay lifecycle; it never exposes a key. */
export function getLiveRecordRelayMatterId(): string | null {
  return session?.firmMatterId ?? null;
}
