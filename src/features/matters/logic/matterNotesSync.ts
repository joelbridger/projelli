/**
 * matterNotesSync — per-matter singleton lifecycle manager for live notes sync.
 *
 * Each shared matter gets at most ONE MatterSyncClient. This module owns that
 * client cache. Call `ensureMatterSync` to get (or create) the client for a
 * matter; call `stopMatterSync` or `stopAll` to tear it down on unshare/sign-out.
 *
 * Fail-closed contract:
 *   - Requires an active firm session (firmStore tokens) + matter.shared + firmMatterId.
 *   - If `obtainMatterKey` returns null (403/404 from server, or local miss),
 *     `ensureMatterSync` returns null. Callers must render the fail-closed state.
 *   - Key epoch advances (member removed, wall set) are handled here: we re-fetch
 *     via keys/fetch + rotateKey, or set status 'error' if that fails (403/404).
 */

import type { Matter } from '@/platform/types/matter';
import { MatterSyncClient } from '@/platform/firm/MatterSyncClient';
import { obtainMatterKey } from '@/platform/firm/matterKeyService';
import { clearMatterKey, storeMatterKey } from '@/platform/firm/firmKeychain';
import { getOrCreateDeviceKeypair } from '@/platform/firm/deviceKeys';
import { unwrapMatterKey } from '@/platform/firm/keyWrap';
import { FirmApiError } from '@/platform/firm/FirmApiClient';
import { parseMatterHandle, parseStreamHandle } from '@/platform/firm/contract';
import type { MatterHandle } from '@/platform/firm/contract';
import { observeDocumentStreamsForPinning, readFirmMatterPrivateIndex } from '@/platform/firm/firmMatterPrivateIndex';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useMatterSyncStore } from '@/platform/matter/matterSyncStore';
import { useFirmStore } from '@/platform/firm/firmStore';

/** One resolved client per local matter id (post-construction). */
const clientCache = new Map<string, MatterSyncClient>();

/**
 * Promise-singleton cache: keyed at function ENTRY so concurrent calls share
 * the same construction promise and never double-construct a WebSocket client.
 * The entry is deleted on null/error resolution so a retry can try again.
 */
const pendingCache = new Map<string, Promise<MatterSyncClient | null>>();
/** One key-refresh loop per local matter; notifications may arrive out of order. */
const keyRotationCache = new Map<string, { targetEpoch: number; promise: Promise<void> }>();
/** A burst of real rotations is possible; an unbounded loop is never safe. */
const MAX_KEY_ROTATION_ATTEMPTS = 8;

/**
 * Ensure a running MatterSyncClient exists for the given matter. Returns null
 * when the preconditions are not met (no firm session, matter not shared, key
 * unavailable / walled).
 *
 * Singleton: concurrent calls share a single construction promise keyed at
 * entry so React StrictMode double-effects and other concurrent callers never
 * double-construct or orphan a live WebSocket.
 *
 * @param localMatter - The local Matter record. Must be shared with a firmMatterId.
 * @param keyEpoch - The current key epoch from the server (e.g. MatterMineSummary.key_epoch
 *                   from /matter/mine, or from the createMatter/addMatterMember response).
 *                   When omitted, the epoch is resolved here via /matter/mine so pushes
 *                   are never mistagged on matters past epoch 1.
 */
export function ensureMatterSync(
  localMatter: Matter,
  keyEpoch?: number,
): Promise<MatterSyncClient | null> {
  // 1. Must be a shared matter with a firm backend ID.
  if (!localMatter.shared || !localMatter.firmMatterId || !localMatter.rootStreamHandle) return Promise.resolve(null);

  // 2. Must have an active firm session (access token + seat token).
  const firmState = useFirmStore.getState();
  const seatToken = firmState.seatToken;
  if (!seatToken) return Promise.resolve(null);

  const localMatterId = localMatter.id;

  // 3. Return the already-resolved cached client.
  const existing = clientCache.get(localMatterId);
  if (existing) return Promise.resolve(existing);

  // 4. Return or create a pending promise (promise-singleton pattern).
  //    Caching the Promise at entry prevents double-construction under concurrent
  //    awaits (e.g. React StrictMode double-effect).
  const pending = pendingCache.get(localMatterId);
  if (pending) return pending;

  const promise = _buildMatterSyncClient(localMatter, keyEpoch, seatToken, firmState).then(
    (client) => {
      pendingCache.delete(localMatterId);
      if (client) clientCache.set(localMatterId, client);
      return client;
    },
    (err: unknown) => {
      pendingCache.delete(localMatterId);
      throw err;
    },
  );
  pendingCache.set(localMatterId, promise);
  return promise;
}

