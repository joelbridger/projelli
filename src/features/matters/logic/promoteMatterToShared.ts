/** Promote a local matter without ever sending its name or ID to the relay. */
import * as Y from 'yjs';
import { useMatterStore } from '@/platform/matter/matterStore';
import { createLocalMatterKey, forgetMatterKey, publishMatterKeyToMembers } from '@/platform/firm/matterKeyService';
import { registerDevice } from '@/platform/firm/deviceKeys';
import { audit } from '@/features/matters/matterManagerDialogHelpers';
import { encryptUpdateV2, importMatterKey } from '@/platform/firm/matterCrypto';
import { writeFirmMatterPrivateIndex } from '@/platform/firm/firmMatterPrivateIndex';
import { useFirmStore } from '@/platform/firm/firmStore';
import { createOpaqueBlobId } from '@/platform/firm/opaqueBlobId';
import {
  clearPromotionPending,
  loadPromotionPending,
  storePromotionPending,
  type PromotionPendingRecord,
} from '@/platform/firm/firmKeychain';
import type { FirmApiClient } from '@/platform/firm/FirmApiClient';
import type { MatterHandle } from '@/platform/firm/contract';

export type PromoteMatterResult =
  | { status: 'shared'; matterId: string; firmMatterId: MatterHandle; orgId: string }
  | { status: 'failed'; matterId: string; error: string };

/**
 * Ordered v2 promotion:
 * provision opaque shell → local key → activate → encrypted root private index
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
  try {
    // Never create a visible relay shell unless this device can complete the
    // first authenticated write that makes the shell usable.
    if (!seatToken) throw new Error('A valid firm seat is required to share a client.');
    let pending = await loadPromotionPending(matterId);
    if (!pending) {
      const provision = await client.createMatter();
      const keyB64 = await createLocalMatterKey(provision.matter_handle);
      const root = new Y.Doc();
      writeFirmMatterPrivateIndex(root, {
        version: 1,
        clientName,
        displayName: clientName,
        streams: { _notes: { streamHandle: provision.root_stream_handle, kind: 'notes' } },
      });
      const key = await importMatterKey(keyB64);
      const rootCiphertextB64 = await encryptUpdateV2(key, Y.encodeStateAsUpdate(root), {
        keyEpoch: provision.key_epoch,
        matterHandle: provision.matter_handle,
        streamHandle: provision.root_stream_handle,
      });
      // Persist before activation: from here onward every uncertain server
      // result has one durable local handle, key, and idempotent root write.
      pending = {
        matterHandle: provision.matter_handle,
        rootStreamHandle: provision.root_stream_handle,
        keyEpoch: provision.key_epoch,
        keyB64,
        rootBlobId: createOpaqueBlobId(),
        rootCiphertextB64,
      } satisfies PromotionPendingRecord;
      await storePromotionPending(matterId, pending);
    }

    const handle = pending.matterHandle as MatterHandle;
    const rootStreamHandle = pending.rootStreamHandle;
    // The relay deliberately denies every write while a shell is provisioning.
    // Repeated activation is intentionally tolerated by the pending record:
    // if the first response was lost, the following idempotent root write is
    // the confirmation path rather than a reason to create another shell.
    await client.activateMatter(handle).catch((error) => {
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
    // Do not erase the only local key or pending record on an unknown network
    // outcome. A later run reuses the exact shell and root write, rather than
    // creating a second shell. Confirmed cleanup is handled by an explicit
    // retry path after the user chooses to stop sharing.
    return { status: 'failed', matterId, error: err instanceof Error ? err.message : String(err) };
  }
}
