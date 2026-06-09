/**
 * Crypto primitives: HS256 access JWTs, Ed25519 seat tokens, password hashing,
 * and keyed-hash secret comparison. Covers the "signature verifies, tampered
 * token rejected, bad credentials rejected" requirements at the unit level.
 */

import { test, expect, describe } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { config } from "../src/lib/config.ts";
import {
  signAccessJwt,
  verifyAccessJwt,
  signSeatToken,
  verifySeatToken,
  hashPassword,
  verifyPassword,
  generateSecretToken,
  hmacHash,
  hmacEquals,
  generateLicenseKey,
  nowSeconds,
  base64urlEncode,
} from "../src/lib/crypto.ts";

describe("HS256 access JWT", () => {
  test("signs and verifies a valid token", () => {
    const tok = signAccessJwt({ sub: "u1", iat: nowSeconds(), exp: nowSeconds() + 60, typ: "access" });
    const res = verifyAccessJwt<{ sub: string; exp: number }>(tok);
    expect(res.valid).toBe(true);
    if (res.valid) expect(res.payload.sub).toBe("u1");
  });

  test("rejects an expired token", () => {
    const tok = signAccessJwt({ sub: "u1", iat: nowSeconds() - 120, exp: nowSeconds() - 60 });
    const res = verifyAccessJwt(tok);
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.reason).toBe("expired");
  });

  test("rejects a tampered payload (signature mismatch)", () => {
    const tok = signAccessJwt({ sub: "u1", role: "member", exp: nowSeconds() + 60 });
    const [h, , s] = tok.split(".");
    // Swap in an attacker-controlled payload claiming admin, keep the old sig.
    const forgedPayload = base64urlEncode(Buffer.from(JSON.stringify({ sub: "u1", role: "admin", exp: nowSeconds() + 60 })));
    const forged = `${h}.${forgedPayload}.${s}`;
    const res = verifyAccessJwt(forged);
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.reason).toBe("signature_invalid");
  });

  test("rejects alg:none downgrade", () => {
    const header = base64urlEncode(Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })));
    const payload = base64urlEncode(Buffer.from(JSON.stringify({ sub: "u1", exp: nowSeconds() + 60 })));
    const res = verifyAccessJwt(`${header}.${payload}.`);
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.reason).toBe("bad_alg");
  });

  test("rejects malformed tokens", () => {
    expect(verifyAccessJwt("not-a-jwt").valid).toBe(false);
    expect(verifyAccessJwt("a.b").valid).toBe(false);
  });
});

describe("Ed25519 seat token", () => {
  test("signs with the private key and verifies with the public key", () => {
    const tok = signSeatToken({ seat_id: "s1", exp: nowSeconds() + 60 }, config.seatPrivateKey);
    const res = verifySeatToken<{ seat_id: string; exp?: number }>(tok, config.seatPublicKey);
    expect(res.valid).toBe(true);
    if (res.valid) expect(res.payload.seat_id).toBe("s1");
  });

  test("rejects a tampered seat token", () => {
    const tok = signSeatToken({ seat_id: "s1", tier: "personal", exp: nowSeconds() + 60 }, config.seatPrivateKey);
    const [h, , s] = tok.split(".");
    const forged = `${h}.${base64urlEncode(Buffer.from(JSON.stringify({ seat_id: "s1", tier: "practice", exp: nowSeconds() + 60 })))}.${s}`;
    const res = verifySeatToken(forged, config.seatPublicKey);
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.reason).toBe("signature_invalid");
  });

  test("a token signed by a DIFFERENT key does not verify (client can't mint its own)", () => {
    const attacker = generateKeyPairSync("ed25519");
    const tok = signSeatToken({ seat_id: "s1", exp: nowSeconds() + 60 }, attacker.privateKey);
    const res = verifySeatToken(tok, config.seatPublicKey);
    expect(res.valid).toBe(false);
  });

  test("rejects an expired seat token", () => {
    const tok = signSeatToken({ seat_id: "s1", exp: nowSeconds() - 1 }, config.seatPrivateKey);
    const res = verifySeatToken(tok, config.seatPublicKey);
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.reason).toBe("expired");
  });
});

describe("password hashing (bcrypt)", () => {
  test("hash + verify round-trip", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("$2")).toBe(true); // bcrypt prefix
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  test("wrong password fails", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("wrong password here!!", hash)).toBe(false);
  });

  test("verify against a garbage hash returns false (no throw)", async () => {
    expect(await verifyPassword("anything", "not-a-real-hash")).toBe(false);
  });
});

describe("keyed-hash secrets", () => {
  test("hmacEquals matches the same value and rejects a different one", () => {
    const tok = generateSecretToken();
    const stored = hmacHash(tok);
    expect(hmacEquals(tok, stored)).toBe(true);
    expect(hmacEquals(tok + "x", stored)).toBe(false);
  });

  test("license key format", () => {
    const k = generateLicenseKey();
    expect(k).toMatch(/^KEEP-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });
});
