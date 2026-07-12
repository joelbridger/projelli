/** Safely reclaim a deleted document's opaque relay stream. */
import type * as Y from 'yjs';
import type { FirmApiClient } from './FirmApiClient';
import type { MatterSyncClient } from './MatterSyncClient';
import type { MatterHandle, StreamHandle } from './contract';
import {
  readFirmMatterPrivateIndex,
  tombstoneDocumentStreamFromPrivateIndex,
} from './firmMatterPrivateIndex';

/**
 * Publish the encrypted tombstone first, then ask the relay's recorded owner
 * to release the opaque stream slot. The relay never sees the local document
 * ID; it only receives the already-opaque stream handle.
 */
export async function tombstoneAndReleaseDocumentStream(input: {
  doc: Y.Doc;
  localDocumentId: string;
  matterHandle: MatterHandle;
  rootSync: MatterSyncClient;
  client: FirmApiClient;
}): Promise<StreamHandle> {
  const stream = readFirmMatterPrivateIndex(input.doc)?.streams[input.localDocumentId];
  if (!stream || stream.kind !== 'document') throw new Error('Document stream is not available for release.');

  tombstoneDocumentStreamFromPrivateIndex(input.doc, input.localDocumentId);
  // This is the important ordering: peers receive the encrypted directory
  // deletion before the relay drops the opaque document ciphertext/history.
  await input.rootSync.flush();
  await input.client.releaseMatterStream(input.matterHandle, stream.streamHandle);
  return stream.streamHandle;
}