async function _buildMatterSyncClient(
  localMatter: Matter,
  keyEpoch: number | undefined,
  seatToken: string,
  firmState: ReturnType<typeof useFirmStore.getState>,
): Promise<MatterSyncClient | null> {
  const localMatterId = localMatter.id;
  const firmMatterId = parseMatterHandle(localMatter.firmMatterId!);
  const rootStreamHandle = parseStreamHandle(localMatter.rootStreamHandle!);

  // Obtain the matter key (local keychain → server fetch → null on wall/miss).
  const firmClient = firmState.client();
  const keyB64 = await obtainMatterKey(firmClient, firmMatterId, seatToken);
  if (!keyB64) {
    // Fail closed: walled or key not published yet.
    useMatterSyncStore.getState().setStatus(localMatterId, 'error');
    return null;
  }

  // Resolve the real key epoch when the caller did not supply one. Pushes
  // are tagged with this epoch, so starting at a stale value mistags them
  // until the relay corrects us; one /matter/mine call avoids that window.
  let epoch = keyEpoch;
  if (epoch === undefined) {
    try {
      const mine = await firmClient.matterMine(seatToken);
      epoch = mine.matters.find((m) => m.matter_handle === firmMatterId)?.key_epoch ?? 1;
    } catch {
      epoch = 1; // offline/unreachable: start at 1; the relay signals the real epoch
    }
  }

  // Construct the client with callbacks wired to the sync store.
  const client = new MatterSyncClient({
    matterHandle: firmMatterId,
    streamHandle: rootStreamHandle,
    keyB64,
    keyEpoch: epoch,
    seatToken,
    client: firmClient,
    callbacks: {
      onStatus: (status) => {
        useMatterSyncStore.getState().setStatus(localMatterId, status);
      },
      onRemoteUpdate: () => {
        // Remote update applied to the doc — store status already set by onStatus.
        // Callers bind to the Y.Text/Y.Doc directly for live content updates.
      },
      onUpdateQuarantined: ({ reason }) => {
        useMatterSyncStore.getState().reportQuarantinedUpdate(localMatterId, reason);
      },
      onKeyEpochAdvanced: ((newEpoch: number) => handleKeyEpochAdvanced(localMatterId, firmMatterId, firmClient, client, newEpoch)) as unknown as (newEpoch: number) => void,
    },
  });

  // Start sync (catch-up + WebSocket).
  await client.start();

  // A newly authorized device starts with a generic local placeholder. Once it
  // has the wrapped key and decrypts this root stream, only then may it learn
  // the local display/client names.
  const privateIndex = readFirmMatterPrivateIndex(client.doc);
  if (privateIndex) {
    const pinMismatches = await observeDocumentStreamsForPinning(client.doc, firmMatterId);
    for (const mismatch of pinMismatches) {
      console.error('[matterNotesSync] observed changed document stream mapping', {
        matterHandle: firmMatterId,
        ...mismatch,
      });
    }
    useMatterStore.getState().renameMatter(localMatterId, {
      name: privateIndex.displayName,
      client: privateIndex.clientName,
    });
  }

  // 8. Seed the doc meta map if it is empty (first writer sets it once).
  //    This gives the notes surface a stable {name, client_name} so new
  //    members see the matter name even before any notes are typed.
  const meta = client.doc.getMap<string>('meta');
  if (!meta.get('name')) {
    client.doc.transact(() => {
      meta.set('name', localMatter.name);
      meta.set('client_name', localMatter.client);
    });
  }

  return client;
}

/**
 * Handle a key epoch advance: clear the stale local key, re-fetch and unwrap
 * the new epoch's key from the server, then rotate the client's in-memory key.
 *
 * On 403/404 (walled or key not yet published), clears the old keychain entry
 * so the screened user's machine does not attempt to reconstruct a client from
 * a stale key, then stops the sync client. The next open attempt will show the
 * true fail-closed panel rather than a half-alive client.
 */
