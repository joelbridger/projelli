/**
 * Encrypted device-side directory for a shared client.
 *
 * This map lives inside the encrypted root Yjs stream. Its keys are local
 * document IDs and are never copied into a relay path, query, body, or frame.
 */
import * as Y from 'yjs';
import type { MatterHandle, StreamHandle } from './contract';
import { parseStreamHandle } from './contract';
import type { FirmApiClient } from './FirmApiClient';

export const FIRM_PRIVATE_INDEX_MAP = 'firm-private-index';
/**
 * The version-two stream directory is a named Yjs root map, rather than a map
 * value stored under `firm-private-index`. Named root types are obtained by
 * name on every client, so two legacy clients can never race by assigning two
 * different Y.Map values to the same parent key.
 */
export const FIRM_PRIVATE_INDEX_STREAMS_V2_MAP = 'firm-private-index-streams-v2';
const INDEX_VERSION = 1;

export interface FirmMatterPrivateIndex {
  version: 1;
  clientName: string;
  displayName: string;
  streams: Record<string, { streamHandle: StreamHandle; kind: 'notes' | 'document' }>;
}

export interface RootIndexSync {
  /** When present, publish this allocation with the accepted encrypted root update. */
  flush(commitStreamHandle?: StreamHandle): Promise<void>;
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
): Promise<void> {
  const current = readFirmMatterPrivateIndex(doc);
  if (!current) throw new Error('Cannot add a document stream before the private index exists.');
  const existing = current.streams[localDocumentId];
  if (existing?.streamHandle === streamHandle) return;
  doc.transact(() => {
    getStreamsV2Map(doc).set(localDocumentId, { streamHandle, kind: 'document' });
  });
  await rootSync.flush();
}

/**
 * Allocate a server-generated opaque stream, then durably publish its local
 * mapping in the encrypted root index before the caller opens that stream.
 */
export async function createDocumentStream(
  client: FirmApiClient,
  matterHandle: MatterHandle,
  seatToken: string,
  doc: Y.Doc,
  rootSync: RootIndexSync,
  localDocumentId: string,
): Promise<StreamHandle> {
  const { stream_handle } = await client.allocateStream(matterHandle, seatToken);
  const streamHandle = parseStreamHandle(stream_handle);
  try {
    // The root-sync implementation passes this opaque handle with the root
    // update. The server commits it in the same transaction as that update.
    await addDocumentStreamToPrivateIndex(doc, { flush: () => rootSync.flush(streamHandle) }, localDocumentId, streamHandle);
  } catch (error) {
    // Leave the allocation provisional. It will disappear shortly if this
    // client crashes or cannot publish the encrypted directory update.
    throw error;
  }
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

/** Build a v1 index from a locally held legacy mapping; no value leaves Yjs ciphertext. */
export function migrateLegacyPrivateIndex(
  doc: Y.Doc,
  details: { clientName: string; displayName: string; rootStreamHandle: StreamHandle; documentStreams: Record<string, StreamHandle> },
): FirmMatterPrivateIndex {
  const streams: FirmMatterPrivateIndex['streams'] = {
    _notes: { streamHandle: details.rootStreamHandle, kind: 'notes' },
  };
  for (const [localId, streamHandle] of Object.entries(details.documentStreams)) {
    streams[localId] = { streamHandle, kind: 'document' };
  }
  const index: FirmMatterPrivateIndex = { version: 1, clientName: details.clientName, displayName: details.displayName, streams };
  writeFirmMatterPrivateIndex(doc, index);
  return index;
}

/** Keeps the opaque matter handle visibly part of the boundary in callers. */
export function privateIndexRoute(_matterHandle: MatterHandle, rootStreamHandle: StreamHandle): StreamHandle {
  return parseStreamHandle(rootStreamHandle);
}
