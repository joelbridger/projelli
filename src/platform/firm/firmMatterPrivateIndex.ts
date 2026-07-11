/**
 * Encrypted device-side directory for a shared client.
 *
 * This map lives inside the encrypted root Yjs stream. Its keys are local
 * document IDs and are never copied into a relay path, query, body, or frame.
 */
import * as Y from 'yjs';
import type { MatterHandle, StreamHandle } from './contract';
import { parseStreamHandle } from './contract';
import { FirmApiError, type FirmApiClient } from './FirmApiClient';
import { rootIndexWriteOrigin } from './MatterSyncClient';

export const FIRM_PRIVATE_INDEX_MAP = 'firm-private-index';
/**
 * The version-two stream directory is a named Yjs root map, rather than a map
 * value stored under `firm-private-index`. Named root types are obtained by
 * name on every client, so two legacy clients can never race by assigning two
 * different Y.Map values to the same parent key.
 */
export const FIRM_PRIVATE_INDEX_STREAMS_V2_MAP = 'firm-private-index-streams-v2';
const INDEX_VERSION = 1;

/**
 * The relay reclaims an unused stream after 15 minutes. Leave a large buffer
 * for clocks, network queues, and cleanup scheduling: a new stream must have
 * its encrypted root-index mapping accepted within eight minutes.
 */
export const DOCUMENT_STREAM_LEASE_COMMIT_DEADLINE_MS = 8 * 60 * 1_000;
/** Never begin a root commit if the server says there is less than this left. */
export const DOCUMENT_STREAM_MIN_REMAINING_BUDGET_MS = 5_000;

export interface FirmMatterPrivateIndex {
  version: 1;
  clientName: string;
  displayName: string;
  streams: Record<string, { streamHandle: StreamHandle; kind: 'notes' | 'document' }>;
}

export interface RootIndexSync {
  /** Publish the encrypted root update. The relay treats its ciphertext as opaque. */
  flush(options?: { signal?: AbortSignal }): Promise<void>;
}

export interface DocumentStreamCommitOptions {
  /** Test/host override. Production uses the eight-minute safe lease window. */
  leaseCommitDeadlineMs?: number;
  /** Absolute server-clock deadline returned by allocation. */
  leaseCommitDeadlineAt?: string;
  /** Test seam; production always uses the device clock only to budget the server deadline. */
  now?: () => number;
}

function deadlineSignal(timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(new DOMException('Document stream lease commit timed out.', 'TimeoutError')); }, timeoutMs);
  return { signal: controller.signal, cancel: () => { clearTimeout(timer); } };
}

type PrivateStreamEntry = FirmMatterPrivateIndex['streams'][string];
type PrivateStreamValue = PrivateStreamEntry | { tombstone: true };

function stringField(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`Malformed private index: ${name}.`);
  return value;
}

function readStreamEntry(entry: unknown): PrivateStreamEntry {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Malformed private index: stream.');
  const candidate = entry as Record<string, unknown>;
  const kind = candidate['kind'];
  if (kind !== 'notes' && kind !== 'document') throw new Error('Malformed private index: stream kind.');
  return { streamHandle: parseStreamHandle(stringField(candidate['streamHandle'], 'stream handle')), kind };
}

