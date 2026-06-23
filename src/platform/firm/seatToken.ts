/**
 * seatToken — OFFLINE verification of an Ed25519-signed seat token.
 *
 * A seat token is the firm tier's licensed credential. The backend signs it
 * with an Ed25519 private key (EdDSA JWT: `header.payload.signature`,
 * base64url). The client embeds/fetches only the PUBLIC key, so it can verify
 * authenticity + expiry OFFLINE (between online `/seat/validate` checks) and
 * can never mint its own. This mirrors the backend's `verifySeatToken` so the
 * two agree exactly.
 *
 * The online `/seat/validate` is still what catches REVOCATIONS the offline
 * check can't see; this is the local trust anchor that keeps a paying firm
 * working on a plane.
 */

/** Claims carried by a seat token (mirrors backend `lib/services.ts`). */
export interface SeatTokenClaims {
  org_id: string;
  user_id: string;
  seat_id: string;
  machine_id: string;
  tier: 'personal' | 'professional' | 'practice';
  packs: Array<'advisor' | 'legal' | 'tax' | 'consulting'>;
  seats: number;
  iss?: string;
  sub?: string;
  iat?: number;
  exp?: number;
}

export type SeatTokenVerifyResult =
  | { valid: true; claims: SeatTokenClaims }
  | {
      valid: false;
      reason: 'malformed' | 'bad_alg' | 'signature_invalid' | 'expired' | 'payload_parse' | 'no_crypto';
    };

function base64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '==='.slice((b64.length + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** Decode STANDARD base64 (with +/ and =) into bytes. */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Strip PEM armor and decode the DER (SPKI) bytes of a public key. */
export function pemToSpkiBytes(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  // PEM bodies are STANDARD base64, not base64url.
  return base64ToBytes(b64);
}

/** Decode (WITHOUT verifying) a seat token's claims. Useful for reading
 *  `user_id`/`exp` before the public key is available. Never trust this for a
 *  security decision — call {@link verifySeatToken} for that. */
export function decodeSeatTokenUnsafe(token: string): SeatTokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const body = parts[1];
  if (!body) return null;
  try {
    return JSON.parse(bytesToUtf8(base64urlToBytes(body))) as SeatTokenClaims;
  } catch {
    return null;
  }
}

/**
 * Verify a seat token's Ed25519 signature + `exp` against a public key (PEM).
 * Pure crypto, no network. `nowSeconds` is injectable for tests.
 */
export async function verifySeatToken(
  token: string,
  publicKeyPem: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<SeatTokenVerifyResult> {
  const subtle =
    typeof globalThis.crypto !== 'undefined' ? globalThis.crypto.subtle : undefined;
  if (!subtle) return { valid: false, reason: 'no_crypto' };

  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false, reason: 'malformed' };
  const [header, body, sig] = parts as [string, string, string];

  // Pin the algorithm (defends against alg:none / algorithm confusion).
  try {
    const h = JSON.parse(bytesToUtf8(base64urlToBytes(header))) as { alg?: string };
    if (h.alg !== 'EdDSA') return { valid: false, reason: 'bad_alg' };
  } catch {
    return { valid: false, reason: 'malformed' };
  }

  let ok = false;
  try {
    // Pass the TypedArray views directly as BufferSource. jsdom's SubtleCrypto
    // rejects a detached/offset ArrayBuffer from `.slice().buffer`; a Uint8Array
    // is an accepted BufferSource in both the browser/Tauri WebView and jsdom.
    const key = await subtle.importKey(
      'spki',
      pemToSpkiBytes(publicKeyPem) as unknown as BufferSource,
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    const signingInput = new TextEncoder().encode(`${header}.${body}`);
    ok = await subtle.verify(
      { name: 'Ed25519' },
      key,
      base64urlToBytes(sig) as unknown as BufferSource,
      signingInput,
    );
  } catch {
    return { valid: false, reason: 'signature_invalid' };
  }
  if (!ok) return { valid: false, reason: 'signature_invalid' };

  let claims: SeatTokenClaims;
  try {
    claims = JSON.parse(bytesToUtf8(base64urlToBytes(body))) as SeatTokenClaims;
  } catch {
    return { valid: false, reason: 'payload_parse' };
  }
  if (typeof claims.exp === 'number' && claims.exp < nowSeconds) {
    return { valid: false, reason: 'expired' };
  }
  return { valid: true, claims };
}
