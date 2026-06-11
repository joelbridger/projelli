// backend/test/oidc-verify.test.ts
import { test, expect } from "bun:test";
import { generateKeyPairSync, createSign } from "node:crypto";
import { verifyIdToken, base64urlJson } from "../src/lib/oidc.ts";

function makeIdToken(claims: Record<string, unknown>, kid: string, privateKeyPem: string): string {
  const header = base64urlJson({ alg: "RS256", typ: "JWT", kid });
  const payload = base64urlJson(claims);
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const sig = signer.sign(privateKeyPem).toString("base64url");
  return `${header}.${payload}.${sig}`;
}

function setup() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  // Export JWK directly from the KeyObject — Bun does not accept createPublicKey(KeyObject)
  // when the input is already a public KeyObject (Node no-op, Bun error). Direct .export() works.
  const jwk = publicKey.export({ format: "jwk" }) as any;
  const kid = "test-kid-1";
  const jwks = { keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }] };
  const privPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  return { jwks, kid, privPem };
}

const ISS = "https://idp.example.com";
const AUD = "client-abc";

test("verifyIdToken accepts a well-formed token", async () => {
  const { jwks, kid, privPem } = setup();
  const now = Math.floor(Date.now() / 1000);
  const token = makeIdToken(
    { iss: ISS, aud: AUD, exp: now + 300, iat: now, sub: "user-1", nonce: "n123", email: "jane@weston-llp.com", email_verified: true },
    kid, privPem,
  );
  const res = await verifyIdToken(token, { issuer: ISS, clientId: AUD, nonce: "n123", jwks });
  expect(res.ok).toBe(true);
  if (res.ok) expect(res.claims.email).toBe("jane@weston-llp.com");
});

test("verifyIdToken rejects wrong audience, wrong issuer, bad nonce, expiry, tampered sig", async () => {
  const { jwks, kid, privPem } = setup();
  const now = Math.floor(Date.now() / 1000);
  const base = { iss: ISS, aud: AUD, exp: now + 300, iat: now, sub: "u", nonce: "n123", email: "a@b.com", email_verified: true };

  const wrongAud = makeIdToken({ ...base, aud: "someone-else" }, kid, privPem);
  expect((await verifyIdToken(wrongAud, { issuer: ISS, clientId: AUD, nonce: "n123", jwks })).ok).toBe(false);

  const wrongIss = makeIdToken({ ...base, iss: "https://evil.example" }, kid, privPem);
  expect((await verifyIdToken(wrongIss, { issuer: ISS, clientId: AUD, nonce: "n123", jwks })).ok).toBe(false);

  const badNonce = makeIdToken(base, kid, privPem);
  expect((await verifyIdToken(badNonce, { issuer: ISS, clientId: AUD, nonce: "DIFFERENT", jwks })).ok).toBe(false);

  const expired = makeIdToken({ ...base, exp: now - 10 }, kid, privPem);
  expect((await verifyIdToken(expired, { issuer: ISS, clientId: AUD, nonce: "n123", jwks })).ok).toBe(false);

  const good = makeIdToken(base, kid, privPem);
  const tampered = good.slice(0, -4) + "AAAA";
  expect((await verifyIdToken(tampered, { issuer: ISS, clientId: AUD, nonce: "n123", jwks })).ok).toBe(false);
});
