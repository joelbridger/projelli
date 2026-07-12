/**
 * The relay never decrypts a wrapped matter key, but it still checks this
 * fixed wire shape to catch casual/accidental misuse and malformed payloads.
 * Shape validation is NOT proof of encryption: without the recipient private
 * key the relay cannot distinguish real ciphertext from crafted bytes. This is
 * the fixed client/server wire envelope used by
 * `keyWrap.ts`: ASCII `LWK`, version 1, a P-256 point, salt, IV, and exactly
 * one encrypted 32-byte matter key plus its GCM tag.
 */
const MAGIC = [0x4c, 0x57, 0x4b] as const; // "LWK"
const VERSION = 1;
const EPHEMERAL_P256_BYTES = 65;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const MATTER_KEY_BYTES = 32;
const GCM_TAG_BYTES = 16;

export const WRAPPED_KEY_ENVELOPE_BYTES = MAGIC.length + 1 + EPHEMERAL_P256_BYTES + SALT_BYTES + IV_BYTES + MATTER_KEY_BYTES + GCM_TAG_BYTES;

/** A normal firm has far fewer recipient devices than this in one key publish. */
export const MAX_WRAPPED_KEYS_PER_PUBLISH = 64;

/** Strict canonical base64 decode; malformed data never reaches relay storage. */
export function decodeWrappedKeyEnvelope(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return null;
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(Buffer.from(value, "base64"));
  } catch {
    return null;
  }
  // Buffer accepts a few non-canonical forms; round-trip closes those gaps.
  if (Buffer.from(bytes).toString("base64") !== value || bytes.byteLength !== WRAPPED_KEY_ENVELOPE_BYTES) return null;
  if (!MAGIC.every((byte, index) => bytes[index] === byte)) return null;
  if (bytes[MAGIC.length] !== VERSION) return null;
  // The first byte of an uncompressed P-256 point is fixed. The recipient
  // checks cryptographic validity while unwrapping; this relay only validates
  // a transport shape and stores the opaque bytes.
  if (bytes[MAGIC.length + 1] !== 0x04) return null;
  return bytes;
}

export function encodeWrappedKeyEnvelope(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}
