/**
 * matterCrypto — the per-matter content encryption the relay never sees.
 *
 * Each shared (firm) matter has a symmetric AES-256-GCM content key held in the
 * OS keychain (`com.lantern.matter.<id>`, see firmKeychain). Every Yjs update
 * (a `Uint8Array`) is sealed with this key before it is base64-encoded and
 * POSTed to the relay; incoming relay blobs are decrypted back to a Yjs update
 * and applied. The relay stores OPAQUE ciphertext only and never holds the key.
 *
 * Wire format of one sealed blob (then base64 for `ciphertext_b64`):
 *   [ 1 byte version=2 ][ 12 byte IV ][ AES-GCM ciphertext+tag ]
 *
 * `key_epoch` is woven in as AES-GCM Additional Authenticated Data (AAD), so a
 * blob sealed under one epoch cannot be silently reinterpreted under another:
 * if the matter re-keys (member removed / wall set), an old key + new epoch
 * fails authentication by construction.
 */

const V2_VERSION = 2;
const IV_BYTES = 12;
const KEY_BITS = 256;
/** Local alias keeps this browser module type-checkable from the Bun backend too. */
type CryptoBufferSource = Parameters<SubtleCrypto['decrypt']>[2];

function getSubtle(): SubtleCrypto {
  const subtle = (globalThis.crypto as Crypto | undefined)?.subtle;
  if (!subtle) {
    throw new Error('WebCrypto SubtleCrypto is not available in this environment.');
  }
  return subtle;
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

export interface MatterRouteContext {
  matterHandle: string;
  streamHandle: string;
  keyEpoch: number;
}

/** V2 binds ciphertext to the exact opaque relay route, preventing replay. */
function v2Aad(context: MatterRouteContext): Uint8Array {
  return new TextEncoder().encode(
    `v2|epoch:${String(context.keyEpoch)}|matter:${context.matterHandle}|stream:${context.streamHandle}`,
  );
}

/**
 * Return a standalone, zero-offset Uint8Array (a copy when needed). WebCrypto
 * accepts a TypedArray as a BufferSource in the browser/Tauri WebView AND in
 * jsdom's stricter SubtleCrypto, whereas a detached/offset `.buffer` from
 * `.slice().buffer` is rejected by jsdom. Passing this keeps both happy.
 */
function buf(bytes: Uint8Array): Uint8Array {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) return bytes;
  return new Uint8Array(bytes);
}

/** Generate a fresh random AES-256 content key, exported as base64 (raw). */
export async function generateMatterKey(): Promise<string> {
  const key = await getSubtle().generateKey(
    { name: 'AES-GCM', length: KEY_BITS },
    true,
    ['encrypt', 'decrypt'],
  );
  const raw = new Uint8Array(await getSubtle().exportKey('raw', key));
  return bytesToB64(raw);
}

/** Import a base64 raw key for use. */
export async function importMatterKey(keyB64: string): Promise<CryptoKey> {
  const raw = b64ToBytes(keyB64);
  return getSubtle().importKey('raw', buf(raw) as unknown as CryptoBufferSource, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export type DecryptResult =
  | { ok: true; update: Uint8Array }
  | { ok: false; reason: 'bad_version' | 'malformed' | 'auth_failed' };

/** Seal a new v2 relay blob. New writes must use this, never the v1 helper. */
export async function encryptUpdateV2(
  key: CryptoKey,
  update: Uint8Array,
  context: MatterRouteContext,
): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(await getSubtle().encrypt(
    { name: 'AES-GCM', iv, additionalData: buf(v2Aad(context)) as unknown as CryptoBufferSource },
    key,
    buf(update) as unknown as CryptoBufferSource,
  ));
  const out = new Uint8Array(1 + IV_BYTES + ct.length);
  out[0] = V2_VERSION;
  out.set(iv, 1);
  out.set(ct, 1 + IV_BYTES);
  return bytesToB64(out);
}

/**
 * Open a v2 relay blob. Older versions are rejected without a decode attempt.
 */
export async function decryptUpdateV2(
  key: CryptoKey,
  ciphertextB64: string,
  context: MatterRouteContext,
): Promise<DecryptResult> {
  let raw: Uint8Array;
  try { raw = b64ToBytes(ciphertextB64); } catch { return { ok: false, reason: 'malformed' }; }
  if (raw.length < 1 + IV_BYTES + 16) return { ok: false, reason: 'malformed' };
  if (raw[0] !== V2_VERSION) return { ok: false, reason: 'bad_version' };
  try {
    const pt = new Uint8Array(await getSubtle().decrypt(
      {
        name: 'AES-GCM',
        iv: buf(raw.subarray(1, 1 + IV_BYTES)) as unknown as CryptoBufferSource,
        additionalData: buf(v2Aad(context)) as unknown as CryptoBufferSource,
      },
      key,
      buf(raw.subarray(1 + IV_BYTES)) as unknown as CryptoBufferSource,
    ));
    return { ok: true, update: pt };
  } catch {
    return { ok: false, reason: 'auth_failed' };
  }
}
