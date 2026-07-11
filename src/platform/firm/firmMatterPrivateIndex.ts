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
const INDEX_VERSION = 1;

export interface FirmMatterPrivateIndex {
  version: 1;
  clientName: string;
  displayName: string;
  streams: Record<string, { streamHandle: StreamHandle; kind: 'notes' | 'document' }>;
}

export interface RootIndexSync {
  flush(): Promise<void>;
}

function stringField(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`Malformed private index: ${name}.`);
  return value;
}

/** Read and validate the dedicated map. Corrupt state never becomes routing data. */
export function readFirmMatterPrivateIndex(doc: Y.Doc): FirmMatterPrivateIndex | null {
  const map = doc.getMap<unknown>(FIRM_PRIVATE_INDEX_MAP);
  if (map.size === 0) return null;
  if (map.get('version') !== INDEX_VERSION) throw new Error('Malformed private index: version.');
  const rawStreams = map.get('streams');
  if (!rawStreams || typeof rawStreams !== 'object' || Array.isArray(rawStreams)) {
    throw new Error('Malformed private index: streams.');
  }
  const streams: FirmMatterPrivateIndex['streams'] = {};
  for (const [localId, entry] of Object.entries(rawStreams as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Malformed private index: stream.');
    const candidate = entry as Record<string, unknown>;
    const kind = candidate['kind'];
    if (kind !== 'notes' && kind !== 'document') throw new Error('Malformed private index: stream kind.');
    streams[localId] = { streamHandle: parseStreamHandle(stringField(candidate['streamHandle'], 'stream handle')), kind };
  }
  return {
    version: 1,
    clientName: stringField(map.get('clientName'), 'clientName'),
    displayName: stringField(map.get('displayName'), 'displayName'),
    streams,
  };
}

/** Initialize the root index before the provisioning shell is activated. */
export function writeFirmMatterPrivateIndex(doc: Y.Doc, index: FirmMatterPrivateIndex): void {
  // Validate before changing Yjs state, so a bad server response cannot poison it.
  const checked = { ...index, streams: { ...index.streams } };
  for (const entry of Object.values(checked.streams)) parseStreamHandle(entry.streamHandle);
  doc.transact(() => {
    const map = doc.getMap<unknown>(FIRM_PRIVATE_INDEX_MAP);
    map.set('version', INDEX_VERSION);
    map.set('clientName', checked.clientName);
    map.set('displayName', checked.displayName);
    map.set('streams', checked.streams);
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
  writeFirmMatterPrivateIndex(doc, {
    ...current,
    streams: { ...current.streams, [localDocumentId]: { streamHandle, kind: 'document' } },
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
  doc: Y.Doc,
  rootSync: RootIndexSync,
  localDocumentId: string,
): Promise<StreamHandle> {
  const { stream_handle } = await client.allocateStream(matterHandle);
  const streamHandle = parseStreamHandle(stream_handle);
  await addDocumentStreamToPrivateIndex(doc, rootSync, localDocumentId, streamHandle);
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
  const streams = { ...current.streams };
  delete streams[localDocumentId];
  writeFirmMatterPrivateIndex(doc, { ...current, streams });
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
