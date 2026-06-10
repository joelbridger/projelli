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
 * ───────────────────────────────────────────────────────────────────────────
 * DOCUMENTED FOLLOW-UP (NOT in this chunk — see firm/README intent):
 *
 *   Secure cross-member key DISTRIBUTION + admin ESCROW.
 *
 *   Today each member's key is generated/held locally, so two members do not
 *   yet share the SAME matter key automatically — the creator's key would need
 *   to be delivered to other members out of band. The relay is deliberately a
 *   dumb pipe and must NEVER carry the key. The follow-up must:
 *
 *     1. Wrap the per-matter content key to each member's PUBLIC key (an
 *        X25519/RSA device key the member registers; the server stores only the
 *        wrapped blobs, never the key). On `members/add` (key_release =
 *        release_to_member) the admin/creator wraps the current-epoch key to the
 *        new member and uploads the wrapped blob; the member unwraps it into
 *        their keychain. A walled user (blocked_walled) gets nothing.
 *     2. On key_epoch bump (member-remove / wall-set), generate the new key,
 *        re-wrap it to EVERY remaining member, and upload the new wrapped set.
 *        The removed/walled member never receives the new-epoch key, so the
 *        cryptographic teeth (epoch-bound AAD) hold: their old key cannot read
 *        post-bump updates.
 *     3. ADMIN ESCROW (R9): wrap each matter key ALSO to an org master/escrow
 *        public key (held by a firm admin / in an HSM), so the firm can recover
 *        a matter if an attorney leaves. The escrow key is wrapped the same way;
 *        the plaintext key still never touches the server.
 *
 *   Until that ships, a shared matter is fully functional for the member who
 *   created it (and any member handed the key out of band), and key_epoch
 *   rotation is honored locally. This service is the seam the follow-up plugs
 *   into: it already centralizes "get/rotate the matter key in the keychain".
 * ───────────────────────────────────────────────────────────────────────────
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
