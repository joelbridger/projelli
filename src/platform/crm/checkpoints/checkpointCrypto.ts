import { decryptUpdate, encryptUpdate } from '@/platform/firm/matterCrypto';
import type { CheckpointSigner, CheckpointVerifier } from './types';

function bytesToB64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function b64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export { bytesToB64, b64ToBytes };

export async function sha256B64(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', value);
  return bytesToB64(new Uint8Array(digest));
}

export async function sealCheckpointPayload(
  contentKey: CryptoKey,
  payload: Uint8Array,
  keyEpoch: number
): Promise<string> {
  return encryptUpdate(contentKey, payload, keyEpoch);
}

export async function openCheckpointPayload(
  contentKey: CryptoKey,
  ciphertextB64: string,
  keyEpoch: number
): Promise<Uint8Array | null> {
  const opened = await decryptUpdate(contentKey, ciphertextB64, keyEpoch);
  return opened.ok ? opened.update : null;
}

/**
 * Build an Ed25519 signer from a device-owned private key. Key management stays
 * outside B9: callers must obtain the non-exportable device signing key from
 * the existing firm key service.
 */
export function createEd25519CheckpointSigner(
  deviceId: string,
  privateKey: CryptoKey
): CheckpointSigner {
  return {
    deviceId,
    sign: async (payload) => {
      const signature = await crypto.subtle.sign(
        { name: 'Ed25519' } as AlgorithmIdentifier,
        privateKey,
        payload
      );
      return bytesToB64(new Uint8Array(signature));
    },
  };
}

/** Verify signatures against the public key registered for each eligible device. */
export function createEd25519CheckpointVerifier(
  publicKeyForDevice: (deviceId: string) => Promise<CryptoKey | null>
): CheckpointVerifier {
  return {
    verify: async (deviceId, payload, signatureB64) => {
      try {
        const publicKey = await publicKeyForDevice(deviceId);
        if (!publicKey) return false;
        return await crypto.subtle.verify(
          { name: 'Ed25519' } as AlgorithmIdentifier,
          publicKey,
          b64ToBytes(signatureB64),
          payload
        );
      } catch {
        return false;
      }
    },
  };
}
