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
