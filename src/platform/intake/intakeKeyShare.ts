/**
 * Intake private-key sharing is a grant and recovery mechanism for Firm
 * teams. It deliberately does not pretend to revoke a private key a former
 * member already obtained. A fresh intake is the only true key rotation.
 */
import { FirmApiClient, FirmApiError } from '@/platform/firm/FirmApiClient';
import { getOrCreateDeviceKeypair } from '@/platform/firm/deviceKeys';
import { deviceSetFingerprint, eligibleDevices } from '@/platform/firm/matterKeyService';
import {
  INTAKE_KEY_WRAP_CONTEXT,
  unwrapKeyMaterial,
  wrapKeyMaterial,
} from '@/platform/firm/keyWrap';
import { loadIntakePrivateKeyJwk, storeIntakePrivateKeyJwk, validateIntakePrivateKeyJwk } from './intakeKeychain';

function utf8ToB64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function b64ToUtf8(value: string): string {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

/** The intake id is also authenticated, preventing blob transplantation. */
export function intakeWrapContext(intakeId: string): string {
  return `${INTAKE_KEY_WRAP_CONTEXT}:intake:${intakeId}`;
}

export interface IntakeKeyShareResult {
  published: number;
  skippedWalled: number;
  blocked?: boolean;
}

/**
 * Publish the local intake private key to the current matter roster and org
 * admins. The relay only receives per-device ciphertext. `epoch` labels this
 * current grant set; it is not a revocation claim.
 */
export async function publishIntakeKeyToMembers(
  client: FirmApiClient,
  intakeId: string,
  matterId: string,
  epoch: number,
  options?: { firmEntitled?: boolean },
): Promise<IntakeKeyShareResult> {
  if (options?.firmEntitled === false) return { published: 0, skippedWalled: 0, blocked: true };
  const privateJwk = await loadIntakePrivateKeyJwk(intakeId);
  if (!privateJwk) throw new Error(`No local intake private key for "${intakeId}".`);

  const { devices, walledSkipped } = await eligibleDevices(client, matterId);
  const payloadB64 = utf8ToB64(JSON.stringify(privateJwk));
  const wrapped: Array<{ user_id: string; device_id: string; wrapped_key_b64: string }> = [];
  for (const device of devices) {
    wrapped.push({
      user_id: device.user_id,
      device_id: device.device_id,
      wrapped_key_b64: await wrapKeyMaterial(payloadB64, device.pubkey_jwk, epoch, intakeWrapContext(intakeId)),
    });
  }
  await client.publishIntakeKeys(intakeId, matterId, { epoch, wrapped });
  return { published: wrapped.length, skippedWalled: walledSkipped };
}

/** Stable roster fingerprint used to notice additions and removals. */
export function intakeDeviceSetFingerprint(
  devices: Array<{ user_id: string; device_id: string }>,
  epoch: number,
): string {
  return deviceSetFingerprint(devices, epoch);
}

/**
 * Re-issue the current grant set whenever the eligible roster changes. Removed
 * devices are absent from the new relay set, but a previously downloaded key
 * remains usable for ciphertext already held by that device.
 */
export async function autoRepublishHeldIntakeKeys(
  client: FirmApiClient,
  intakes: Array<{ intake_id: string; matter_id: string; key_epoch: number }>,
  lastFingerprints: Record<string, string>,
  options?: { firmEntitled?: boolean },
): Promise<{ republishedIntakeIds: string[]; fingerprints: Record<string, string> }> {
  const fingerprints = { ...lastFingerprints };
  const republishedIntakeIds: string[] = [];
  if (options?.firmEntitled === false) return { republishedIntakeIds, fingerprints };
  for (const intake of intakes) {
    try {
      if (!await loadIntakePrivateKeyJwk(intake.intake_id)) continue;
      const { devices } = await eligibleDevices(client, intake.matter_id);
      const fingerprint = intakeDeviceSetFingerprint(devices, intake.key_epoch);
      if (fingerprints[intake.intake_id] === fingerprint) continue;
      await publishIntakeKeyToMembers(client, intake.intake_id, intake.matter_id, intake.key_epoch, options);
      fingerprints[intake.intake_id] = fingerprint;
      republishedIntakeIds.push(intake.intake_id);
    } catch {
      // A later roster poll retries. Never silently create a different key.
    }
  }
  return { republishedIntakeIds, fingerprints };
}

/** Fetch, authenticate, and install this device's granted private key. */
export async function obtainIntakeKey(
  client: FirmApiClient,
  intakeId: string,
  matterId: string,
  seatToken: string,
): Promise<CryptoKey | null> {
  void matterId; // Matter authorization is checked by the relay using the stored routing id.
  const local = await loadIntakePrivateKeyJwk(intakeId);
  if (local) return crypto.subtle.importKey('jwk', local, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const { deviceId } = await getOrCreateDeviceKeypair();
  let fetched: { epoch: number; wrapped_key_b64: string };
  try {
    fetched = await client.fetchIntakeKeys(intakeId, deviceId, seatToken);
  } catch (error) {
    if (error instanceof FirmApiError && (error.status === 404 || error.status === 410)) return null;
    throw error;
  }
  const plaintextB64 = await unwrapKeyMaterial(fetched.wrapped_key_b64, fetched.epoch, intakeWrapContext(intakeId));
  const jwk = validateIntakePrivateKeyJwk(JSON.parse(b64ToUtf8(plaintextB64)));
  await storeIntakePrivateKeyJwk(intakeId, jwk);
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
}
