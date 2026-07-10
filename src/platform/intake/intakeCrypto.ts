import type { SealedManifest } from './intakeContract';

export type { SealedManifest } from './intakeContract';

const VERSION = 1;
const EPHEMERAL_PUB_BYTES = 65;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BITS = 256;
const HEADER_BYTES = 1 + EPHEMERAL_PUB_BYTES + SALT_BYTES + IV_BYTES;
const INTAKE_ITEM_INFO = new TextEncoder().encode('intake/item/v1');
const INTAKE_ITEM_AAD = new TextEncoder().encode('intake/item/v1');
const PAGE_INFO = new TextEncoder().encode('intake/page/v1');
const AUTH_INFO = new TextEncoder().encode('intake/auth/v1');
const EMPTY_HKDF_SALT = new Uint8Array(0);

export type OpenFailureReason = 'malformed' | 'bad_version' | 'auth_failed';

export type OpenItemChunkResult =
  | { ok: true; data: Uint8Array }
  | { ok: false; reason: OpenFailureReason };

export type OpenManifestResult =
  | { ok: true; manifest: SealedManifest }
  | { ok: false; reason: OpenFailureReason };

export interface ItemChunkIds {
  intakeId: string;
  itemId: string;
  submissionId: string;
  index: number;
}

export interface ManifestIds {
  intakeId: string;
  itemId: string;
  submissionId: string;
}

export class IntakeKeyWrapError extends Error {
  override name = 'IntakeKeyWrapError' as string;

  constructor(
    readonly reason: 'malformed' | 'bad_version' | 'auth_failed' | 'invalid_public_key',
    message = `Intake key wrap failed: ${reason}.`,
  ) {
    super(message);
    this.name = 'IntakeKeyWrapError';
    Object.setPrototypeOf(this, IntakeKeyWrapError.prototype);
  }
}

function getSubtle(): SubtleCrypto {
  const subtle = (globalThis.crypto as Crypto | undefined)?.subtle;
  if (!subtle) throw new Error('WebCrypto SubtleCrypto is not available in this environment.');
  return subtle;
}

/** Safe Uint8Array with zero byteOffset for jsdom's stricter WebCrypto checks. */
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
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(b64) || b64.length % 4 === 1) {
    throw new Error('Invalid base64.');
  }
  const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, '=');
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64Url(bytes: Uint8Array): string {
  return bytesToB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

async function exportRawPub(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await getSubtle().exportKey('raw', key));
}

async function importRawPub(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== EPHEMERAL_PUB_BYTES) {
    throw new IntakeKeyWrapError('invalid_public_key', 'Intake public key must be 65 raw bytes.');
  }
  return getSubtle().importKey(
    'raw',
    buf(raw) as unknown as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
}

async function importHkdfMaterial(ikm: Uint8Array): Promise<CryptoKey> {
  return getSubtle().importKey('raw', buf(ikm) as unknown as BufferSource, { name: 'HKDF' }, false, [
    'deriveBits',
    'deriveKey',
  ]);
}

async function deriveHkdfAesKey(ikm: Uint8Array, info: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const material = await importHkdfMaterial(ikm);
  return getSubtle().deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: buf(salt) as unknown as BufferSource,
      info: buf(info) as unknown as BufferSource,
    },
    material,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function deriveHkdfBytes(
  ikm: Uint8Array,
  info: Uint8Array,
  salt: Uint8Array,
  bitLength: number,
): Promise<Uint8Array> {
  const material = await importHkdfMaterial(ikm);
  const bits = await getSubtle().deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: buf(salt) as unknown as BufferSource,
      info: buf(info) as unknown as BufferSource,
    },
    material,
    bitLength,
  );
  return new Uint8Array(bits);
}

async function deriveWrappingKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const sharedBits = await getSubtle().deriveBits({ name: 'ECDH', public: publicKey }, privateKey, KEY_BITS);
  return deriveHkdfAesKey(new Uint8Array(sharedBits), INTAKE_ITEM_INFO, salt);
}

