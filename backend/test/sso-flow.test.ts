// backend/test/sso-flow.test.ts
import { test, expect, beforeAll } from "bun:test";
import { Store } from "../src/lib/db.ts";
import { buildServeOptions } from "../src/server.ts";
import { fanout } from "../src/lib/matters.ts";
import { issueAuthTokens } from "../src/lib/services.ts";
import { hashPassword, hmacHash, generateSecretToken } from "../src/lib/crypto.ts";
import { generateKeyPairSync, createSign } from "node:crypto";

function b64url(o: unknown) { return Buffer.from(JSON.stringify(o)).toString("base64url"); }

// A tiny mock IdP: discovery + jwks + token endpoint that signs an id_token.
function startMockIdp(opts: { email: string; nonceSink: { value?: string } }) {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }) as any;
  const kid = "mock-kid";
  const privPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  let issuer = "";
  const srv = Bun.serve({
    port: 0,
    fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/.well-known/openid-configuration") {
        return Response.json({
          issuer, authorization_endpoint: issuer + "/authorize",
          token_endpoint: issuer + "/token", jwks_uri: issuer + "/jwks",
        });
      }
      if (u.pathname === "/jwks") return Response.json({ keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }] });
      if (u.pathname === "/token") {
        const now = Math.floor(Date.now() / 1000);
        const header = b64url({ alg: "RS256", typ: "JWT", kid });
        const payload = b64url({
          iss: issuer, aud: "client-abc", exp: now + 300, iat: now, sub: "idp-user-1",
          nonce: opts.nonceSink.value, email: opts.email, email_verified: true,
        });
        const signer = createSign("RSA-SHA256"); signer.update(`${header}.${payload}`);
        const idt = `${header}.${payload}.${signer.sign(privPem).toString("base64url")}`;
        return Response.json({ id_token: idt, access_token: "x", token_type: "Bearer" });
      }
      return new Response("nope", { status: 404 });
    },
  });
  issuer = `http://127.0.0.1:${srv.port}`;
  return { issuer };
}

let base = ""; let adminToken = ""; const nonceSink: { value?: string } = {};
let idpIssuer = "";

beforeAll(async () => {
  const store = new Store(":memory:");
  const org = store.createOrg({ name: "Weston", plan: "practice", packs: ["legal"], seat_limit: 5 });
  const admin = store.createUser({ org_id: org.org_id, email: "admin@weston.com", password_hash: await hashPassword("x".repeat(12)), role: "admin" });
  store.createUser({ org_id: org.org_id, email: "jane@weston.com", password_hash: await hashPassword("x".repeat(12)), role: "member" });
  adminToken = issueAuthTokens(store, admin).access_token;
  const idp = startMockIdp({ email: "jane@weston.com", nonceSink });
  idpIssuer = idp.issuer;
  const srv = Bun.serve(buildServeOptions(store, fanout));
  base = `http://${srv.hostname}:${srv.port}`;
  // Admin configures the org's IdP, pointing issuer at the mock.
  await fetch(base + "/org/sso/config/set", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ provider: "generic", issuer: idpIssuer, client_id: "client-abc", client_secret: "shh", enabled: true }),
  });
});

test("full SSO flow authenticates a known member and rejects an unknown email", async () => {
  // 1) start
  const startRes = await fetch(base + "/auth/sso/start", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "jane@weston.com", loopback_port: 49222 }),
  });
  expect(startRes.status).toBe(200);
  const { auth_url } = await startRes.json() as any;
  const au = new URL(auth_url);
  expect(au.origin + au.pathname).toBe(idpIssuer + "/authorize");
  const state = au.searchParams.get("state")!;
  nonceSink.value = au.searchParams.get("nonce")!; // mock signs this nonce back

  // 2) callback (simulate IdP redirect). Backend exchanges + verifies + redirects to loopback.
  const cbRes = await fetch(base + `/auth/sso/callback?code=authcode123&state=${state}`, { redirect: "manual" });
  expect(cbRes.status).toBe(302);
  const loc = new URL(cbRes.headers.get("location")!);
  expect(loc.host).toBe("127.0.0.1:49222");
  const ssoCode = loc.searchParams.get("sso_code")!;
  expect(ssoCode).toBeTruthy();
  // B: state must NOT be echoed back in the redirect (RFC 6819 §4.6.6)
  expect(loc.searchParams.has("state")).toBe(false);

  // 3) exchange
  const exRes = await fetch(base + "/auth/sso/exchange", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sso_code: ssoCode }),
  });
  expect(exRes.status).toBe(200);
  const login = await exRes.json() as any;
  expect(login.user.email).toBe("jane@weston.com");
  expect(typeof login.access_token).toBe("string");

  // sso_code is single-use
  const replay = await fetch(base + "/auth/sso/exchange", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sso_code: ssoCode }),
  });
  expect(replay.status).toBe(401);
});

// A: unknown-email must return 404 sso_unavailable — not a generic server error
test("POST /auth/sso/start with unknown email returns 404 sso_unavailable", async () => {
  const res = await fetch(base + "/auth/sso/start", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "nobody@nowhere.invalid", loopback_port: 49333 }),
  });
  expect(res.status).toBe(404);
  const body = await res.json() as any;
  expect(body.error).toBe("sso_unavailable");
});

// G-1: fabricated/garbage sso_code at exchange returns 401
test("sso_exchange with fabricated sso_code returns 401", async () => {
  const garbage = generateSecretToken();
  const res = await fetch(base + "/auth/sso/exchange", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sso_code: garbage }),
  });
  expect(res.status).toBe(401);
  const body = await res.json() as any;
  expect(body.error).toBe("invalid_sso_code");
});

// G-2: expired/invalid state at callback returns 400 sso_failed (no loopback port known)
test("callback with invalid state returns 400 sso_failed", async () => {
  const res = await fetch(base + `/auth/sso/callback?code=somecode&state=not-a-real-state`, { redirect: "manual" });
  // No loopback port known when state is invalid — returns JSON error, not a redirect
  expect(res.status).toBe(400);
  const body = await res.json() as any;
  expect(body.error).toBe("sso_failed");
});
