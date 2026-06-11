// backend/test/oidc-verify.test.ts
import { test, expect } from "bun:test";
import { generateKeyPairSync, createSign } from "node:crypto";
import { verifyIdToken, base64urlJson, fetchDiscovery } from "../src/lib/oidc.ts";

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

  // exp must be more than 60s in the past to be rejected (clock-skew tolerance is ±60s)
  const expired = makeIdToken({ ...base, exp: now - 120 }, kid, privPem);
  expect((await verifyIdToken(expired, { issuer: ISS, clientId: AUD, nonce: "n123", jwks })).ok).toBe(false);

  const good = makeIdToken(base, kid, privPem);
  const tampered = good.slice(0, -4) + "AAAA";
  expect((await verifyIdToken(tampered, { issuer: ISS, clientId: AUD, nonce: "n123", jwks })).ok).toBe(false);
});

// ────────────────────────────────────────────────────────────────────────────
// Fix 1 (I-1): fetchDiscovery must validate the returned issuer field
// ────────────────────────────────────────────────────────────────────────────

const GOOD_DISCO = {
  issuer: "https://idp.example.com",
  authorization_endpoint: "https://idp.example.com/authorize",
  token_endpoint: "https://idp.example.com/token",
  jwks_uri: "https://idp.example.com/jwks",
};

test("fetchDiscovery rejects when discovery doc issuer does not match requested issuer", async () => {
  // The discovery doc returns an issuer pointing elsewhere — must not be cached or returned.
  const fakeGet = async (_url: string) => ({
    status: 200,
    json: { ...GOOD_DISCO, issuer: "https://evil.example.com" },
  });
  await expect(fetchDiscovery("https://idp.example.com", fakeGet)).rejects.toThrow("oidc_issuer_mismatch");
});

test("fetchDiscovery accepts when discovery doc issuer matches requested issuer", async () => {
  const fakeGet = async (_url: string) => ({ status: 200, json: { ...GOOD_DISCO } });
  const disco = await fetchDiscovery("https://idp.example.com", fakeGet);
  expect(disco.issuer).toBe("https://idp.example.com");
});

test("fetchDiscovery accepts issuer when only trailing-slash differs", async () => {
  // Requested with trailing slash; returned without — must still match.
  const fakeGet = async (_url: string) => ({ status: 200, json: { ...GOOD_DISCO } });
  const disco = await fetchDiscovery("https://idp.example.com/", fakeGet);
  expect(disco.issuer).toBe("https://idp.example.com");
});

// ────────────────────────────────────────────────────────────────────────────
// Fix 2 (M-6): fetchDiscovery must reject http:// endpoints in discovery doc
// ────────────────────────────────────────────────────────────────────────────

test("fetchDiscovery rejects a discovery doc with an http jwks_uri", async () => {
  // Use a distinct issuer to avoid a cached hit from an earlier passing test
  const ISS2 = "https://idp2.example.com";
  const insecureDoc = {
    issuer: ISS2,
    authorization_endpoint: "https://idp2.example.com/authorize",
    token_endpoint: "https://idp2.example.com/token",
    jwks_uri: "http://idp2.example.com/jwks", // insecure
  };
  const fakeGet = async (_url: string) => ({ status: 200, json: insecureDoc });
  await expect(fetchDiscovery(ISS2, fakeGet)).rejects.toThrow("oidc_insecure_endpoint");
});

test("fetchDiscovery rejects a discovery doc with an http token_endpoint", async () => {
  const ISS3 = "https://idp3.example.com";
  const insecureDoc = {
    issuer: ISS3,
    authorization_endpoint: "https://idp3.example.com/authorize",
    token_endpoint: "http://idp3.example.com/token", // insecure
    jwks_uri: "https://idp3.example.com/jwks",
  };
  const fakeGet = async (_url: string) => ({ status: 200, json: insecureDoc });
  await expect(fetchDiscovery(ISS3, fakeGet)).rejects.toThrow("oidc_insecure_endpoint");
});

// ────────────────────────────────────────────────────────────────────────────
// Fix 3 (I-3): kid-miss must try ALL JWKS keys (rotation support)
// ────────────────────────────────────────────────────────────────────────────