export async function generateIntakeKeypair(): Promise<{ privateKey: CryptoKey; publicKeyRaw: Uint8Array }> {
  const pair = await getSubtle().generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const publicKeyRaw = await exportRawPub(pair.publicKey);
  if (publicKeyRaw.length !== EPHEMERAL_PUB_BYTES) {
    throw new Error(`Unexpected intake public key length: ${String(publicKeyRaw.length)}.`);
  }
  return { privateKey: pair.privateKey, publicKeyRaw };
}

export async function derivePageKey(s: Uint8Array): Promise<CryptoKey> {
  // Empty salt is deliberate: the link secret is already 256 bits of fresh random
  // material, and both the client page and advisor app must derive the same key.
  return deriveHkdfAesKey(s, PAGE_INFO, EMPTY_HKDF_SALT);
}

export async function deriveAuthToken(s: Uint8Array): Promise<{ tokenB64: string; tokenBytes: Uint8Array }> {
  // The relay stores HMAC(tokenBytes), not this bearer token itself.
  const tokenBytes = await deriveHkdfBytes(s, AUTH_INFO, EMPTY_HKDF_SALT, KEY_BITS);
  return { tokenB64: bytesToB64(tokenBytes), tokenBytes };
}

export async function generateContentKey(): Promise<string> {
  const key = await getSubtle().generateKey(
    { name: 'AES-GCM', length: KEY_BITS },
    true,
    ['encrypt', 'decrypt'],
  );
  return bytesToB64(new Uint8Array(await getSubtle().exportKey('raw', key)));
}

