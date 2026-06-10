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

import type { Matter } from '@/types/matter';
import { MatterSyncClient } from '@/modules/firm/MatterSyncClient';
import { obtainMatterKey } from '@/modules/firm/matterKeyService';
import { useMatterSyncStore } from '@/stores/matterSyncStore';
import { useFirmStore } from '@/stores/firmStore';

/** One client per local matter id. */
const clientCache = new Map<string, MatterSyncClient>();

/**
 * Ensure a running MatterSyncClient exists for the given matter. Returns null
 * when the preconditions are not met (no firm session, matter not shared, key
 * unavailable / walled).
 *
 * Idempotent: calling again while a client is already running returns the
 * cached instance without re-connecting.
 */
export async function ensureMatterSync(localMatter: Matter): Promise<MatterSyncClient | null> {
  // 1. Must be a shared matter with a firm backend ID.
  if (!localMatter.shared || !localMatter.firmMatterId) return null;

  // 2. Must have an active firm session (access token + seat token).
  const firmState = useFirmStore.getState();
  const seatToken = firmState.seatToken;
  if (!seatToken) return null;

  const localMatterId = localMatter.id;
  const firmMatterId = localMatter.firmMatterId;

  // 3. Return the cached client if already running.
  const existing = clientCache.get(localMatterId);
  if (existing) return existing;

  // 4. Obtain the matter key (local keychain → server fetch → null on wall/miss).
  const firmClient = firmState.client();
  const keyB64 = await obtainMatterKey(firmClient, firmMatterId, seatToken);
  if (!keyB64) {
    // Fail closed: walled or key not published yet.
    useMatterSyncStore.getState().setStatus(localMatterId, 'error');
    return null;
  }

  // 5. Construct the client with callbacks wired to the sync store.
  const client = new MatterSyncClient({
    matterId: firmMatterId,
    keyB64,
    keyEpoch: 1,
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
      onKeyEpochAdvanced: (newEpoch) => {
        void handleKeyEpochAdvanced(localMatterId, firmMatterId, firmClient, client, newEpoch);
      },
    },
  });

  // 6. Cache before start so concurrent calls don't double-construct.
  clientCache.set(localMatterId, client);

  // 7. Start sync (catch-up + WebSocket).
  await client.start();

  return client;
}

/**
 * Handle a key epoch advance: re-fetch the new epoch's key from the server and
 * rotate the client's in-memory key. On 403/404 (walled), set status 'error'.
 */
async function handleKeyEpochAdvanced(
  localMatterId: string,
  firmMatterId: string,
  firmClient: ReturnType<ReturnType<typeof useFirmStore.getState>['client']>,
  client: MatterSyncClient,
  newEpoch: number,
): Promise<void> {
  try {
    // Re-obtain the key for the new epoch: local keychain won't have it for the
    // new epoch (our stored blob was for the old epoch), so this goes to server.
    // We clear the local cache first so obtainMatterKey does a fresh fetch.
    const { clearMatterKey, storeMatterKey } = await import('@/modules/firm/firmKeychain');
    const { getOrCreateDeviceKeypair } = await import('@/modules/firm/deviceKeys');
    const { unwrapMatterKey } = await import('@/modules/firm/keyWrap');
    const { FirmApiError } = await import('@/modules/firm/FirmApiClient');

    const seatToken = useFirmStore.getState().seatToken ?? '';
    const { deviceId } = await getOrCreateDeviceKeypair();
    let fetchResp: { epoch: number; wrapped_key_b64: string };
    try {
      fetchResp = await firmClient.fetchMatterKeys(firmMatterId, deviceId, seatToken);
    } catch (err) {
      if (err instanceof FirmApiError && (err.status === 403 || err.status === 404)) {
        // Walled (403) or key not published for new epoch (404) — fail closed.
        // Stop and evict the client from cache so the next open attempt re-checks
        // access and shows the fail-closed panel if still blocked.
        stopMatterSync(localMatterId);
        return;
      }
      throw err;
    }

    const newKeyB64 = await unwrapMatterKey(fetchResp.wrapped_key_b64, fetchResp.epoch);
    await clearMatterKey(firmMatterId);
    await storeMatterKey(firmMatterId, newKeyB64);
    await client.rotateKey(newKeyB64, newEpoch);
  } catch (err) {
    console.error('[matterNotesSync] key epoch advance failed:', err);
    useMatterSyncStore.getState().setStatus(localMatterId, 'error');
  }
}

/** Stop and remove the sync client for a matter. Idempotent. */
export function stopMatterSync(localMatterId: string): void {
  const client = clientCache.get(localMatterId);
  if (!client) return;
  client.stop();
  clientCache.delete(localMatterId);
  useMatterSyncStore.getState().clearMatter(localMatterId);
}

/** Stop all running sync clients (e.g. on sign-out). */
export function stopAll(): void {
  for (const [id, client] of clientCache.entries()) {
    client.stop();
    useMatterSyncStore.getState().clearMatter(id);
  }
  clientCache.clear();
}

/** Retrieve the cached client for a matter (null if not started). */
export function getMatterSyncClient(localMatterId: string): MatterSyncClient | null {
  return clientCache.get(localMatterId) ?? null;
}
