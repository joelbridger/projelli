/**
 * matterKeyService — provision + load the per-matter content key.
 *
 * The per-matter AES-256 content key lives in the OS keychain
 * (`com.lantern.matter.<id>`). This service is the client-held key path for
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
 *
 * VG-6a adds the auto-republish half: deviceSetFingerprint + the
 * autoRepublishHeldMatterKeys poll body, so an admin client notices when a
 * member registers a NEW device and re-wraps held matter keys without a human
 * clicking "Re-publish keys". Walled users stay excluded at every layer.
 */

import { generateMatterKey } from './matterCrypto';
import { storeMatterKey, loadMatterKey, clearMatterKey } from './firmKeychain';
import { FirmApiClient, FirmApiError } from './FirmApiClient';
import { wrapMatterKey, unwrapMatterKey } from './keyWrap';
import { getOrCreateDeviceKeypair } from './deviceKeys';
import type { FirmMatter, MatterHandle } from './contract';

/** Load the stored matter key (base64), or null if none on this machine. */
export async function getMatterKey(matterHandle: MatterHandle): Promise<string | null> {
  return loadMatterKey(matterHandle);
}

/** Generate + store a fresh key for a matter (the creator establishes it). */
export async function createLocalMatterKey(matterHandle: MatterHandle): Promise<string> {
  const keyB64 = await generateMatterKey();
  await storeMatterKey(matterHandle, keyB64);
  return keyB64;
}

/** Load the matter key, generating + storing one if none exists yet. */
export async function getOrCreateMatterKey(matterHandle: MatterHandle): Promise<string> {
  const existing = await loadMatterKey(matterHandle);
  if (existing) return existing;
  return createLocalMatterKey(matterHandle);
}

/**
 * Rotate the local matter key to a new epoch. Generates a fresh key and stores
 * it, replacing the previous one. (The follow-up re-wraps + distributes it.)
 */
export async function rotateMatterKeyLocally(matterHandle: MatterHandle): Promise<string> {
  const keyB64 = await generateMatterKey();
  await storeMatterKey(matterHandle, keyB64);
  return keyB64;
}

/** Forget a matter's key (e.g. the local user is removed from the matter). */
export async function forgetMatterKey(matterHandle: MatterHandle): Promise<void> {
  await clearMatterKey(matterHandle);
}

// ── Cross-member key distribution (implements the deferred follow-up) ───────

interface EligibleDevice {
  user_id: string;
  device_id: string;
  pubkey_jwk: JsonWebKey;
}

/**
 * Roster + escrow + device expansion for a matter: non-walled members plus
 * org admins, with walled users' devices dropped. Shared by the manual
 * publish and the VG-6a auto-republish poll.
 *
 * The device-level wall filter is the invariant backstop: even if the server
 * returned a walled user's device (a walled admin, or a misbehaving relay),
 * it never becomes eligible for a wrapped key.
 */
async function eligibleDevices(
  client: FirmApiClient,
  matterHandle: MatterHandle,
  signal?: AbortSignal,
): Promise<{ devices: EligibleDevice[]; walledSkipped: number }> {
  // Fetch the member roster + wall list.
  const membersResp = await client.listMatterMembers(matterHandle, signal);
  const walledUserIds = new Set(membersResp.walls.map((w) => w.user_id));

  // Determine the set of user IDs to wrap for:
  // members (non-walled) + all org admins (escrow).
  const memberUserIds = membersResp.members
    .map((m) => m.user_id)
    .filter((uid) => !walledUserIds.has(uid));

  // Fetch org admins for escrow.
  const adminResp = await client.listOrgAdmins(signal);
  const adminUserIds = adminResp.admins.map((a) => a.user_id);

  // Union of members + admins (admins may already be members).
  const allUserIds = Array.from(new Set([...memberUserIds, ...adminUserIds]));

  // Fetch devices for all users, then drop walled users' devices.
  const devicesResp = await client.fetchOrgUserDevices(allUserIds, signal);

  const devices: EligibleDevice[] = [];
  let walledSkipped = 0;
  for (const device of devicesResp.devices) {
    if (walledUserIds.has(device.user_id)) {
      walledSkipped++;
      continue;
    }
    devices.push(device);
  }

  return { devices, walledSkipped };
}

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
  matterHandle: MatterHandle,
  epoch: number,
  signal?: AbortSignal,
): Promise<{ published: number; skippedWalled: number }> {
  // 1. Load local matter key (must exist; caller is the holder).
  const matterKeyB64 = await loadMatterKey(matterHandle);
  if (!matterKeyB64) {
    throw new Error(
      'publishMatterKeyToMembers: no local matter key for this shared client. ' +
        'Only the matter creator/key-holder can publish.',
    );
  }

  // 2. Roster + escrow + device expansion (walled users' devices dropped).
  const { devices, walledSkipped } = await eligibleDevices(client, matterHandle, signal);

  // 3. Wrap the matter key for each eligible device.
  const wrapped: Array<{ user_id: string; device_id: string; wrapped_key_b64: string }> = [];
  for (const device of devices) {
    const wrappedKeyB64 = await wrapMatterKey(matterKeyB64, device.pubkey_jwk, epoch);
    wrapped.push({
      user_id: device.user_id,
      device_id: device.device_id,
      wrapped_key_b64: wrappedKeyB64,
    });
  }

  // 4. POST the publish payload.
  await client.publishMatterKeys(matterHandle, { epoch, wrapped }, signal);

  return { published: wrapped.length, skippedWalled: walledSkipped };
}

