/**
 * keyWrap — per-matter key wrapping via ECDH P-256 + HKDF-SHA256 + AES-256-GCM.
 *
 * Used to securely deliver the per-matter AES-256 content key from the matter
 * creator/admin to each authorized member's device, and to the org admin
 * devices as escrow. The firm backend stores only opaque wrapped blobs; the
 * plaintext matter key never touches the server.
 *
 * ## Wire format (base64 of the following byte sequence)
 *
 *   [ 1 byte  version = 0x01               ]
 *   [ 65 bytes ephemeral P-256 public key   ]   uncompressed point (0x04 || X || Y)
 *   [ 16 bytes HKDF salt                   ]   random, fresh per wrap
 *   [ 12 bytes AES-GCM IV                  ]   random, fresh per wrap
 *   [ N bytes  AES-256-GCM ciphertext+tag  ]   encrypts the raw matter key bytes
 *
 *   Total minimum length: 1 + 65 + 16 + 12 + 32 (key) + 16 (tag) = 142 bytes
 *
 * ## Key derivation
 *
 *   ephemeral_priv  x  recipient_pub  →  ECDH shared secret (32 bytes)
 *   HKDF-SHA256(ikm = shared_secret, salt = salt_16B,
 *               info = utf8("lantern-matter-key-wrap:v1:epoch:<epoch>"))
 *   → 32-byte AES-256 wrapping key
 *
 * ## Authenticated encryption
 *
 *   AES-256-GCM(key, iv, plaintext = raw_matter_key_32B,
 *               aad = utf8("epoch:<epoch>"))
 *
 *   The epoch is bound in BOTH the HKDF info AND the GCM AAD. This means:
 *     - a blob wrapped at epoch 1 CANNOT be opened expecting epoch 2 (the
 *       derived AES key is different; GCM tag will fail → WrongEpochError).
 *     - a tampered blob fails GCM authentication → TamperedError.
 *
 * ## Typed errors
 *
 *   WrongEpochError  — GCM failed and we infer epoch mismatch (see below)
 *   TamperedError    — GCM failed in a context where epoch is believed correct
 *   NoDeviceKeyError — the local device has no private key (call
 *                      getOrCreateDeviceKeypair first)
 *
 *   Implementation note: because HKDF incorporates the epoch into the derived
 *   key, a wrong-epoch failure looks identical to a tamper at the GCM layer
 *   (both produce OperationError). We disambiguate in unwrapMatterKey by
 *   accepting the epoch as a parameter: if the caller PASSES an epoch we use
 *   it in derivation and GCM AAD; any failure is flagged as WrongEpochError
 *   because the most common caller error is an epoch mismatch. Genuine bit-
 *   flips even in a known-good epoch also surface as WrongEpochError because
 *   there is no cryptographic signal to distinguish them from an epoch mismatch
 *   at the GCM layer — both are OperationError.
 *
 *   In practice: wrapMatterKey binds a specific epoch; unwrapMatterKey is called
 *   with the same epoch or a different one. WrongEpochError and TamperedError
 *   are both subclasses of Error with .name set.
 */

import { getDevicePrivateKey } from './deviceKeys';

// ── Typed errors ------------------------------------------------------------

export class TamperedError extends Error {
  override name = 'TamperedError' as string;
  constructor(message = 'Client key blob failed authentication — possible tampering.') {
    super(message);
    this.name = 'TamperedError';
    Object.setPrototypeOf(this, TamperedError.prototype);
  }
}

/**
 * WrongEpochError extends TamperedError because both are GCM authentication
 * failures. The epoch is bound into HKDF info, so a wrong epoch produces a
 * different wrapping key → GCM fails. From the decryption layer these look
 * identical; WrongEpochError is the named subtype for the "caller passed the
 * wrong epoch" case, detected by the caller rather than by cryptographic signal.
 *
 * In practice: unwrapMatterKey always throws WrongEpochError on GCM failure.
 * Callers that want to distinguish "definitely tampered" from "possibly wrong
 * epoch" must do so at a higher layer.
 */
export class WrongEpochError extends TamperedError {
  constructor(message = 'Client key was wrapped under a different epoch.') {
    super(message);
    this.name = 'WrongEpochError';
    Object.setPrototypeOf(this, WrongEpochError.prototype);
  }
}

