/**
 * matterKeyService — provision + load the per-matter content key.
 *
 * The per-matter AES-256 content key lives in the OS keychain
 * (`com.keepance.matter.<id>`). This service is the client-held key path for
 * THIS chunk:
 *
 *   - createLocalMatterKey(matterId): generate a fresh key the first time a
 *     matter is created on this machine, store it, return it.
 *   - getOrCreateMatterKey(matterId): load the stored key, or generate one if
 *     none exists yet (so the matter creator establishes the key).
 *   - rotateMatterKeyLocally(matterId): generate a NEW key for a new epoch
 *     (used when the server bumps key_epoch on member-remove / wall-set).
 *
 * Cross-member key distribution (publishMatterKeyToMembers) and admin escrow
 * are implemented in this file. Each member's device receives a wrapped copy of
 * the per-matter AES-256 key; epoch rotation re-wraps to all remaining members.
 */

import { generateMatterKey } from './matterCrypto';
import { storeMatterKey, loadMatterKey, clearMatterKey } from './firmKeychain';
import { FirmApiClient, FirmApiError } from './FirmApiClient';
import { wrapMatterKey, unwrapMatterKey } from './keyWrap';
import { getOrCreateDeviceKeypair } from './deviceKeys';

/** Load the stored matter key (base64), or null if none on this machine. */
export async function getMatterKey(matterId: string): Promise<string | null> {
  return loadMatterKey(matterId);
}

/** Generate + store a fresh key for a matter (the creator establishes it). */
export async function createLocalMatterKey(matterId: string): Promise<string> {
  const keyB64 = await generateMatterKey();
  await storeMatterKey(matterId, keyB64);
  return keyB64;
}

/** Load the matter key, generating + storing one if none exists yet. */
export async function getOrCreateMatterKey(matterId: string): Promise<string> {
  const existing = await loadMatterKey(matterId);
  if (existing) return existing;
  return createLocalMatterKey(matterId);
}

/**
 * Rotate the local matter key to a new epoch. Generates a fresh key and stores
 * it, replacing the previous one. (The follow-up re-wraps + distributes it.)
 */
export async function rotateMatterKeyLocally(matterId: string): Promise<string> {
  const keyB64 = await generateMatterKey();
  await storeMatterKey(matterId, keyB64);
  return keyB64;
}

/** Forget a matter's key (e.g. the local user is removed from the matter). */
export async function forgetMatterKey(matterId: string): Promise<void> {
  await clearMatterKey(matterId);
}

// ── Cross-member key distribution (implements the deferred follow-up) ───────

/**
 * Wrap the current local matter key to every authorized member's device and
 * POST it to the backend.
 *
 * Rules:
 *   - Only the current key holder can publish (throws if no local key).
 *   - Walled users are SKIPPED entirely — their devices receive nothing.
 *   - Org admins receive an escrow copy regardless of matter membership.
 *   - The provided epoch is the current key epoch; all wrapped blobs use it.
 *
 * @returns { published: number; skippedWalled: number }
 */
export async function publishMatterKeyToMembers(
  client: FirmApiClient,
  matterId: string,
  epoch: number,
): Promise<{ published: number; skippedWalled: number }> {
  // 1. Load local matter key (must exist; caller is the holder).
  const matterKeyB64 = await loadMatterKey(matterId);
  if (!matterKeyB64) {
    throw new Error(
      `publishMatterKeyToMembers: no local matter key for matter "${matterId}". ` +
        'Only the matter creator/key-holder can publish.',
    );
  }

  // 2. Fetch the member roster + wall list.
  const membersResp = await client.listMatterMembers(matterId);
  const walledUserIds = new Set(membersResp.walls.map((w) => w.user_id));

  // 3. Determine the set of user IDs to wrap for.
  //    Members (non-walled) + all org admins (escrow).
  const memberUserIds = membersResp.members
    .map((m) => m.user_id)
    .filter((uid) => !walledUserIds.has(uid));

  // Fetch org admins for escrow.
  const adminResp = await client.listOrgAdmins();
  const adminUserIds = adminResp.admins.map((a) => a.user_id);

  // Union of members + admins (admins may already be members).
  const allUserIds = Array.from(new Set([...memberUserIds, ...adminUserIds]));

  // 4. Fetch devices for all users.
  const devicesResp = await client.fetchOrgUserDevices(allUserIds);

  // 5. Wrap the matter key for each device (excluding walled users' devices).
  const wrapped: Array<{ user_id: string; device_id: string; wrapped_key_b64: string }> = [];
  let skippedWalled = 0;

  for (const device of devicesResp.devices) {
    if (walledUserIds.has(device.user_id)) {
      skippedWalled++;
      continue;
    }
    const wrappedKeyB64 = await wrapMatterKey(matterKeyB64, device.pubkey_jwk, epoch);
    wrapped.push({
      user_id: device.user_id,
      device_id: device.device_id,
      wrapped_key_b64: wrappedKeyB64,
    });
  }

  // 6. POST the publish payload.
  await client.publishMatterKeys(matterId, { epoch, wrapped });

  return { published: wrapped.length, skippedWalled };
}

/**
 * Obtain the matter key for a shared matter.
 *
 * - Local keychain hit → return immediately (no network call).
 * - Else: POST /matter/:id/keys/fetch with this device's ID.
 *   - Success: unwrap the blob and store it → return the key.
 *   - 403/404: return null (walled, non-member, or no key published yet).
 *   - Other errors: propagate (caller handles).
 *
 * Never stores anything on a 403 or 404. Never caches a failure.
 */
export async function obtainMatterKey(
  client: FirmApiClient,
  matterId: string,
  seatToken: string,
): Promise<string | null> {
  // 1. Local keychain hit.
  const cached = await loadMatterKey(matterId);
  if (cached) return cached;

  // 2. Fetch from server.
  const { deviceId } = await getOrCreateDeviceKeypair();

  let fetchResp: { epoch: number; wrapped_key_b64: string };
  try {
    fetchResp = await client.fetchMatterKeys(matterId, deviceId, seatToken);
  } catch (err) {
    if (err instanceof FirmApiError && (err.status === 403 || err.status === 404)) {
      // Fail closed: no key stored, return null.
      return null;
    }
    // Unexpected error — propagate.
    throw err;
  }

  // 3. Unwrap with this device's private key.
  const matterKeyB64 = await unwrapMatterKey(fetchResp.wrapped_key_b64, fetchResp.epoch);

  // 4. Store in keychain.
  await storeMatterKey(matterId, matterKeyB64);

  return matterKeyB64;
}
