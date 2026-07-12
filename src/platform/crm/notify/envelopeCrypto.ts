import type { NotificationClass, NotificationKeyAddress, SealedEnvelopePayload } from './types';

const VERSION = 1;
const IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const LENGTH_BYTES = 4;
const CIPHERTEXT_BANDS = [1024, 4096, 16384] as const;

export type OpenEnvelopeResult =
  | { ok: true; payload: SealedEnvelopePayload }
  | { ok: false; reason: 'malformed' | 'bad_version' | 'auth_failed' };

function getSubtle(): SubtleCrypto {
  const subtle = (globalThis.crypto as Crypto | undefined)?.subtle;
  if (!subtle) throw new Error('WebCrypto SubtleCrypto is not available.');
  return subtle;
}

function b64(bytes: Uint8Array): string {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(text);
}

function fromB64(value: string): Uint8Array {
  const text = atob(value);
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
  return bytes;
}

function standalone(bytes: Uint8Array): Uint8Array {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes
    : new Uint8Array(bytes);
}

function assertAddressForClass(notificationClass: NotificationClass, address: NotificationKeyAddress): void {
  if (notificationClass === 'firm_operational' && address.scope !== 'firm_home') {
    throw new Error('Firm-operational notifications must use the firm_home key.');
  }
  if (notificationClass === 'client_confidential' && address.scope !== 'client') {
    throw new Error('Client-confidential notifications must use that client’s key.');
  }
}

function aad(orgId: string, recipientUserId: string, address: NotificationKeyAddress): Uint8Array {
  const keyScope = address.scope === 'firm_home' ? address.firmHomeMatterId : address.matterId;
  return new TextEncoder().encode(
    `lantern-crm-notify:v1:${orgId}:${recipientUserId}:${address.scope}:${keyScope}:${String(address.keyEpoch)}`,
  );
}

function paddedPlaintext(payload: SealedEnvelopePayload): Uint8Array {
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const required = LENGTH_BYTES + encoded.length;
  const band = CIPHERTEXT_BANDS.find((candidate) => required + VERSION + IV_BYTES + GCM_TAG_BYTES <= candidate);
  if (!band) throw new Error('Notification envelope exceeds the 16 KiB ciphertext band.');

  const plaintextLength = band - VERSION - IV_BYTES - GCM_TAG_BYTES;
  const result = new Uint8Array(plaintextLength);
  const view = new DataView(result.buffer);
  view.setUint32(0, encoded.length, false);
  result.set(encoded, LENGTH_BYTES);
  return result;
}

function parsePayload(bytes: Uint8Array): OpenEnvelopeResult {
  if (bytes.length < LENGTH_BYTES) return { ok: false, reason: 'malformed' };
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false);
  if (length > bytes.length - LENGTH_BYTES) return { ok: false, reason: 'malformed' };
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(LENGTH_BYTES, LENGTH_BYTES + length)));
    if (!isPayload(value)) return { ok: false, reason: 'malformed' };
    return { ok: true, payload: value };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}

function isPayload(value: unknown): value is SealedEnvelopePayload {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SealedEnvelopePayload>;
  return candidate.version === 1
    && typeof candidate.type === 'string'
    && typeof candidate.subjectRef === 'string'
    && typeof candidate.actorId === 'string'
    && !!candidate.displayHlc
    && typeof candidate.displayHlc.wallMillis === 'number'
    && typeof candidate.displayHlc.logicalCounter === 'number'
    && typeof candidate.displayHlc.actorId === 'string'
    && typeof candidate.displayHlc.operationId === 'string'
    && !!candidate.pointer
    && typeof candidate.pointer.referenceId === 'string';
}

/**
 * Encrypt a content-free envelope and pad the raw ciphertext to exactly one of
 * the 1/4/16 KiB bands. The envelope class never appears outside this device.
 */
export async function sealEnvelope(
  orgId: string,
  recipientUserId: string,
  notificationClass: NotificationClass,
  address: NotificationKeyAddress,
  payload: SealedEnvelopePayload,
): Promise<string> {
  assertAddressForClass(notificationClass, address);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(await getSubtle().encrypt(
    {
      name: 'AES-GCM',
      iv: standalone(iv) as unknown as BufferSource,
      additionalData: standalone(aad(orgId, recipientUserId, address)) as unknown as BufferSource,
    },
    address.key,
    standalone(paddedPlaintext(payload)) as unknown as BufferSource,
  ));
  const result = new Uint8Array(VERSION + IV_BYTES + ciphertext.length);
  result[0] = VERSION;
  result.set(iv, VERSION);
  result.set(ciphertext, VERSION + IV_BYTES);
  return b64(result);
}

/** Open a sealed envelope. Authentication includes its org, recipient and key scope. */
export async function openEnvelope(
  orgId: string,
  recipientUserId: string,
  address: NotificationKeyAddress,
  ciphertextB64: string,
): Promise<OpenEnvelopeResult> {
  let raw: Uint8Array;
  try {
    raw = fromB64(ciphertextB64);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (raw.length < VERSION + IV_BYTES + GCM_TAG_BYTES) return { ok: false, reason: 'malformed' };
  if (raw[0] !== VERSION) return { ok: false, reason: 'bad_version' };
  try {
    const plaintext = new Uint8Array(await getSubtle().decrypt(
      {
        name: 'AES-GCM',
        iv: standalone(raw.subarray(VERSION, VERSION + IV_BYTES)) as unknown as BufferSource,
        additionalData: standalone(aad(orgId, recipientUserId, address)) as unknown as BufferSource,
      },
      address.key,
      standalone(raw.subarray(VERSION + IV_BYTES)) as unknown as BufferSource,
    ));
    return parsePayload(plaintext);
  } catch {
    return { ok: false, reason: 'auth_failed' };
  }
}

/** Exposed for focused tests and transport validators. */
export function ciphertextBand(ciphertextB64: string): 1024 | 4096 | 16384 | null {
  try {
    const length = fromB64(ciphertextB64).length;
    return CIPHERTEXT_BANDS.includes(length as 1024 | 4096 | 16384)
      ? length as 1024 | 4096 | 16384
      : null;
  } catch {
    return null;
  }
}
