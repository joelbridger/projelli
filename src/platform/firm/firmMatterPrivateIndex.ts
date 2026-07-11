/**
 * Encrypted device-side directory for a shared client.
 *
 * This map lives inside the encrypted root Yjs stream. Its keys are local
 * document IDs and are never copied into a relay path, query, body, or frame.
 */
import * as Y from 'yjs';
import type { StreamHandle } from './contract';
import { generateStreamHandle, parseStreamHandle } from './contract';

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
 * Record a client-generated document stream in the encrypted root index.
 * Yjs carries this local change to peers when the root stream next syncs; an
 * unused handle never reaches the relay and therefore needs no cleanup.
 */
export function addDocumentStreamToPrivateIndex(
  doc: Y.Doc,
  localDocumentId: string,
  streamHandle: StreamHandle,
): void {
  const current = readFirmMatterPrivateIndex(doc);
  if (!current) throw new Error('Cannot add a document stream before the private index exists.');
  const existing = current.streams[localDocumentId];
  if (existing?.streamHandle === streamHandle) return;
  const streamsMap = getStreamsV2Map(doc);
  doc.transact(() => {
    streamsMap.set(localDocumentId, { streamHandle, kind: 'document' });
  });
}

/**
 * Create an opaque stream handle locally and immediately record its encrypted
 * root-index mapping. The first actual ciphertext write binds it at the relay.
 */
export function createDocumentStream(
  doc: Y.Doc,
  localDocumentId: string,
): StreamHandle {
  const streamHandle = generateStreamHandle();
  addDocumentStreamToPrivateIndex(doc, localDocumentId, streamHandle);
  return streamHandle;
}

/** Tombstone a local document mapping without exposing the local ID to the relay. */
export function tombstoneDocumentStreamFromPrivateIndex(doc: Y.Doc, localDocumentId: string): void {
  const current = readFirmMatterPrivateIndex(doc);
  if (!current || !current.streams[localDocumentId]) return;
  doc.transact(() => {
    const legacyStreams = readLegacyStreams(doc.getMap<unknown>(FIRM_PRIVATE_INDEX_MAP).get('streams'));
    const streamsMap = getStreamsV2Map(doc);
    if (Object.prototype.hasOwnProperty.call(legacyStreams, localDocumentId)) streamsMap.set(localDocumentId, { tombstone: true });
    else streamsMap.delete(localDocumentId);
  });
}
