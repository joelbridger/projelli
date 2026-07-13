/**
 * Encrypted device-side directory for a shared client.
 *
 * This map lives inside the encrypted root Yjs stream. Its keys are local
 * document IDs and are never copied into a relay path, query, body, or frame.
 */
import * as Y from 'yjs';
import type { MatterHandle, StreamHandle } from './contract';
import { generateStreamHandle, parseStreamHandle } from './contract';
import { pinDocumentStreamOnFirstObservation, RetiredDocumentStreamPinError, retirePinnedDocumentStream } from './firmKeychain';

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
export async function addDocumentStreamToPrivateIndex(
  doc: Y.Doc,
  matterHandle: MatterHandle,
  localDocumentId: string,
  streamHandle: StreamHandle,
): Promise<void> {
  const current = readFirmMatterPrivateIndex(doc);
  if (!current) throw new Error('Cannot add a document stream before the private index exists.');
  const existing = current.streams[localDocumentId];
  const pinned = await pinDocumentStreamOnFirstObservation(matterHandle, localDocumentId, streamHandle);
  if (pinned !== streamHandle) {
    throw new Error('This document is already pinned to a different encrypted stream on this device.');
  }
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
export async function createDocumentStream(
  doc: Y.Doc,
  matterHandle: MatterHandle,
  localDocumentId: string,
): Promise<StreamHandle> {
  const streamHandle = generateStreamHandle();
  try {
    await addDocumentStreamToPrivateIndex(doc, matterHandle, localDocumentId, streamHandle);
  } catch (error) {
    if (error instanceof RetiredDocumentStreamPinError) {
      throw new Error('This document name or ID was already used and deleted. Choose a different one.');
    }
    throw error;
  }
  return streamHandle;
}

/**
 * Pin document mappings when a device first opens an existing shared matter.
 * A later mismatch is returned to the caller for loud diagnostics; this read
 * path never mutates the shared CRDT or overwrites the local trusted value.
 */
export async function observeDocumentStreamsForPinning(
  doc: Y.Doc,
  matterHandle: MatterHandle,
): Promise<Array<
  | { localDocumentId: string; kind: 'mismatch'; pinnedStreamHandle: StreamHandle; observedStreamHandle: StreamHandle }
  | { localDocumentId: string; kind: 'retired'; observedStreamHandle: StreamHandle }
>> {
  const streams = readFirmMatterPrivateIndex(doc)?.streams ?? {};
  const mismatches: Array<
    | { localDocumentId: string; kind: 'mismatch'; pinnedStreamHandle: StreamHandle; observedStreamHandle: StreamHandle }
    | { localDocumentId: string; kind: 'retired'; observedStreamHandle: StreamHandle }
  > = [];
  for (const [localDocumentId, stream] of Object.entries(streams)) {
    if (stream.kind !== 'document') continue;
    let pinnedStreamHandle: StreamHandle;
    try {
      pinnedStreamHandle = await pinDocumentStreamOnFirstObservation(matterHandle, localDocumentId, stream.streamHandle);
    } catch (error) {
      if (error instanceof RetiredDocumentStreamPinError) {
        mismatches.push({ localDocumentId, kind: 'retired', observedStreamHandle: stream.streamHandle });
        continue;
      }
      throw error;
    }
    if (pinnedStreamHandle !== stream.streamHandle) {
      mismatches.push({ localDocumentId, kind: 'mismatch', pinnedStreamHandle, observedStreamHandle: stream.streamHandle });
    }
  }
  return mismatches;
}

/** Tombstone a local document mapping and permanently retire its routing pin. */
export async function tombstoneDocumentStreamFromPrivateIndex(
  doc: Y.Doc,
  matterHandle: MatterHandle,
  localDocumentId: string,
): Promise<void> {
  const current = readFirmMatterPrivateIndex(doc);
  const stream = current?.streams[localDocumentId];
  if (!stream) return;
  if (stream.kind !== 'document') throw new Error('Cannot tombstone a non-document stream.');
  try {
    const pinned = await pinDocumentStreamOnFirstObservation(matterHandle, localDocumentId, stream.streamHandle);
    if (pinned !== stream.streamHandle) {
      throw new Error('Document deletion was blocked because its encrypted stream mapping changed on this device.');
    }
  } catch (error) {
    // A matching remembered handle means this is the safe second half of a
    // crash-interrupted deletion. A different one is still a redirection.
    if (!(error instanceof RetiredDocumentStreamPinError) || !error.canResumeDeletion) throw error;
  }
  await retirePinnedDocumentStream(matterHandle, localDocumentId);
  doc.transact(() => {
    const currentStream = readFirmMatterPrivateIndex(doc)?.streams[localDocumentId];
    if (currentStream?.kind !== 'document' || currentStream.streamHandle !== stream.streamHandle) {
      throw new Error('Document deletion was blocked because its encrypted stream mapping changed on this device.');
    }
    const legacyStreams = readLegacyStreams(doc.getMap<unknown>(FIRM_PRIVATE_INDEX_MAP).get('streams'));
    const streamsMap = getStreamsV2Map(doc);
    if (Object.prototype.hasOwnProperty.call(legacyStreams, localDocumentId)) streamsMap.set(localDocumentId, { tombstone: true });
    else streamsMap.delete(localDocumentId);
  });
}
