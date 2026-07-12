/** Promote a local matter without ever sending its name or ID to the relay. */
import * as Y from 'yjs';
import { useMatterStore } from '@/platform/matter/matterStore';
import { createLocalMatterKey, forgetMatterKey, publishMatterKeyToMembers } from '@/platform/firm/matterKeyService';
import { registerDevice } from '@/platform/firm/deviceKeys';
import { audit } from '@/features/matters/matterManagerDialogHelpers';
import { encryptUpdateV2, importMatterKey } from '@/platform/firm/matterCrypto';
import { writeFirmMatterPrivateIndex } from '@/platform/firm/firmMatterPrivateIndex';
import { useFirmStore } from '@/platform/firm/firmStore';
import { createOpaqueBlobId, createOpaqueProvisioningNonce } from '@/platform/firm/opaqueBlobId';
import {
  clearPromotionPending,
  loadPromotionPending,
  storePromotionPending,
  type PromotionPendingRecord,
} from '@/platform/firm/firmKeychain';
import { FirmApiError, type FirmApiClient } from '@/platform/firm/FirmApiClient';
import type { MatterHandle } from '@/platform/firm/contract';

export type PromoteMatterResult =
  | { status: 'shared'; matterId: string; firmMatterId: MatterHandle; orgId: string }
  | { status: 'failed'; matterId: string; error: string };

/**
 * Ordered v2 promotion:
 * durable local retry receipt → provision opaque shell → local key → activate → encrypted root private index
 * → device registration/key distribution → local linkage. The original local
 * Matter.id and all human-readable details remain entirely on this device.
 */
export async function promoteMatterToShared(
  matterId: string,
  clientName: string,
  client: FirmApiClient,
): Promise<PromoteMatterResult> {
  const { linkFirmMatter } = useMatterStore.getState();
  const seatToken = useFirmStore.getState().seatToken;
  // Declared outside the try so the catch can distinguish a definite rejection
  // (archive the shell) from an unknown outcome (keep it and resume).
  let pending: PromotionPendingRecord | null = null;
  try {
    // Never create a visible relay shell unless this device can complete the
    // first authenticated write that makes the shell usable.
    if (!seatToken) throw new Error('A valid firm seat is required to share a client.');
    pending = await loadPromotionPending(matterId);
    if (!pending) {
      // This is deliberately the first durable step. If the relay commits but
      // its response is lost (or this device dies before saving the returned
      // handle), this nonce lets the next run ask for the SAME shell.
      pending = { provisioningNonce: createOpaqueProvisioningNonce() };
      await storePromotionPending(matterId, pending);
    }
    if (!pending.matterHandle) {
      const provision = await client.createMatter(pending.provisioningNonce);
      // Persist the handle before generating a key or private index. If this
      // write itself crashes, the earlier nonce-only record still resumes it.
      pending = {
        provisioningNonce: pending.provisioningNonce,
        matterHandle: provision.matter_handle,
        rootStreamHandle: provision.root_stream_handle,
        keyEpoch: provision.key_epoch,
      };
      await storePromotionPending(matterId, pending);
    }
    if (!pending.keyB64 || !pending.rootBlobId || !pending.rootCiphertextB64) {
      const provision = pending as Required<Pick<PromotionPendingRecord, 'matterHandle' | 'rootStreamHandle' | 'keyEpoch'>> & PromotionPendingRecord;
      const keyB64 = await createLocalMatterKey(provision.matterHandle as MatterHandle);
      const root = new Y.Doc();
      writeFirmMatterPrivateIndex(root, {
        version: 1,
        clientName,
        displayName: clientName,
        streams: { _notes: { streamHandle: provision.rootStreamHandle as never, kind: 'notes' } },
      });
      const key = await importMatterKey(keyB64);
      const rootCiphertextB64 = await encryptUpdateV2(key, Y.encodeStateAsUpdate(root), {
        keyEpoch: provision.keyEpoch,
        matterHandle: provision.matterHandle,
        streamHandle: provision.rootStreamHandle,
      });
      // Persist before activation: from here onward every uncertain server
      // result has one durable local handle, key, and idempotent root write.
      pending = {
        provisioningNonce: provision.provisioningNonce,
        matterHandle: provision.matterHandle,
        rootStreamHandle: provision.rootStreamHandle,
        keyEpoch: provision.keyEpoch,
        keyB64,
        rootBlobId: createOpaqueBlobId(),
        rootCiphertextB64,
      } satisfies PromotionPendingRecord;
      await storePromotionPending(matterId, pending);
    }

    if (!pending.matterHandle || !pending.rootStreamHandle || !pending.keyEpoch || !pending.keyB64 || !pending.rootBlobId || !pending.rootCiphertextB64) {
      throw new Error('The saved sharing retry record is incomplete.');
    }
    const handle = pending.matterHandle as MatterHandle;
    const rootStreamHandle = pending.rootStreamHandle;
    // The relay deliberately denies every write while a shell is provisioning.
    // Repeated activation is intentionally tolerated by the pending record:
    // if the first response was lost, the following idempotent root write is
    // the confirmation path rather than a reason to create another shell.
    await client.activateMatter(handle).catch((error: unknown) => {
      if (error instanceof Error && /404|matter_not_found/.test(error.message)) return;
      throw error;
    });
    await client.pushUpdate(handle, rootStreamHandle as never, pending.rootBlobId, pending.rootCiphertextB64, seatToken, pending.keyEpoch);
    await registerDevice(client);
    await publishMatterKeyToMembers(client, handle, pending.keyEpoch);

    const orgId = useFirmStore.getState().session?.org?.org_id ?? '';
    linkFirmMatter(matterId, { firmMatterId: handle, rootStreamHandle: rootStreamHandle as never, orgId, role: 'owner' });
    audit.append({
      type: 'matter_shared', timestamp: new Date().toISOString(),
      payload: { matter_id: matterId, firm_matter_id: handle, ...(orgId ? { org_id: orgId } : {}), detail: 'shared locally' },
    });
    await clearPromotionPending(matterId);
    return { status: 'shared', matterId, firmMatterId: handle, orgId };
  } catch (err) {
    // A DEFINITE rejection (the relay answered 4xx) and an UNKNOWN outcome
    // (timeout, abort, network) demand opposite handling — collapsing them is
    // how you get either an orphaned shell or a destroyed key:
    //
    //   definite  -> nothing committed. Archive the shell now so it cannot leak
    //                or consume quota, and drop the pending record.
    //   unknown   -> the write may have landed. Keep the pending record and the
    //                only local key; a later run resumes the SAME shell rather
    //                than creating a second one. Never archive on a guess.
    if (pending && err instanceof FirmApiError && err.status >= 400 && err.status < 500) {
      try {
        await client.archiveMatter(pending.matterHandle as MatterHandle);
      // eslint-disable-next-line lantern-async/no-silent-failure -- cleanup is deliberately best-effort after a definite rejection.
      } catch {
        // Best-effort cleanup after a definite rejection. Clearing the local
        // record below still makes a later user attempt use a fresh nonce.
      }
      await forgetMatterKey(pending.matterHandle as MatterHandle);
      await clearPromotionPending(matterId);
    }
    return { status: 'failed', matterId, error: err instanceof Error ? err.message : String(err) };
  }
}