/**
 * Stable fingerprint of (epoch, device set) — drift means "someone
 * registered or lost a device since we last wrapped keys".
 */
export function deviceSetFingerprint(
  devices: Array<{ user_id: string; device_id: string }>,
  epoch: number,
): string {
  return `${String(epoch)}:` + devices.map((d) => `${d.user_id}/${d.device_id}`).sort().join(',');
}

/**
 * VG-6a — auto-republish wrapped matter keys when a member registers a new
 * device. For every matter whose key THIS client holds: compute the current
 * device-set fingerprint; on drift from `lastFingerprints`, re-run the full
 * publish (idempotent server-side) and record the new fingerprint. Errors
 * on one matter never block the rest. The honest member-side waiting state
 * remains the fallback for matters whose key holder is offline.
 *
 * Wall invariant: the fingerprint is computed over ELIGIBLE devices only
 * (walled users' devices are dropped by eligibleDevices), so a walled
 * member registering a new device causes no drift and no publish; and the
 * publish itself wraps only to eligible devices.
 */
export async function autoRepublishHeldMatterKeys(
  client: FirmApiClient,
  matters: Array<Pick<FirmMatter, 'matter_handle' | 'key_epoch'>>,
  lastFingerprints: Record<string, string>,
): Promise<{ republishedMatterIds: MatterHandle[]; fingerprints: Record<string, string> }> {
  const fingerprints = { ...lastFingerprints };
  const republishedMatterIds: MatterHandle[] = [];
  for (const m of matters) {
    try {
      const key = await loadMatterKey(m.matter_handle);
      if (!key) continue; // not the key holder on this device
      const { devices } = await eligibleDevices(client, m.matter_handle);
      const fp = deviceSetFingerprint(devices, m.key_epoch);
      if (fingerprints[m.matter_handle] === fp) continue;
      await publishMatterKeyToMembers(client, m.matter_handle, m.key_epoch);
      fingerprints[m.matter_handle] = fp;
      republishedMatterIds.push(m.matter_handle);
    } catch {
      // Quiet: next poll retries; the manual Re-publish button still exists.
    }
  }
  return { republishedMatterIds, fingerprints };
}

/**
 * Obtain the matter key for a shared matter.
 *
 * - Local keychain hit → return immediately (no network call).
 * - Else: use the current opaque key-fetch endpoint with this device's ID.
 *   - Success: unwrap the blob and store it → return the key.
 *   - 403/404: return null (walled, non-member, or no key published yet).
 *   - Other errors: propagate (caller handles).
 *
 * Never stores anything on a 403 or 404. Never caches a failure.
 */
export async function obtainMatterKey(
  client: FirmApiClient,
  matterHandle: MatterHandle,
  seatToken: string,
): Promise<string | null> {
  // 1. Local keychain hit.
  const cached = await loadMatterKey(matterHandle);
  if (cached) return cached;

  // 2. Fetch from server.
  const { deviceId } = await getOrCreateDeviceKeypair();

  let fetchResp: { epoch: number; wrapped_key_b64: string };
  try {
    fetchResp = await client.fetchMatterKeys(matterHandle, deviceId, seatToken);
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
  await storeMatterKey(matterHandle, matterKeyB64);

  return matterKeyB64;
}
