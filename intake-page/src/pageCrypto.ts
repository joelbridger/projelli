// Client page seal/open for the k_page-encrypted checklist + resume state.
//
// This MUST stay byte-for-byte identical to the advisor-side sealer at
// src/platform/intake/pageSeal.ts — same wire format AND the same GCM AAD
// ('intake/page/blob/v1') — or the advisor's sealed bundle cannot be decrypted
// by this page (and vice versa). Kept as a page-local copy (rather than a shared
// import) so the static intake-page bundle stays self-contained and its dev
// server does not pull the main app's src tree. If you change one, change both.
// (Wave 1 follow-up: promote to one shared module once the bundling seam allows.)

const VERSION = 1;
const IV_BYTES = 12;
const PAGE_BLOB_AAD = new TextEncoder().encode('intake/page/blob/v1');

function getSubtle(): SubtleCrypto {
  const subtle = (globalThis.crypto as Crypto | undefined)?.subtle;
  if (!subtle) throw new Error('WebCrypto SubtleCrypto is not available.');
  return subtle;
}

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
    throw new Error('Invalid base64 page blob.');
  }
  const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, '=');
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sealPageJson(key: CryptoKey, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = new Uint8Array(
    await getSubtle().encrypt(
      {
        name: 'AES-GCM',
        iv: buf(iv) as unknown as BufferSource,
        additionalData: buf(PAGE_BLOB_AAD) as unknown as BufferSource,
      },
      key,
      buf(plaintext) as unknown as BufferSource,
    ),
  );
  const out = new Uint8Array(1 + IV_BYTES + ciphertext.length);
  out[0] = VERSION;
  out.set(iv, 1);
  out.set(ciphertext, 1 + IV_BYTES);
  return bytesToB64(out);
}

export async function openPageJson<T>(key: CryptoKey, blobB64: string): Promise<T> {
  const raw = b64ToBytes(blobB64);
  if (raw.length < 1 + IV_BYTES + 16) throw new Error('Page blob is too short.');
  if (raw[0] !== VERSION) throw new Error('Page blob version is not supported.');
  const iv = raw.subarray(1, 1 + IV_BYTES);
  const ciphertext = raw.subarray(1 + IV_BYTES);
  const plaintext = new Uint8Array(
    await getSubtle().decrypt(
      {
        name: 'AES-GCM',
        iv: buf(iv) as unknown as BufferSource,
        additionalData: buf(PAGE_BLOB_AAD) as unknown as BufferSource,
      },
      key,
      buf(ciphertext) as unknown as BufferSource,
    ),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}