export class NoDeviceKeyError extends Error {
  override name = 'NoDeviceKeyError' as string;
  constructor(message = 'No device key available — call getOrCreateDeviceKeypair first.') {
    super(message);
    this.name = 'NoDeviceKeyError';
    Object.setPrototypeOf(this, NoDeviceKeyError.prototype);
  }
}

// ── Wire format constants ---------------------------------------------------

const VERSION = 1;
const EPHEMERAL_PUB_BYTES = 65; // uncompressed P-256 point: 0x04 || X (32B) || Y (32B)
const SALT_BYTES = 16;
const IV_BYTES = 12;
const HEADER_BYTES = 1 + EPHEMERAL_PUB_BYTES + SALT_BYTES + IV_BYTES; // 94

// ── Helpers -----------------------------------------------------------------

function getSubtle(): SubtleCrypto {
  const subtle = (globalThis.crypto as Crypto | undefined)?.subtle;
  if (!subtle) throw new Error('WebCrypto SubtleCrypto not available.');
  return subtle;
}

/** Safe Uint8Array with zero byteOffset (jsdom SubtleCrypto requirement). */
function buf(bytes: Uint8Array): Uint8Array {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) return bytes;
  return new Uint8Array(bytes);
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function epochInfo(epoch: number): Uint8Array {
  return new TextEncoder().encode(`lantern-matter-key-wrap:v1:epoch:${String(epoch)}`);
}

function epochAad(epoch: number): Uint8Array {
  return new TextEncoder().encode(`epoch:${String(epoch)}`);
}

/**
 * Export an EC public key as the 65-byte uncompressed point (0x04 || X || Y).
 * SubtleCrypto exportKey('raw') returns exactly this for P-256.
 */
async function exportRawPub(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await getSubtle().exportKey('raw', key));
}

/**
 * Import a 65-byte uncompressed P-256 point as an ECDH public CryptoKey.
 */
async function importRawPub(raw: Uint8Array): Promise<CryptoKey> {
  return getSubtle().importKey(
    'raw',
    buf(raw) as unknown as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
}

/**
 * Import a JsonWebKey as an ECDH P-256 public key.
 */
async function importPubJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return getSubtle().importKey(
    'jwk',
    jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
}

/**
 * ECDH + HKDF-SHA256 to derive a 32-byte AES-256 wrapping key.
 */
async function deriveWrappingKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  salt: Uint8Array,
  epoch: number,
): Promise<CryptoKey> {
  // ECDH shared secret (raw bits — 32 bytes for P-256)
  const sharedBits = await getSubtle().deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256,
  );

  // Import shared bits as HKDF key material
  const ikm = await getSubtle().importKey(
    'raw',
    sharedBits,
    { name: 'HKDF' },
    false,
    ['deriveBits', 'deriveKey'],
  );

  // HKDF-SHA256 → 256-bit AES-GCM key
  return getSubtle().deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: buf(salt) as unknown as BufferSource,
      info: epochInfo(epoch),
    },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ── Public API --------------------------------------------------------------

/**
 * Wrap the per-matter AES-256 content key to a recipient device's P-256 public
 * key. Returns base64 of the wire format described in this file's header.
 *
 * @param matterKeyB64   The raw AES-256 matter key, base64-encoded.
 * @param recipientPubJwk  The recipient device's ECDH P-256 public key (JWK).
 * @param epoch          The current key epoch (bound into HKDF info + GCM AAD).
 */
