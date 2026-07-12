/** Safely reclaim a deleted document's opaque relay stream. */
import type * as Y from 'yjs';
import type { FirmApiClient } from './FirmApiClient';
import type { MatterSyncClient } from './MatterSyncClient';
import type { MatterHandle, StreamHandle } from './contract';
import {
  readFirmMatterPrivateIndex,
  tombstoneDocumentStreamFromPrivateIndex,
} from './firmMatterPrivateIndex';
import { getPinnedDocumentStream, pinDocumentStreamOnFirstObservation, RetiredDocumentStreamPinError } from './firmKeychain';

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
  // TOFU is intentionally local-only: on a device's first-ever observation,
  // it trusts the then-current encrypted directory value. That cannot detect a
  // mapping poisoned before this device joined; it does stop later rewrites
  // from redirecting this device's destructive release to another stream.
  const stream = readFirmMatterPrivateIndex(input.doc)?.streams[input.localDocumentId];
  let pinnedStreamHandle: StreamHandle;
  if (!stream) {
    // The CRDT tombstone made it out before the crash. A remembered retired
    // handle is the only safe authority for finishing the relay release.
    try {
      await getPinnedDocumentStream(input.matterHandle, input.localDocumentId);
      // A non-retired (or absent) pin with no CRDT entry left to authorize a
      // release is not a resumable deletion — there is nothing safe to do.
      throw new Error('Document stream is not available for release.');
    } catch (error) {
      if (!(error instanceof RetiredDocumentStreamPinError) || !error.canResumeDeletion || !error.handle) throw error;
      pinnedStreamHandle = error.handle;
    }
  } else {
    if (stream.kind !== 'document') throw new Error('Document stream is not available for release.');
    try {
      pinnedStreamHandle = await pinDocumentStreamOnFirstObservation(
        input.matterHandle,
        input.localDocumentId,
        stream.streamHandle,
      );
    } catch (error) {
      if (!(error instanceof RetiredDocumentStreamPinError) || !error.canResumeDeletion || !error.handle) throw error;
      pinnedStreamHandle = error.handle;
    }
  }
  // Re-read the shared value immediately before the destructive operation.
  // The device-local pin, not this mutable CRDT entry, is the authorization
  // evidence for choosing which opaque relay stream may be released.
  const current = readFirmMatterPrivateIndex(input.doc)?.streams[input.localDocumentId];
  if ((current && (current.kind !== 'document' || current.streamHandle !== pinnedStreamHandle))) {
    console.error('[releaseDocumentStream] blocked suspected document-stream redirection', {
      matterHandle: input.matterHandle,
      localDocumentId: input.localDocumentId,
      pinnedStreamHandle,
      observedStreamHandle: current.streamHandle,
    });
    throw new Error('Document deletion was blocked because its encrypted stream mapping changed on this device.');
  }

  await tombstoneDocumentStreamFromPrivateIndex(input.doc, input.matterHandle, input.localDocumentId);
  // This is the important ordering: peers receive the encrypted directory
  // deletion before the relay drops the opaque document ciphertext/history.
  await input.rootSync.flush();
  await input.client.releaseMatterStream(input.matterHandle, pinnedStreamHandle);
  return pinnedStreamHandle;
}
