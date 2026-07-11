/**
 * Recipient-only key hints. The relay stores this opaque blob next to the
 * envelope so a recipient can choose its content key without trial-decrypting
 * every matter key. The hint itself is encrypted to that recipient device.
 *
 * This deliberately reuses the existing audited device ECDH wrapper: it is
 * an opaque-byte transport and the relay never sees its plaintext. A fixed
 * hint-format epoch is used here because the hint tells the recipient which
 * *content-key* epoch to select; it cannot depend on that unknown epoch.
 */
import { unwrapMatterKey, wrapMatterKey } from '@/platform/firm/keyWrap';

const HINT_FORMAT_EPOCH = 1;

export interface RecipientKeyHint {
  version: 1;
  scope: 'firm_home' | 'client';
  matterId: string;
  keyEpoch: number;
}

function bytesToB64(bytes: Uint8Array): string {
  let value = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    value += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(value);
}

function b64ToBytes(value: string): Uint8Array {
  const text = atob(value);
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
  return bytes;
}

function isRecipientKeyHint(value: unknown): value is RecipientKeyHint {
  if (!value || typeof value !== 'object') return false;
  const hint = value as Partial<RecipientKeyHint>;
  return hint.version === 1
    && (hint.scope === 'firm_home' || hint.scope === 'client')
    && typeof hint.matterId === 'string'
    && typeof hint.keyEpoch === 'number';
}

/** Seal the content-key selection to exactly one recipient device public key. */
export async function sealRecipientKeyHint(hint: RecipientKeyHint, recipientPublicJwk: JsonWebKey): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(hint));
  return wrapMatterKey(bytesToB64(encoded), recipientPublicJwk, HINT_FORMAT_EPOCH);
}

/** Open this device's key hint. Invalid/tampered hints intentionally fail closed. */
export async function openRecipientKeyHint(ciphertextB64: string): Promise<RecipientKeyHint | null> {
  try {
    const encodedB64 = await unwrapMatterKey(ciphertextB64, HINT_FORMAT_EPOCH);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(b64ToBytes(encodedB64)));
    return isRecipientKeyHint(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
