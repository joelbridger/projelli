/**
 * Cryptographic primitives for the firm backend.
 *
 *   - Access JWTs:  HS256 (symmetric, AUTH_SECRET). Short-lived, server-verified.
 *   - Seat tokens:  EdDSA / Ed25519 (asymmetric). The desktop client embeds the
 *                   PUBLIC key and verifies a seat offline by signature+expiry;
 *                   only the server (holding the private key) can mint one.
 *   - Passwords:    bcrypt via Bun.password (built in, no dependency). Chosen
 *                   over argon2 only because bcrypt is the most widely-reviewed
 *                   default and Bun ships a constant-time verify; either is fine.
 *   - Refresh / license-key hashing: SHA-256 HMAC under AUTH_SECRET, compared in
 *                   constant time. Refresh tokens and license keys are high-
 *                   entropy random strings, so a keyed hash (not a slow KDF) is
 *                   the right tool — we store only the hash, never the secret.
 *
 * The JWT wire format (header.payload.signature, base64url, compact JSON) is
 * byte-compatible with the legacy `licenses.keepance.com` validator so the
 * desktop client's existing decoder keeps working.
 */

import { sign as edSign, verify as edVerify, createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { config } from "./config.ts";

// ---------------------------------------------------------------------------
// base64url
// ---------------------------------------------------------------------------
export function base64urlEncode(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function base64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

// ---------------------------------------------------------------------------
// HS256 access JWTs
// ---------------------------------------------------------------------------
function hs256(signingInput: string): Buffer {
  return createHmac("sha256", config.authSecret).update(signingInput).digest();
}

/** Sign a payload as an HS256 JWT. Caller sets `iat`/`exp`. */
export function signAccessJwt(payload: Record<string, unknown>): string {
  const header = base64urlEncode(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = base64urlEncode(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${header}.${body}`;
  const sig = base64urlEncode(hs256(signingInput));
  return `${signingInput}.${sig}`;
}

export type JwtVerifyResult<T> =
  | { valid: true; payload: T }
  | { valid: false; reason: "malformed" | "bad_alg" | "signature_invalid" | "expired" | "payload_parse" };

/** Verify an HS256 JWT signature + expiry. Constant-time signature compare. */
export function verifyAccessJwt<T extends { exp?: number }>(token: string): JwtVerifyResult<T> {
  const parts = token.split(".");
  if (parts.length !== 3) return { valid: false, reason: "malformed" };
  const [header, body, sig] = parts as [string, string, string];

  // Reject anything that isn't the alg we sign with (defends against "alg:none"
  // and algorithm-confusion attacks).
  try {
    const h = JSON.parse(base64urlDecode(header).toString("utf8")) as { alg?: string };
    if (h.alg !== "HS256") return { valid: false, reason: "bad_alg" };
  } catch {
    return { valid: false, reason: "malformed" };
  }

  const expected = base64urlEncode(hs256(`${header}.${body}`));
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: "signature_invalid" };
  }
  try {
    const payload = JSON.parse(base64urlDecode(body).toString("utf8")) as T;
    if (typeof payload.exp === "number" && payload.exp < nowSeconds()) {
      return { valid: false, reason: "expired" };
    }
    return { valid: true, payload };
  } catch {
    return { valid: false, reason: "payload_parse" };
  }
}

// ---------------------------------------------------------------------------
// EdDSA seat tokens (asymmetric)
// ---------------------------------------------------------------------------
export function signSeatToken(payload: Record<string, unknown>, privateKey: KeyObject): string {
  const header = base64urlEncode(Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "JWT" })));
  const body = base64urlEncode(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${header}.${body}`;
  const sig = edSign(null, Buffer.from(signingInput), privateKey);
  return `${signingInput}.${base64urlEncode(sig)}`;
}

/** Verify a seat token's Ed25519 signature + expiry. This is exactly the check
 *  the desktop client performs offline (it embeds the public key). */
export function verifySeatToken<T extends { exp?: number }>(token: string, publicKey: KeyObject): JwtVerifyResult<T> {
  const parts = token.split(".");
  if (parts.length !== 3) return { valid: false, reason: "malformed" };
  const [header, body, sig] = parts as [string, string, string];
  try {
    const h = JSON.parse(base64urlDecode(header).toString("utf8")) as { alg?: string };
    if (h.alg !== "EdDSA") return { valid: false, reason: "bad_alg" };
  } catch {
    return { valid: false, reason: "malformed" };
  }
  let ok = false;
  try {
    ok = edVerify(null, Buffer.from(`${header}.${body}`), publicKey, base64urlDecode(sig));
  } catch {
    return { valid: false, reason: "signature_invalid" };
  }
  if (!ok) return { valid: false, reason: "signature_invalid" };
  try {
    const payload = JSON.parse(base64urlDecode(body).toString("utf8")) as T;
    if (typeof payload.exp === "number" && payload.exp < nowSeconds()) {
      return { valid: false, reason: "expired" };
    }
    return { valid: true, payload };
  } catch {
    return { valid: false, reason: "payload_parse" };
  }
}

// ---------------------------------------------------------------------------
// Password hashing (bcrypt via Bun)
// ---------------------------------------------------------------------------
export async function hashPassword(plain: string): Promise<string> {
  // cost 12 ≈ a sensible 2025 default; Bun runs this off-thread.
  return Bun.password.hash(plain, { algorithm: "bcrypt", cost: 12 });
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await Bun.password.verify(plain, hash);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// High-entropy secret tokens (refresh tokens, license keys) + keyed hashing
// ---------------------------------------------------------------------------
/** A URL-safe high-entropy token (default 32 bytes → 256 bits). */
export function generateSecretToken(bytes = 32): string {
  return base64urlEncode(randomBytes(bytes));
}

/** Keyed SHA-256 hash for at-rest storage of refresh tokens / license keys. */
export function hmacHash(value: string): string {
  return createHmac("sha256", config.authSecret).update(value).digest("hex");
}

/** Constant-time compare of a presented secret against a stored HMAC hash. */
export function hmacEquals(value: string, storedHash: string): boolean {
  const a = Buffer.from(hmacHash(value), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Format a human-friendly license key like KEEP-XXXX-XXXX-XXXX-XXXX. */
export function generateLicenseKey(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I
  const group = () => {
    const r = randomBytes(4);
    let s = "";
    for (let i = 0; i < 4; i++) s += alphabet[r[i]! % alphabet.length];
    return s;
  };
  return `KEEP-${group()}-${group()}-${group()}-${group()}`;
}