export async function importContentKey(contentKeyB64: string): Promise<CryptoKey> {
  const raw = b64ToBytes(contentKeyB64);
  if (raw.length !== KEY_BITS / 8) {
    throw new Error(`Expected a 32-byte AES-256 content key, got ${String(raw.length)} bytes.`);
  }
  return getSubtle().importKey('raw', buf(raw) as unknown as BufferSource, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export function generateSubmissionId(): string {
  return bytesToB64Url(globalThis.crypto.getRandomValues(new Uint8Array(16)));
}

export async function wrapContentKey(contentKeyB64: string, intakePubRaw65B: Uint8Array): Promise<string> {
  const ephemeralPair = await getSubtle().generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const recipientPub = await importRawPub(intakePubRaw65B);
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const wrappingKey = await deriveWrappingKey(ephemeralPair.privateKey, recipientPub, salt);
  const contentKeyBytes = b64ToBytes(contentKeyB64);
  if (contentKeyBytes.length !== KEY_BITS / 8) {
    throw new Error(`Expected a 32-byte AES-256 content key, got ${String(contentKeyBytes.length)} bytes.`);
  }

  const ciphertext = new Uint8Array(
    await getSubtle().encrypt(
      {
        name: 'AES-GCM',
        iv: buf(iv) as unknown as BufferSource,
        additionalData: buf(INTAKE_ITEM_AAD) as unknown as BufferSource,
      },
      wrappingKey,
      buf(contentKeyBytes) as unknown as BufferSource,
    ),
  );
  const ephemeralPubRaw = await exportRawPub(ephemeralPair.publicKey);
  if (ephemeralPubRaw.length !== EPHEMERAL_PUB_BYTES) {
    throw new Error(`Unexpected ephemeral public key length: ${String(ephemeralPubRaw.length)}.`);
  }

  const out = new Uint8Array(HEADER_BYTES + ciphertext.length);
  let offset = 0;
  out[offset] = VERSION;
  offset += 1;
  out.set(ephemeralPubRaw, offset);
  offset += EPHEMERAL_PUB_BYTES;
  out.set(salt, offset);
  offset += SALT_BYTES;
  out.set(iv, offset);
  offset += IV_BYTES;
  out.set(ciphertext, offset);
  return bytesToB64(out);
}

export async function unwrapContentKey(wrappedB64: string, intakePrivateKey: CryptoKey): Promise<string> {
  let raw: Uint8Array;
  try {
    raw = b64ToBytes(wrappedB64);
  } catch {
    throw new IntakeKeyWrapError('malformed', 'Wrapped content key is not valid base64.');
  }

  if (raw.length < HEADER_BYTES + 16) {
    throw new IntakeKeyWrapError('malformed', 'Wrapped content key is too short.');
  }
  if (raw[0] !== VERSION) {
    throw new IntakeKeyWrapError('bad_version', `Unknown wrapped content key version: ${String(raw[0])}.`);
  }

  const ephemeralPubRaw = raw.subarray(1, 1 + EPHEMERAL_PUB_BYTES);
  const salt = raw.subarray(1 + EPHEMERAL_PUB_BYTES, 1 + EPHEMERAL_PUB_BYTES + SALT_BYTES);
  const iv = raw.subarray(
    1 + EPHEMERAL_PUB_BYTES + SALT_BYTES,
    1 + EPHEMERAL_PUB_BYTES + SALT_BYTES + IV_BYTES,
  );
  const ciphertext = raw.subarray(HEADER_BYTES);

  let ephemeralPub: CryptoKey;
  try {
    ephemeralPub = await importRawPub(ephemeralPubRaw);
  } catch {
    throw new IntakeKeyWrapError('invalid_public_key', 'Wrapped content key has an invalid ephemeral key.');
  }

  let wrappingKey: CryptoKey;
  try {
    wrappingKey = await deriveWrappingKey(intakePrivateKey, ephemeralPub, salt);
  } catch {
    throw new IntakeKeyWrapError('auth_failed', 'Failed to derive the intake wrapping key.');
  }

  try {
    const plaintext = new Uint8Array(
      await getSubtle().decrypt(
        {
          name: 'AES-GCM',
          iv: buf(iv) as unknown as BufferSource,
          additionalData: buf(INTAKE_ITEM_AAD) as unknown as BufferSource,
        },
        wrappingKey,
        buf(ciphertext) as unknown as BufferSource,
      ),
    );
    return bytesToB64(plaintext);
  } catch {
    throw new IntakeKeyWrapError('auth_failed', 'Wrapped content key failed authentication.');
  }
}

function chunkAad(ids: ItemChunkIds | (ManifestIds & { index: 'manifest' })): Uint8Array {
  return new TextEncoder().encode(
    `intake:${ids.intakeId}:item:${ids.itemId}:submission:${ids.submissionId}:chunk:${String(ids.index)}`,
  );
}

async function sealBytes(contentKey: CryptoKey, plaintext: Uint8Array, aad: Uint8Array): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(
    await getSubtle().encrypt(
      {
        name: 'AES-GCM',
        iv: buf(iv) as unknown as BufferSource,
        additionalData: buf(aad) as unknown as BufferSource,
      },
      contentKey,
      buf(plaintext) as unknown as BufferSource,
    ),
  );
  const out = new Uint8Array(1 + IV_BYTES + ciphertext.length);
  out[0] = VERSION;
  out.set(iv, 1);
  out.set(ciphertext, 1 + IV_BYTES);
  return bytesToB64(out);
}

async function openBytes(contentKey: CryptoKey, blobB64: string, aad: Uint8Array): Promise<OpenItemChunkResult> {
  let raw: Uint8Array;
  try {
    raw = b64ToBytes(blobB64);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (raw.length < 1 + IV_BYTES + 16) return { ok: false, reason: 'malformed' };
  if (raw[0] !== VERSION) return { ok: false, reason: 'bad_version' };

  const iv = raw.subarray(1, 1 + IV_BYTES);
  const ciphertext = raw.subarray(1 + IV_BYTES);
  try {
    const plaintext = new Uint8Array(
      await getSubtle().decrypt(
        {
          name: 'AES-GCM',
          iv: buf(iv) as unknown as BufferSource,
          additionalData: buf(aad) as unknown as BufferSource,
        },
        contentKey,
        buf(ciphertext) as unknown as BufferSource,
      ),
    );
    return { ok: true, data: plaintext };
  } catch {
    return { ok: false, reason: 'auth_failed' };
  }
}

export async function sealItemChunk(
  contentKey: CryptoKey,
  plaintext: Uint8Array,
  ids: ItemChunkIds,
): Promise<string> {
  return sealBytes(contentKey, plaintext, chunkAad(ids));
}

export async function openItemChunk(
  contentKey: CryptoKey,
  blobB64: string,
  ids: ItemChunkIds,
): Promise<OpenItemChunkResult> {
  return openBytes(contentKey, blobB64, chunkAad(ids));
}

function manifestAad(ids: ManifestIds): Uint8Array {
  return chunkAad({ ...ids, index: 'manifest' });
}

export async function sealManifest(
  contentKey: CryptoKey,
  manifest: SealedManifest,
  ids: ManifestIds,
): Promise<string> {
  return sealBytes(contentKey, new TextEncoder().encode(JSON.stringify(manifest)), manifestAad(ids));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isSealedManifest(value: unknown): value is SealedManifest {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<SealedManifest>;
  if (
    typeof candidate.submission_id !== 'string' ||
    typeof candidate.item_id !== 'string' ||
    typeof candidate.content_type !== 'string' ||
    !isStringArray(candidate.file_names) ||
    !isStringArray(candidate.chunk_hashes) ||
    typeof candidate.chunk_count !== 'number' ||
    (candidate.session_id !== undefined && typeof candidate.session_id !== 'string')
  ) {
    return false;
  }
  // The manifest is sealed by the (untrusted) submitter, so its decrypted
  // contents are attacker-controlled: chunk_count must be a real, bounded,
  // non-negative integer, and it must agree with the number of chunk hashes.
  // Otherwise a hostile client could smuggle NaN/Infinity/negative counts that
  // downstream loops would trust.
  if (!Number.isSafeInteger(candidate.chunk_count) || candidate.chunk_count < 0) return false;
  if (candidate.chunk_hashes.length !== candidate.chunk_count) return false;
  return true;
}

export async function openManifest(
  contentKey: CryptoKey,
  blobB64: string,
  ids: ManifestIds,
): Promise<OpenManifestResult> {
  const opened = await openBytes(contentKey, blobB64, manifestAad(ids));
  if (!opened.ok) return opened;

  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(opened.data));
    if (!isSealedManifest(parsed)) return { ok: false, reason: 'malformed' };
    // Bind the decrypted manifest content to the AAD ids it was sealed under.
    // The GCM AAD already proves the blob was sealed for these ids, but the
    // JSON fields are separate attacker-controlled content — reject a manifest
    // whose declared ids disagree with its envelope so routing can never be
    // steered by manifest contents.
    if (parsed.submission_id !== ids.submissionId || parsed.item_id !== ids.itemId) {
      return { ok: false, reason: 'malformed' };
    }
    return { ok: true, manifest: parsed };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}

export function verifySubmissionIntegrity(
  plaintextSid: string,
  sealedManifest: SealedManifest,
  chunkAADSids: string[],
): { ok: true } | { ok: false; reason: string } {
  if (plaintextSid !== sealedManifest.submission_id) {
    return { ok: false, reason: 'submission_id_mismatch' };
  }
  for (const chunkSid of chunkAADSids) {
    if (chunkSid !== sealedManifest.submission_id) {
      return { ok: false, reason: 'chunk_submission_id_mismatch' };
    }
  }
  // The submitter declares chunk_count in the sealed manifest; the advisor
  // presents one AAD sid per chunk it actually decrypted. A mismatch means the
  // submission is incomplete or over-declared (a partial or padded upload) and
  // must not be accepted as a finalized answer.
  if (chunkAADSids.length !== sealedManifest.chunk_count) {
    return { ok: false, reason: 'chunk_count_mismatch' };
  }
  return { ok: true };
}

export function verifySubmissionIdFresh(
  submissionId: string,
  seenSubmissionIds: ReadonlySet<string>,
): { ok: true } | { ok: false; reason: 'duplicate_submission_id' } {
  if (seenSubmissionIds.has(submissionId)) return { ok: false, reason: 'duplicate_submission_id' };
  return { ok: true };
}