test("verifyIdToken accepts token whose kid is absent from JWKS but signature matches a key present (rotation)", async () => {
  // Token signed with key-A whose kid="new-kid".
  // JWKS contains key-A under kid="old-kid" and a decoy key-B under kid="new-kid".
  // Old code would pick the key matching header kid ("new-kid" = key-B) and fail.
  // New code tries all keys, finds key-A (under "old-kid"), and accepts.
  const { publicKey: pubA, privateKey: privA } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const { publicKey: pubB } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwkA = pubA.export({ format: "jwk" }) as any;
  const jwkB = pubB.export({ format: "jwk" }) as any;
  const privAPem = privA.export({ type: "pkcs8", format: "pem" }) as string;

  // Token header says kid="new-kid", but the signing key is A which is stored under "old-kid"
  const jwks = {
    keys: [
      { ...jwkA, kid: "old-kid", alg: "RS256", use: "sig" },
      { ...jwkB, kid: "new-kid", alg: "RS256", use: "sig" }, // decoy key under "new-kid"
    ],
  };

  const now = Math.floor(Date.now() / 1000);
  // Sign with key A but declare kid="new-kid" in header — simulates rotation mismatch
  const token = makeIdToken(
    { iss: ISS, aud: AUD, exp: now + 300, iat: now, sub: "user-2", nonce: "nonce-rot" },
    "new-kid",
    privAPem,
  );

  const res = await verifyIdToken(token, { issuer: ISS, clientId: AUD, nonce: "nonce-rot", jwks });
  expect(res.ok).toBe(true);
});

test("verifyIdToken rejects an empty JWKS with reason no_jwk", async () => {
  const { privPem, kid } = setup();
  const now = Math.floor(Date.now() / 1000);
  const token = makeIdToken(
    { iss: ISS, aud: AUD, exp: now + 300, iat: now, sub: "u", nonce: "n" },
    kid, privPem,
  );
  const emptyJwks = { keys: [] };
  const res = await verifyIdToken(token, { issuer: ISS, clientId: AUD, nonce: "n", jwks: emptyJwks });
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.reason).toBe("no_jwk");
});

// ────────────────────────────────────────────────────────────────────────────
// Fix 4 (M-5): guard non-object header/claims (e.g. base64url-encoded null)
// ────────────────────────────────────────────────────────────────────────────

test("verifyIdToken rejects a token whose payload segment decodes to null without throwing", async () => {
  // Craft a token where the payload is base64url(JSON.stringify(null)) = "bnVsbA"
  const nullPayload = Buffer.from("null").toString("base64url"); // "bnVsbA"
  const { privPem, kid } = setup();
  const header = base64urlJson({ alg: "RS256", typ: "JWT", kid });
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${nullPayload}`);
  const sig = signer.sign(privPem).toString("base64url");
  const token = `${header}.${nullPayload}.${sig}`;

  const { jwks } = setup(); // different key pair — sig will fail, but we're testing malformed guard
  const res = await verifyIdToken(token, { issuer: ISS, clientId: AUD, nonce: "n", jwks });
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.reason).toBe("malformed");
});

test("verifyIdToken rejects a token whose header segment decodes to null without throwing", async () => {
  const nullHeader = Buffer.from("null").toString("base64url");
  const payload = base64urlJson({ iss: ISS, aud: AUD, exp: 9999999999, iat: 0, sub: "u", nonce: "n" });
  const { jwks } = setup();
  const token = `${nullHeader}.${payload}.fakesig`;
  const res = await verifyIdToken(token, { issuer: ISS, clientId: AUD, nonce: "n", jwks });
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.reason).toBe("malformed");
});

// ────────────────────────────────────────────────────────────────────────────
// Fix 5 (M-2): ±60s clock-skew tolerance on exp
// ────────────────────────────────────────────────────────────────────────────

test("verifyIdToken accepts a token expired 30s ago (within 60s skew window)", async () => {
  const { jwks, kid, privPem } = setup();
  const now = Math.floor(Date.now() / 1000);
  // exp is 30s in the past — within the 60s grace window, must ACCEPT
  const token = makeIdToken(
    { iss: ISS, aud: AUD, exp: now - 30, iat: now - 330, sub: "u", nonce: "n-skew" },
    kid, privPem,
  );
  const res = await verifyIdToken(token, { issuer: ISS, clientId: AUD, nonce: "n-skew", jwks, nowSeconds: now });
  expect(res.ok).toBe(true);
});

test("verifyIdToken rejects a token expired 120s ago (outside 60s skew window)", async () => {
  const { jwks, kid, privPem } = setup();
  const now = Math.floor(Date.now() / 1000);
  // exp is 120s in the past — outside grace, must REJECT
  const token = makeIdToken(
    { iss: ISS, aud: AUD, exp: now - 120, iat: now - 420, sub: "u", nonce: "n-expired" },
    kid, privPem,
  );
  const res = await verifyIdToken(token, { issuer: ISS, clientId: AUD, nonce: "n-expired", jwks, nowSeconds: now });
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.reason).toBe("expired");
});