export async function wrapMatterKey(
  matterKeyB64: string,
  recipientPubJwk: JsonWebKey,
  epoch: number,
): Promise<string> {
  // 1. Generate ephemeral ECDH key pair.
  const ephemeralPair = await getSubtle().generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );

  // 2. Import recipient public key.
  const recipientPub = await importPubJwk(recipientPubJwk);

  // 3. Generate fresh salt + IV.
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));

  // 4. Derive wrapping key: ephemeral_priv × recipient_pub → HKDF → AES-256.
  const wrappingKey = await deriveWrappingKey(ephemeralPair.privateKey, recipientPub, salt, epoch);

  // 5. Encrypt the raw matter key bytes.
  const matterKeyBytes = b64ToBytes(matterKeyB64);
  const ciphertext = new Uint8Array(
    await getSubtle().encrypt(
      {
        name: 'AES-GCM',
        iv: buf(iv) as unknown as BufferSource,
        additionalData: buf(epochAad(epoch)) as unknown as BufferSource,
      },
      wrappingKey,
      buf(matterKeyBytes) as unknown as BufferSource,
    ),
  );

  // 6. Export ephemeral public key as 65-byte uncompressed point.
  const ephemeralPubRaw = await exportRawPub(ephemeralPair.publicKey);
  if (ephemeralPubRaw.length !== EPHEMERAL_PUB_BYTES) {
    throw new Error(`Unexpected ephemeral public key length: ${String(ephemeralPubRaw.length)}`);
  }

  // 7. Assemble wire format.
  const out = new Uint8Array(HEADER_BYTES + ciphertext.length);
  let offset = 0;
  out[offset++] = VERSION;
  out.set(ephemeralPubRaw, offset); offset += EPHEMERAL_PUB_BYTES;
  out.set(salt, offset); offset += SALT_BYTES;
  out.set(iv, offset); offset += IV_BYTES;
  out.set(ciphertext, offset);

  return bytesToB64(out);
}

/**
 * Unwrap a wrapped matter key blob using the LOCAL device's private key.
 *
 * @param wrappedB64  Base64 blob produced by wrapMatterKey.
 * @param epoch       Expected epoch (must match the epoch used during wrap).
 *
 * @throws WrongEpochError  if the epoch doesn't match (GCM authentication fails
 *                          because the HKDF info or AAD differs).
 * @throws TamperedError    if bytes are corrupted / the blob was tampered with.
 * @throws NoDeviceKeyError if this device has no private key.
 */
export async function unwrapMatterKey(wrappedB64: string, epoch: number): Promise<string> {
  // 1. Get this device's private key.
  let privateKey: CryptoKey;
  try {
    privateKey = await getDevicePrivateKey();
  } catch {
    throw new NoDeviceKeyError();
  }

  // 2. Decode and validate minimum length.
  let raw: Uint8Array;
  try {
    raw = b64ToBytes(wrappedB64);
  } catch {
    throw new TamperedError('Blob is not valid base64.');
  }

  const minLen = HEADER_BYTES + 16; // at minimum: header + GCM tag (16B)
  if (raw.length < minLen) {
    throw new TamperedError(`Blob too short (${String(raw.length)} < ${String(minLen)} bytes).`);
  }

  // 3. Parse header.
  let offset = 0;
  const version = raw[offset++];
  if (version !== VERSION) {
    throw new TamperedError(`Unknown wire format version: ${String(version)}.`);
  }

  const ephemeralPubRaw = raw.subarray(offset, offset + EPHEMERAL_PUB_BYTES);
  offset += EPHEMERAL_PUB_BYTES;
  const salt = raw.subarray(offset, offset + SALT_BYTES);
  offset += SALT_BYTES;
  const iv = raw.subarray(offset, offset + IV_BYTES);
  offset += IV_BYTES;
  const ciphertext = raw.subarray(offset);

  // 4. Import ephemeral public key.
  let ephemeralPub: CryptoKey;
  try {
    ephemeralPub = await importRawPub(ephemeralPubRaw);
  } catch {
    throw new TamperedError('Failed to import ephemeral public key from blob.');
  }

  // 5. Derive the wrapping key: device_priv × ephemeral_pub → HKDF → AES-256.
  let wrappingKey: CryptoKey;
  try {
    wrappingKey = await deriveWrappingKey(privateKey, ephemeralPub, salt, epoch);
  } catch {
    // HKDF derivation itself should not fail for epoch mismatches — it fails at
    // AES-GCM decrypt below. If derivation fails, it's a deeper issue.
    throw new TamperedError('Key derivation failed.');
  }

  // 6. Decrypt with AES-256-GCM.
  try {
    const plaintext = new Uint8Array(
      await getSubtle().decrypt(
        {
          name: 'AES-GCM',
          iv: buf(iv) as unknown as BufferSource,
          additionalData: buf(epochAad(epoch)) as unknown as BufferSource,
        },
        wrappingKey,
        buf(ciphertext) as unknown as BufferSource,
      ),
    );
    return bytesToB64(plaintext);
  } catch {
    // GCM authentication failure can mean wrong epoch OR tampering. Since the
    // epoch was passed explicitly by the caller, we throw WrongEpochError as
    // the most actionable signal. Both map to "obtain a new wrapped key".
    throw new WrongEpochError();
  }
}
