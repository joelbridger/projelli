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
  claimPromotionPending,
  clearPromotionPending,
  completePromotionPending,
  releasePromotionPendingLease,
  storePromotionPending,
  type PromotionPendingRecord,
} from '@/platform/firm/firmKeychain';
import { FirmApiError, type FirmApiClient } from '@/platform/firm/FirmApiClient';
import type { MatterHandle } from '@/platform/firm/contract';

export type PromoteMatterResult =
  | { status: 'shared'; matterId: string; firmMatterId: MatterHandle; orgId: string }
  | { status: 'failed'; matterId: string; error: string };

// A browser window can dispatch the same action twice before the first durable
// retry receipt is written. Coalesce those calls by local matter ID so they use
// one nonce, one relay shell, and one result. The keychain receipt remains the
// crash/restart guard; this only closes the in-process race.
const promotionsInFlight = new Map<string, Promise<PromoteMatterResult>>();

/** Each relay request gets a finite turn. A lost response is an unknown outcome,
 * so the durable receipt survives and the next click resumes the same shell. */
export const PROMOTION_REQUEST_TIMEOUT_MS = 20_000;
let promotionRequestTimeoutMs = PROMOTION_REQUEST_TIMEOUT_MS;

/** Test seam: production always uses the fixed 20-second relay deadline. */
export function _setPromotionRequestTimeoutForTests(timeoutMs: number): void {
  promotionRequestTimeoutMs = timeoutMs;
}

async function boundedPromotionRequest<T>(
  step: string,
  request: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    const error = new Error(`Sharing ${step} timed out. Please try again.`);
    error.name = 'TimeoutError';
    controller.abort(error);
  }, promotionRequestTimeoutMs);
  try {
    return await request(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

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
  const existing = promotionsInFlight.get(matterId);
  if (existing) return existing;

  const promotion = promoteMatterToSharedOnce(matterId, clientName, client);
  promotionsInFlight.set(matterId, promotion);
  try {
    return await promotion;
  } finally {
    if (promotionsInFlight.get(matterId) === promotion) promotionsInFlight.delete(matterId);
  }
}

async function promoteMatterToSharedOnce(
  matterId: string,
  clientName: string,
  client: FirmApiClient,
): Promise<PromoteMatterResult> {
  const { linkFirmMatter } = useMatterStore.getState();
  const seatToken = useFirmStore.getState().seatToken;
  // Declared outside the try so the catch can distinguish a definite rejection
  // (archive the shell) from an unknown outcome (keep it and resume).
  let pending: PromotionPendingRecord | null = null;
  let leaseOwnerId: string | null = null;
  try {
    // Never create a visible relay shell unless this device can complete the
    // first authenticated write that makes the shell usable.
    if (!seatToken) throw new Error('A valid firm seat is required to share a client.');
    // The receipt is the cross-window lock. Do not use a read-then-write here:
    // another JavaScript window may be doing exactly the same thing.
    for (;;) {
      const claim = await claimPromotionPending(matterId);
      pending = claim.record;
      leaseOwnerId = claim.ownerId;
      if (pending.completed) {
        if (!pending.matterHandle || !pending.rootStreamHandle) throw new Error('The saved sharing receipt is incomplete.');
        const orgId = pending.orgId ?? useFirmStore.getState().session?.org?.org_id ?? '';
        linkFirmMatter(matterId, { firmMatterId: pending.matterHandle as MatterHandle, rootStreamHandle: pending.rootStreamHandle as never, orgId, role: 'owner' });
        return { status: 'shared', matterId, firmMatterId: pending.matterHandle as MatterHandle, orgId };
      }
      if (claim.owned) break;
      // The other window has a live lease. Let it finish or expire; then claim
      // and resume the exact saved nonce/handle, never make another shell.
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    if (!pending.matterHandle) {
      const provision = await boundedPromotionRequest('the relay setup', (signal) => client.createMatter(pending!.provisioningNonce, signal));
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
    const keyEpoch = pending.keyEpoch;
    // The relay deliberately denies every write while a shell is provisioning.
    // Repeated activation is intentionally tolerated by the pending record:
    // if the first response was lost, the following idempotent root write is
    // the confirmation path rather than a reason to create another shell.
    await boundedPromotionRequest('activation', (signal) => client.activateMatter(handle, signal)).catch((error: unknown) => {
      if (error instanceof Error && /404|matter_not_found/.test(error.message)) return;
      throw error;
    });
    if (!pending.rootWriteAccepted) {
      await boundedPromotionRequest('the encrypted first save', (signal) => client.pushUpdate(handle, rootStreamHandle as never, pending!.rootBlobId!, pending!.rootCiphertextB64!, seatToken, keyEpoch, signal));
      // The relay now has encrypted client data. Persist this phase before any
      // later work so a fresh session knows to resume, never destroy, it.
      pending = { ...pending, rootWriteAccepted: true };
      await storePromotionPending(matterId, pending);
    }
    await boundedPromotionRequest('device registration', (signal) => registerDevice(client, signal));
    await boundedPromotionRequest('key sharing', (signal) => publishMatterKeyToMembers(client, handle, keyEpoch, signal));

    const orgId = useFirmStore.getState().session?.org?.org_id ?? '';
    await completePromotionPending(matterId, leaseOwnerId!, pending, orgId);
    linkFirmMatter(matterId, { firmMatterId: handle, rootStreamHandle: rootStreamHandle as never, orgId, role: 'owner' });
    audit.append({
      type: 'matter_shared', timestamp: new Date().toISOString(),
      payload: { matter_id: matterId, firm_matter_id: handle, ...(orgId ? { org_id: orgId } : {}), detail: 'shared locally' },
    });
    return { status: 'shared', matterId, firmMatterId: handle, orgId };
  } catch (err) {
    // A DEFINITE rejection (the relay answered 4xx) and an UNKNOWN outcome
    // (timeout, abort, network) demand opposite handling — but only before the
    // first encrypted root write. Once that write is accepted, the relay holds
    // recoverable client data, so every failure must preserve the local key and
    // durable receipt for a later retry.
    //
    //   definite before root write -> nothing committed. Archive the shell now
    //                                 and discard its local recovery material.
    //   all other cases            -> preserve the receipt and key; the next
    //                                 run resumes this exact shell.
    if (pending && !pending.rootWriteAccepted && err instanceof FirmApiError && err.status >= 400 && err.status < 500) {
      if (pending.matterHandle) {
        try {
          await boundedPromotionRequest('relay cleanup', (signal) => client.archiveMatter(pending!.matterHandle as MatterHandle, signal));
        // eslint-disable-next-line lantern-async/no-silent-failure -- cleanup is deliberately best-effort after a definite rejection before any client data is committed.
        } catch {
          // Best-effort cleanup after a definite rejection. Clearing the local
          // record below still makes a later user attempt use a fresh nonce.
        }
        await forgetMatterKey(pending.matterHandle as MatterHandle);
      }
      await clearPromotionPending(matterId);
    }
    return { status: 'failed', matterId, error: err instanceof Error ? err.message : String(err) };
  } finally {
    // A timeout/abort never deletes recovery material, but it must not leave a
    // local waiter stuck behind this window. The next attempt adopts the same
    // durable receipt immediately (or after a crash, when its lease expires).
    if (leaseOwnerId) await releasePromotionPendingLease(matterId, leaseOwnerId);
  }
}