export async function handleKeyEpochAdvanced(
  localMatterId: string,
  firmMatterId: MatterHandle,
  firmClient: ReturnType<ReturnType<typeof useFirmStore.getState>['client']>,
  client: MatterSyncClient,
  newEpoch: number,
): Promise<void> {
  const existing = keyRotationCache.get(localMatterId);
  if (existing) {
    existing.targetEpoch = Math.max(existing.targetEpoch, newEpoch);
    return existing.promise;
  }

  const state = { targetEpoch: newEpoch, promise: Promise.resolve() };
  state.promise = (async () => {
    const seatToken = useFirmStore.getState().seatToken ?? '';
    const { deviceId } = await getOrCreateDeviceKeypair();

    for (let attempt = 0; attempt < MAX_KEY_ROTATION_ATTEMPTS; attempt += 1) {
      // Notifications are only hints from the untrusted relay. Remember the
      // epoch that prompted this fetch so a fabricated high value cannot turn
      // the cached hint into an unreachable retry target.
      const requestedEpoch = state.targetEpoch;
      // Clear the old keychain entry first so obtainMatterKey does a fresh server
      // fetch rather than returning the stale epoch's blob.
      await clearMatterKey(firmMatterId);

      let fetchResp: { epoch: number; wrapped_key_b64: string };
      try {
        fetchResp = await firmClient.fetchMatterKeys(firmMatterId, deviceId, seatToken);
      } catch (err) {
        if (err instanceof FirmApiError && (err.status === 403 || err.status === 404)) {
          // Walled (403) or key not published for new epoch (404) — fail closed.
          // The old key has already been cleared above, so the next ensureMatterSync
          // will hit the server again and surface the proper fail-closed panel.
          stopMatterSync(localMatterId);
          return;
        }
        throw err;
      }

      // The notification is only a hint. The fetch response is authoritative:
      // its wrapped key and epoch are one atomic server snapshot.
      const newKeyB64 = await unwrapMatterKey(fetchResp.wrapped_key_b64, fetchResp.epoch);
      await storeMatterKey(firmMatterId, newKeyB64);
      await client.rotateKey(newKeyB64, fetchResp.epoch);

      // fetchMatterKeys returns the key and its epoch as one authoritative
      // server snapshot. If it is behind the relay hint, we have still rotated
      // to the server's real current key; do not chase an attacker-controlled
      // epoch forever. A later genuine advance will notify us again.
      if (fetchResp.epoch < requestedEpoch) return;

      // A second removal/wall can advance the epoch between fetch and rotate.
      // Re-check and repeat from the newly fetched key rather than tagging it
      // with the stale notification epoch.
      const mine = await firmClient.matterMine(seatToken);
      const observedEpoch = mine.matters.find((matter) => matter.matter_handle === firmMatterId)?.key_epoch ?? fetchResp.epoch;
      state.targetEpoch = Math.max(state.targetEpoch, observedEpoch);
      if (state.targetEpoch <= fetchResp.epoch) return;
    }

    // Never let even a rapid sequence of genuine rotations spin indefinitely.
    // This matches the existing walled-key behavior: stop this client and
    // require a fresh, fail-closed start before syncing again.
    stopMatterSync(localMatterId);
    useMatterSyncStore.getState().setStatus(localMatterId, 'error');
  })().catch((err: unknown) => {
    console.error('[matterNotesSync] key epoch advance failed:', err);
    useMatterSyncStore.getState().setStatus(localMatterId, 'error');
  }).finally(() => {
    keyRotationCache.delete(localMatterId);
  });
  keyRotationCache.set(localMatterId, state);
  return state.promise;
}

/** Stop and remove the sync client for a matter. Idempotent. */
export function stopMatterSync(localMatterId: string): void {
  pendingCache.delete(localMatterId);
  keyRotationCache.delete(localMatterId);
  const client = clientCache.get(localMatterId);
  if (!client) return;
  client.stop();
  clientCache.delete(localMatterId);
  useMatterSyncStore.getState().clearMatter(localMatterId);
}

/** Stop all running sync clients (e.g. on sign-out). */
export function stopAll(): void {
  pendingCache.clear();
  keyRotationCache.clear();
  for (const [id, client] of clientCache.entries()) {
    try {
      client.stop();
    } catch {
      // One throwing client must not abort teardown of the rest.
    }
    useMatterSyncStore.getState().clearMatter(id);
  }
  clientCache.clear();
}

/** Retrieve the cached client for a matter (null if not started). */
export function getMatterSyncClient(localMatterId: string): MatterSyncClient | null {
  return clientCache.get(localMatterId) ?? null;
}

// ── Auto-teardown on sign-out ─────────────────────────────────────────────────
// Subscribe to the firm store once at module load. When the seat token is
// cleared (sign-out path), stop all sync clients immediately. This avoids a
// dynamic import of this module inside firmStore.ts (which would create a
// circular dependency at parse time, since firmStore is imported here).
useFirmStore.subscribe((state, prev) => {
  if (prev.seatToken && !state.seatToken) {
    stopAll();
  }
});