async function documentStreamCreateBlobId(localDocumentId: string, streamHandle: StreamHandle): Promise<string> {
  const input = new TextEncoder().encode(`firm-root-index-create-v1\u0000${localDocumentId}\u0000${streamHandle}`);
  const digest = await crypto.subtle.digest('SHA-256', input);
  return `root-index-create-v1-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function isInstalledEntry(value: unknown, streamHandle: StreamHandle): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as { streamHandle?: unknown; kind?: unknown };
  return candidate.streamHandle === streamHandle && candidate.kind === 'document';
}

function isDefinitelyRejected(error: unknown): error is FirmApiError {
  return error instanceof FirmApiError && error.status >= 400 && error.status < 500;
}

function readPlainStreams(rawStreams: unknown): FirmMatterPrivateIndex['streams'] {
  if (!rawStreams || typeof rawStreams !== 'object' || Array.isArray(rawStreams)) {
    throw new Error('Malformed private index: streams.');
  }
  const streams: FirmMatterPrivateIndex['streams'] = {};
  for (const [localId, entry] of Object.entries(rawStreams as Record<string, unknown>)) {
    streams[localId] = readStreamEntry(entry);
  }
  return streams;
}

function readLegacyStreams(rawStreams: unknown): FirmMatterPrivateIndex['streams'] {
  if (rawStreams === undefined) return {};
  // Briefly released clients wrote a Y.Map under `streams`; retain it as a
  // legacy source too. It must never again be replaced as part of a write.
  return rawStreams instanceof Y.Map ? readPlainStreams(Object.fromEntries(rawStreams.entries())) : readPlainStreams(rawStreams);
}

/**
 * Get the single versioned stream map in a transaction. Unlike a parent
 * `map.set('streams', new Y.Map())`, this never performs a whole-map
 * assignment: each client opens the same named root map and writes only an
 * individual local-document key.
 */
function getStreamsV2Map(doc: Y.Doc): Y.Map<unknown> {
  let streamsMap: Y.Map<unknown> | undefined;
  doc.transact(() => {
    streamsMap = doc.getMap<unknown>(FIRM_PRIVATE_INDEX_STREAMS_V2_MAP);
  });
  return streamsMap as Y.Map<unknown>;
}

/** Read old and new directories together; a v2 entry (including a tombstone) wins. */
function readStreams(doc: Y.Doc, indexMap: Y.Map<unknown>): FirmMatterPrivateIndex['streams'] {
  const streams = readLegacyStreams(indexMap.get('streams'));
  for (const [localId, entry] of getStreamsV2Map(doc).entries()) {
    const value = entry as PrivateStreamValue;
    if (typeof entry === 'object' && entry !== null && !Array.isArray(entry) && (entry as { tombstone?: unknown }).tombstone === true) {
      Reflect.deleteProperty(streams, localId);
    } else {
      streams[localId] = readStreamEntry(value);
    }
  }
  return streams;
}

/** Read and validate the dedicated map. Corrupt state never becomes routing data. */
export function readFirmMatterPrivateIndex(doc: Y.Doc): FirmMatterPrivateIndex | null {
  const map = doc.getMap<unknown>(FIRM_PRIVATE_INDEX_MAP);
  if (map.size === 0) return null;
  if (map.get('version') !== INDEX_VERSION) throw new Error('Malformed private index: version.');
  return {
    version: 1,
    clientName: stringField(map.get('clientName'), 'clientName'),
    displayName: stringField(map.get('displayName'), 'displayName'),
    streams: readStreams(doc, map),
  };
}

/** Initialize the root index before the provisioning shell is activated. */
export function writeFirmMatterPrivateIndex(doc: Y.Doc, index: FirmMatterPrivateIndex): void {
  // Validate before changing Yjs state, so a bad server response cannot poison it.
  const checked = { ...index, streams: { ...index.streams } };
  for (const entry of Object.values(checked.streams)) parseStreamHandle(entry.streamHandle);
  doc.transact(() => {
    const map = doc.getMap<unknown>(FIRM_PRIVATE_INDEX_MAP);
    const legacyStreams = readLegacyStreams(map.get('streams'));
    const streamsMap = getStreamsV2Map(doc);
    map.set('version', INDEX_VERSION);
    map.set('clientName', checked.clientName);
    map.set('displayName', checked.displayName);
    for (const localId of streamsMap.keys()) {
      if (!Object.prototype.hasOwnProperty.call(checked.streams, localId)) {
        // A legacy entry must stay hidden after a normal local deletion, but
        // the legacy object itself is retained until an explicit migration
        // barrier can retire it safely.
        if (Object.prototype.hasOwnProperty.call(legacyStreams, localId)) streamsMap.set(localId, { tombstone: true });
        else streamsMap.delete(localId);
      }
    }
    for (const [localId, entry] of Object.entries(checked.streams)) streamsMap.set(localId, entry);
  });
}

/**
 * Record a new document stream in the encrypted root index and wait until its
 * root update is accepted before allowing the caller to start the stream.
 */
export async function addDocumentStreamToPrivateIndex(
  doc: Y.Doc,
  rootSync: RootIndexSync,
  localDocumentId: string,
  streamHandle: StreamHandle,
  options: DocumentStreamCommitOptions = {},
): Promise<void> {
  const current = readFirmMatterPrivateIndex(doc);
  if (!current) throw new Error('Cannot add a document stream before the private index exists.');
  const existing = current.streams[localDocumentId];
  if (existing?.streamHandle === streamHandle) return;
  const streamsMap = getStreamsV2Map(doc);
  const previous = streamsMap.get(localDocumentId);
  const blobId = await documentStreamCreateBlobId(localDocumentId, streamHandle);
  doc.transact(() => {
    streamsMap.set(localDocumentId, { streamHandle, kind: 'document' });
  }, rootIndexWriteOrigin(blobId));
  // An absolute relay deadline includes time spent delivering the allocation
  // response. Never restart that clock when it reaches this device.
  const deadlineMs = options.leaseCommitDeadlineMs
    ?? (options.leaseCommitDeadlineAt
      ? Date.parse(options.leaseCommitDeadlineAt) - (options.now?.() ?? Date.now())
      : DOCUMENT_STREAM_LEASE_COMMIT_DEADLINE_MS);
  const deadline = deadlineSignal(Math.max(0, deadlineMs));
  try {
    await rootSync.flush({ signal: deadline.signal });
  } catch (error) {
    // Only a relay 4xx proves it did not accept this root update. A timeout,
    // abort, or network error may have committed after the response was lost:
    // keep its mapping and let the frozen idempotent blob settle later.
    if (isDefinitelyRejected(error)) doc.transact(() => {
      // Compare-and-swap: an older failed create may never undo a later one.
      if (!isInstalledEntry(streamsMap.get(localDocumentId), streamHandle)) return;
      if (previous === undefined) streamsMap.delete(localDocumentId);
      else streamsMap.set(localDocumentId, previous);
    });
    throw error;
  } finally {
    deadline.cancel();
  }
}

/**
 * Allocate a server-generated opaque stream, then durably publish its local
 * mapping in the encrypted root index before the caller opens that stream. The
 * server makes the lease durable only when the stream itself accepts data.
 */
export async function createDocumentStream(
  client: FirmApiClient,
  matterHandle: MatterHandle,
  seatToken: string,
  doc: Y.Doc,
  rootSync: RootIndexSync,
  localDocumentId: string,
  options: DocumentStreamCommitOptions = {},
): Promise<StreamHandle> {
  const { stream_handle, lease_commit_deadline_at } = await client.allocateStream(matterHandle, seatToken);
  const streamHandle = parseStreamHandle(stream_handle);
  const now = options.now?.() ?? Date.now();
  const serverDeadline = Date.parse(lease_commit_deadline_at);
  if (!Number.isFinite(serverDeadline) || serverDeadline - now < DOCUMENT_STREAM_MIN_REMAINING_BUDGET_MS) {
    throw new Error('The document stream lease arrived with too little server-authoritative time remaining.');
  }
  // If publishing the directory fails, the unused lease disappears shortly.
  await addDocumentStreamToPrivateIndex(doc, rootSync, localDocumentId, streamHandle, {
    leaseCommitDeadlineAt: lease_commit_deadline_at,
    ...(options.leaseCommitDeadlineMs === undefined ? {} : { leaseCommitDeadlineMs: options.leaseCommitDeadlineMs }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  return streamHandle;
}

/** Tombstone a local document mapping without exposing the local ID to the relay. */
export async function tombstoneDocumentStreamFromPrivateIndex(
  doc: Y.Doc,
  rootSync: RootIndexSync,
  localDocumentId: string,
): Promise<void> {
  const current = readFirmMatterPrivateIndex(doc);
  if (!current || !current.streams[localDocumentId]) return;
  doc.transact(() => {
    const legacyStreams = readLegacyStreams(doc.getMap<unknown>(FIRM_PRIVATE_INDEX_MAP).get('streams'));
    const streamsMap = getStreamsV2Map(doc);
    if (Object.prototype.hasOwnProperty.call(legacyStreams, localDocumentId)) streamsMap.set(localDocumentId, { tombstone: true });
    else streamsMap.delete(localDocumentId);
  });
  await rootSync.flush();
}
