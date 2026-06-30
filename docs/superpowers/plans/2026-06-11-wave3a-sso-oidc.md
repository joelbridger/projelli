# Wave 3a — SSO (OIDC) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real OpenID Connect single-sign-on so a firm member signs in through their organization's identity provider (Microsoft Entra ID first, Google Workspace second, generic OIDC third) and lands in the existing Ed25519 seat-token session — no new password, walls/seats unchanged.

**Architecture:** The **firm backend is the OIDC relying party (confidential client)**. Each org's admin registers ONE web application with their IdP whose redirect URI is the stable `https://api.keepance.com/auth/sso/callback`, then enters the issuer URL + client_id + client_secret in the Advisor Prep Hero admin console (secret stored AES-256-GCM at rest). At sign-in the desktop app: (1) binds a loopback TCP listener, (2) asks the backend to start SSO for the member's email and gets back the IdP authorization URL, (3) opens the system browser to it, (4) the IdP redirects to the backend callback, the backend exchanges the code + verifies the ID token + maps the verified email to an existing user (authenticate-only — **no JIT provisioning in v1**), mints a one-time `sso_code`, and 302-redirects the browser to the desktop's loopback, (5) the desktop exchanges that one-time code for the normal `LoginResponse` (access JWT + refresh) and runs the identical post-login path as password sign-in. All IdP/backend HTTP happens in Rust (reqwest) and the browser is the *system* browser, so **no webview CSP/capability changes are needed**.

**Tech Stack:** Backend = Bun + `bun:sqlite`, zero-framework `Bun.serve` flat router (`backend/src/`). ID-token verification = Node `crypto` RS256 via JWKS (`createPublicKey({ format: 'jwk' })`). Desktop = Tauri 2 (Rust command adapting `src-tauri/src/commands/mail/gmail/oauth.rs`) + React/Zustand client (`src/modules/firm/`, `src/stores/firmStore.ts`, `src/components/firm/`). Tests = `bun test` (backend), Vitest (client TS), `cargo test` + wiremock (Rust).

**Honesty rule (HARD, board-mandated):** the website and in-app pricing re-claim "SSO" **only** in the release that actually ships it, and only after Task 13's verification leg is green. The false SSO claim was removed in commit c0454da; do not re-add it until verified. Task 13 re-instates it but the website deploy stays gated on Jameson's explicit go.

---

## File Structure

**Backend (new):**
- `backend/src/lib/oidc.ts` — OIDC primitives: discovery doc fetch+cache, JWKS fetch+cache, `buildAuthUrl`, `exchangeCode`, `verifyIdToken`. Pure-ish, dependency-injectable HTTP for tests.
- `backend/src/lib/ssoState.ts` — in-memory, TTL'd, single-use state + one-time-code stores (mirrors `lib/syncTickets.ts` + the rate-limiter pattern).
- `backend/src/routes/sso.ts` — `handleSsoStart`, `handleSsoCallback`, `handleSsoExchange` (member flow) + `handleSsoConfigSet`, `handleSsoConfigGet`, `handleSsoConfigDelete` (admin flow).

**Backend (modified):**
- `backend/src/lib/types.ts` — add `OrgIdpConfig` type + `'sso.config.set' | 'sso.config.delete' | 'sso.login'` audit actions.
- `backend/src/lib/db.ts` — add `org_idp_config` table to `SCHEMA`; add `getOrgIdpConfig`, `upsertOrgIdpConfig`, `deleteOrgIdpConfig`, `getUserByEmailNorm` Store helpers.
- `backend/src/lib/config.ts` — add `ssoCallbackBase` (default `https://api.keepance.com`) + `ssoStateTtlSeconds`, `ssoCodeTtlSeconds`.
- `backend/src/server.ts` — register the 6 new routes; the callback is `GET`.
- `backend/src/contract.ts` — add SSO config request/response shapes + endpoint paths (this is the backend's source-of-truth contract).

**Client (new):**
- `src-tauri/src/commands/firm/mod.rs` + `src-tauri/src/commands/firm/sso.rs` — `firm_sso_authenticate` Tauri command (loopback + orchestration), adapting the gmail oauth helpers.

**Client (modified):**
- `src/modules/firm/contract.ts` — mirror the new SSO contract shapes + endpoint paths.
- `src/modules/firm/FirmApiClient.ts` — add `ssoConfigGet/Set/Delete` methods.
- `src/stores/firmStore.ts` — add `signInSso(email)` action.
- `src/components/firm/FirmSignIn.tsx` — "Sign in with SSO" affordance.
- `src/components/firm/FirmAdminConsole.tsx` — "Single sign-on (SSO)" admin config section.
- `src-tauri/src/lib.rs` — register `firm_sso_authenticate` in the invoke handler + `mod firm;` under commands.
- `src/config/pricing.ts` + website copy — re-instate the SSO claim (Task 13, deploy-gated).

---

## Conventions every task follows
- TDD: failing test first, run it red, minimal code, run it green, commit.
- Backend tests live in `backend/test/`, run with `cd backend && bun test <file>`. Follow the existing `backend/test/auth.test.ts` + `backend/test/http.test.ts` style (boot via `buildServeOptions(store, hub)` on an ephemeral port for integration; call services directly for unit).
- Email matching is always on `email_norm` = `email.trim().toLowerCase()` (the `users` table already stores and uniquely indexes `email_norm`).
- Secrets (`client_secret`) at rest go through `encryptSecret`/`decryptSecret` from `backend/src/lib/crypto.ts`. One-time `sso_code`s are stored as `hmacHash(code)` and compared via the store's single-use consume.
- Conventional commits, one per task minimum.

---

### Task 1: `org_idp_config` table + Store helpers + types

**Files:**
- Modify: `backend/src/lib/types.ts`
- Modify: `backend/src/lib/db.ts` (SCHEMA block ~line 43; Store helpers)
- Test: `backend/test/sso-store.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// backend/test/sso-store.test.ts
import { test, expect } from "bun:test";
import { Store } from "../src/lib/db.ts";

function freshStore(): Store {
  return new Store(":memory:");
}

test("upsert + get org idp config round-trips and overwrites", () => {
  const store = freshStore();
  const org = store.createOrg({ name: "Weston LLP", plan: "practice", packs: ["legal"], seat_limit: 5 });

  expect(store.getOrgIdpConfig(org.org_id)).toBeNull();

  store.upsertOrgIdpConfig({
    org_id: org.org_id,
    provider: "entra",
    issuer: "https://login.microsoftonline.com/tenant-123/v2.0",
    client_id: "client-abc",
    client_secret_enc: "v1:iv:ct",
    enabled: true,
  });

  const cfg = store.getOrgIdpConfig(org.org_id);
  expect(cfg).not.toBeNull();
  expect(cfg!.provider).toBe("entra");
  expect(cfg!.issuer).toBe("https://login.microsoftonline.com/tenant-123/v2.0");
  expect(cfg!.client_id).toBe("client-abc");
  expect(cfg!.client_secret_enc).toBe("v1:iv:ct");
  expect(cfg!.enabled).toBe(true);

  // Overwrite (upsert is keyed on org_id).
  store.upsertOrgIdpConfig({
    org_id: org.org_id,
    provider: "google",
    issuer: "https://accounts.google.com",
    client_id: "client-xyz",
    client_secret_enc: "v1:iv2:ct2",
    enabled: false,
  });
  const cfg2 = store.getOrgIdpConfig(org.org_id);
  expect(cfg2!.provider).toBe("google");
  expect(cfg2!.enabled).toBe(false);

  store.deleteOrgIdpConfig(org.org_id);
  expect(store.getOrgIdpConfig(org.org_id)).toBeNull();
});

test("getUserByEmailNorm finds an active user case-insensitively", async () => {
  const store = freshStore();
  const org = store.createOrg({ name: "Weston LLP", plan: "practice", packs: ["legal"], seat_limit: 5 });
  store.createUser({ org_id: org.org_id, email: "Jane@Weston-LLP.com", password_hash: "x", role: "member" });

  const u = store.getUserByEmailNorm("jane@weston-llp.com");
  expect(u).not.toBeNull();
  expect(u!.org_id).toBe(org.org_id);
  expect(store.getUserByEmailNorm("nobody@weston-llp.com")).toBeNull();
});
```

- [ ] **Step 2: Run it red**

Run: `cd backend && bun test test/sso-store.test.ts`
Expected: FAIL (`getOrgIdpConfig is not a function`).

- [ ] **Step 3: Add the type** in `backend/src/lib/types.ts` (near `Org`):

```ts
export type IdpProvider = "entra" | "google" | "generic";

export interface OrgIdpConfig {
  org_id: string;
  provider: IdpProvider;
  /** OIDC issuer URL. Discovery is fetched from `${issuer}/.well-known/openid-configuration`. */
  issuer: string;
  client_id: string;
  /** AES-256-GCM ciphertext (crypto.encryptSecret). Never returned over the API. */
  client_secret_enc: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}
```

Also extend the `AuditAction` union (find it in this file) with: `"sso.config.set" | "sso.config.delete" | "sso.login" | "sso.login.rejected"`.

- [ ] **Step 4: Add the table** to the `SCHEMA` template string in `backend/src/lib/db.ts` (append after the `audit_events` block, before the closing backtick):

```sql
CREATE TABLE IF NOT EXISTS org_idp_config (
  org_id            TEXT PRIMARY KEY REFERENCES orgs(org_id),
  provider          TEXT NOT NULL,
  issuer            TEXT NOT NULL,
  client_id         TEXT NOT NULL,
  client_secret_enc TEXT NOT NULL,
  enabled           INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
```

- [ ] **Step 5: Add the Store helpers** (in `class Store`, near the other typed helpers; mirror the existing row-mapping style — booleans are stored as 0/1):

```ts
getUserByEmailNorm(email: string): User | null {
  const row = this.db.query("SELECT * FROM users WHERE email_norm = ?").get(email.trim().toLowerCase()) as any;
  return row ? this.rowToUser(row) : null;
}

getOrgIdpConfig(orgId: string): OrgIdpConfig | null {
  const r = this.db.query("SELECT * FROM org_idp_config WHERE org_id = ?").get(orgId) as any;
  if (!r) return null;
  return {
    org_id: r.org_id, provider: r.provider, issuer: r.issuer,
    client_id: r.client_id, client_secret_enc: r.client_secret_enc,
    enabled: r.enabled === 1, created_at: r.created_at, updated_at: r.updated_at,
  };
}

upsertOrgIdpConfig(input: {
  org_id: string; provider: string; issuer: string;
  client_id: string; client_secret_enc: string; enabled: boolean;
}): void {
  const now = new Date().toISOString();
  this.db.query(`
    INSERT INTO org_idp_config (org_id, provider, issuer, client_id, client_secret_enc, enabled, created_at, updated_at)
    VALUES ($org_id, $provider, $issuer, $client_id, $secret, $enabled, $now, $now)
    ON CONFLICT(org_id) DO UPDATE SET
      provider=$provider, issuer=$issuer, client_id=$client_id,
      client_secret_enc=$secret, enabled=$enabled, updated_at=$now
  `).run({
    $org_id: input.org_id, $provider: input.provider, $issuer: input.issuer,
    $client_id: input.client_id, $secret: input.client_secret_enc,
    $enabled: input.enabled ? 1 : 0, $now: now,
  });
}

deleteOrgIdpConfig(orgId: string): void {
  this.db.query("DELETE FROM org_idp_config WHERE org_id = ?").run(orgId);
}
```

> If `rowToUser` / a `Store(":memory:")` constructor signature differs, follow the existing patterns in this file exactly (e.g. an existing `getUserByEmailWithHash` shows the row→User mapping and the query style). Import `OrgIdpConfig`, `User` at the top.

- [ ] **Step 6: Run it green.** `cd backend && bun test test/sso-store.test.ts` → PASS.
- [ ] **Step 7: Commit.** `git add -A && git commit -m "feat(firm/sso): org_idp_config table + store helpers"`

---

### Task 2: OIDC discovery + JWKS + ID-token verification

**Files:**
- Create: `backend/src/lib/oidc.ts`
- Test: `backend/test/oidc-verify.test.ts`

This is the security-critical module. ID tokens are RS256-signed by the IdP; verify signature against the IdP's JWKS, plus `iss`/`aud`/`exp`/`nonce`.

- [ ] **Step 1: Write the failing test** (generates an RSA keypair, serves a JWKS + signs a token, asserts verify accepts the good token and rejects tampered iss/aud/nonce/expired):

```ts
// backend/test/oidc-verify.test.ts
import { test, expect } from "bun:test";
import { generateKeyPairSync, createPublicKey, createSign, randomUUID } from "node:crypto";
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
  const jwk = createPublicKey(publicKey).export({ format: "jwk" }) as any;
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
```

- [ ] **Step 2: Run it red.** `cd backend && bun test test/oidc-verify.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `backend/src/lib/oidc.ts`** (discovery + JWKS fetch are injected so tests pass a static `jwks`; verify uses Node crypto RS256):

```ts
/**
 * OIDC relying-party primitives for the firm SSO flow. The backend is a
 * CONFIDENTIAL client: it holds each org's client_secret and exchanges the
 * authorization code server-side. ID tokens are RS256-signed by the IdP and
 * verified here against the IdP's JWKS (iss/aud/exp/nonce all checked).
 */
import { createVerify, createPublicKey, randomBytes, createHash } from "node:crypto";

export function base64urlJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}
function decodeSegment(seg: string): any {
  return JSON.parse(Buffer.from(seg, "base64url").toString("utf8"));
}

export interface Jwks { keys: Array<Record<string, unknown> & { kid?: string }>; }

export interface OidcDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
}

export type HttpGet = (url: string) => Promise<{ status: number; json: any }>;
export type HttpPostForm = (url: string, form: Record<string, string>) => Promise<{ status: number; json: any }>;

const defaultGet: HttpGet = async (url) => {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const defaultPostForm: HttpPostForm = async (url, form) => {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(form).toString(),
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};

// --- discovery + JWKS, cached by issuer with a short TTL --------------------
const DISCO_TTL_MS = 60 * 60 * 1000;
const discoCache = new Map<string, { at: number; disco: OidcDiscovery }>();
const jwksCache = new Map<string, { at: number; jwks: Jwks }>();

export async function fetchDiscovery(issuer: string, get: HttpGet = defaultGet): Promise<OidcDiscovery> {
  const cached = discoCache.get(issuer);
  if (cached && Date.now() - cached.at < DISCO_TTL_MS) return cached.disco;
  const wellKnown = issuer.replace(/\/$/, "") + "/.well-known/openid-configuration";
  const res = await get(wellKnown);
  if (res.status !== 200 || !res.json?.token_endpoint) throw new Error("oidc_discovery_failed");
  const disco = res.json as OidcDiscovery;
  discoCache.set(issuer, { at: Date.now(), disco });
  return disco;
}

export async function fetchJwks(jwksUri: string, get: HttpGet = defaultGet): Promise<Jwks> {
  const cached = jwksCache.get(jwksUri);
  if (cached && Date.now() - cached.at < DISCO_TTL_MS) return cached.jwks;
  const res = await get(jwksUri);
  if (res.status !== 200 || !Array.isArray(res.json?.keys)) throw new Error("oidc_jwks_failed");
  const jwks = res.json as Jwks;
  jwksCache.set(jwksUri, { at: Date.now(), jwks });
  return jwks;
}

// --- PKCE + state helpers --------------------------------------------------
export function genVerifier(): string { return randomBytes(48).toString("base64url"); }
export function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
export function randomToken(bytes = 32): string { return randomBytes(bytes).toString("base64url"); }

// --- authorization URL -----------------------------------------------------
export function buildAuthUrl(input: {
  authorizationEndpoint: string; clientId: string; redirectUri: string;
  state: string; nonce: string; codeChallenge: string; loginHint?: string;
}): string {
  const p = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: input.state,
    nonce: input.nonce,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
  });
  if (input.loginHint) p.set("login_hint", input.loginHint);
  return `${input.authorizationEndpoint}?${p.toString()}`;
}

// --- code exchange ---------------------------------------------------------
export async function exchangeCode(input: {
  tokenEndpoint: string; clientId: string; clientSecret: string;
  code: string; codeVerifier: string; redirectUri: string;
}, post: HttpPostForm = defaultPostForm): Promise<{ id_token: string }> {
  const res = await post(input.tokenEndpoint, {
    grant_type: "authorization_code",
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    code_verifier: input.codeVerifier,
    redirect_uri: input.redirectUri,
  });
  if (res.status !== 200 || typeof res.json?.id_token !== "string") {
    throw new Error(`oidc_token_exchange_failed:${res.json?.error ?? res.status}`);
  }
  return { id_token: res.json.id_token };
}

// --- ID token verification -------------------------------------------------
export interface IdTokenClaims {
  iss: string; aud: string | string[]; exp: number; iat: number; sub: string;
  nonce?: string; email?: string; email_verified?: boolean;
  preferred_username?: string; upn?: string; name?: string;
}
export type VerifyResult =
  | { ok: true; claims: IdTokenClaims }
  | { ok: false; reason: string };

export async function verifyIdToken(
  token: string,
  opts: { issuer: string; clientId: string; nonce: string; jwks: Jwks; nowSeconds?: number },
): Promise<VerifyResult> {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [h, p, s] = parts as [string, string, string];
  let header: any, claims: IdTokenClaims;
  try { header = decodeSegment(h); claims = decodeSegment(p); }
  catch { return { ok: false, reason: "malformed" }; }
  if (header.alg !== "RS256") return { ok: false, reason: "bad_alg" };

  const jwk = opts.jwks.keys.find((k) => k.kid === header.kid) ?? opts.jwks.keys[0];
  if (!jwk) return { ok: false, reason: "no_jwk" };
  let pub;
  try { pub = createPublicKey({ key: jwk as any, format: "jwk" }); }
  catch { return { ok: false, reason: "bad_jwk" }; }

  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${h}.${p}`);
  let sigOk = false;
  try { sigOk = verifier.verify(pub, Buffer.from(s, "base64url")); }
  catch { return { ok: false, reason: "signature_invalid" }; }
  if (!sigOk) return { ok: false, reason: "signature_invalid" };

  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (claims.iss !== opts.issuer) return { ok: false, reason: "iss_mismatch" };
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(opts.clientId)) return { ok: false, reason: "aud_mismatch" };
  if (typeof claims.exp !== "number" || claims.exp < now) return { ok: false, reason: "expired" };
  if (claims.nonce !== opts.nonce) return { ok: false, reason: "nonce_mismatch" };
  return { ok: true, claims };
}

/** Best verified email from ID-token claims; null if none usable.
 *  Entra often omits email_verified but the directory email is trusted; Google sets it. */
export function emailFromClaims(claims: IdTokenClaims): string | null {
  if (claims.email && claims.email_verified !== false) return claims.email.trim().toLowerCase();
  const alt = claims.preferred_username || claims.upn;
  if (alt && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alt)) return alt.trim().toLowerCase();
  return null;
}
```

- [ ] **Step 4: Run it green.** `cd backend && bun test test/oidc-verify.test.ts` → PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(firm/sso): OIDC discovery, JWKS + RS256 id_token verification"`

---

### Task 3: SSO state + one-time-code store (in-memory, TTL, single-use)

**Files:**
- Create: `backend/src/lib/ssoState.ts`
- Test: `backend/test/sso-state.test.ts`

- [ ] **Step 1: Write the failing test:**

```ts
// backend/test/sso-state.test.ts
import { test, expect } from "bun:test";
import { putState, takeState, putCode, takeCode } from "../src/lib/ssoState.ts";

test("state is single-use and round-trips", () => {
  putState("s1", { orgId: "o1", issuer: "i", clientId: "c", codeVerifier: "v", nonce: "n", loopbackPort: 5000 }, 60);
  const got = takeState("s1");
  expect(got?.orgId).toBe("o1");
  expect(takeState("s1")).toBeNull(); // consumed
});

test("state expires", () => {
  putState("s2", { orgId: "o", issuer: "i", clientId: "c", codeVerifier: "v", nonce: "n", loopbackPort: 1 }, 0);
  expect(takeState("s2")).toBeNull();
});

test("one-time code is single-use", () => {
  putCode("code-hash-1", { userId: "u1" }, 60);
  expect(takeCode("code-hash-1")?.userId).toBe("u1");
  expect(takeCode("code-hash-1")).toBeNull();
});
```

- [ ] **Step 2: Run it red.** `cd backend && bun test test/sso-state.test.ts` → FAIL.

- [ ] **Step 3: Implement `backend/src/lib/ssoState.ts`:**

```ts
/**
 * Ephemeral SSO server-side state. Two single-use, TTL'd in-memory maps:
 *  - `state` (issued in /auth/sso/start, consumed in the callback): binds the
 *    flow to one org + PKCE verifier + nonce + the desktop's loopback port.
 *  - `code` (issued by the callback, consumed by /auth/sso/exchange): a one-time
 *    handle the desktop swaps for real tokens, keyed by hmacHash(code).
 * Single-instance only (same posture as the rate limiter + syncTickets); a
 * sweeper drops expired entries so the maps can't grow unbounded.
 */
export interface SsoStateEntry {
  orgId: string; issuer: string; clientId: string;
  codeVerifier: string; nonce: string; loopbackPort: number;
}
export interface SsoCodeEntry { userId: string; }

interface Wrapped<T> { value: T; expiresAt: number; }
const states = new Map<string, Wrapped<SsoStateEntry>>();
const codes = new Map<string, Wrapped<SsoCodeEntry>>();

export function putState(state: string, e: SsoStateEntry, ttlSeconds: number): void {
  states.set(state, { value: e, expiresAt: Date.now() + ttlSeconds * 1000 });
}
export function takeState(state: string): SsoStateEntry | null {
  const w = states.get(state);
  states.delete(state);
  if (!w || w.expiresAt <= Date.now()) return null;
  return w.value;
}
export function putCode(codeHash: string, e: SsoCodeEntry, ttlSeconds: number): void {
  codes.set(codeHash, { value: e, expiresAt: Date.now() + ttlSeconds * 1000 });
}
export function takeCode(codeHash: string): SsoCodeEntry | null {
  const w = codes.get(codeHash);
  codes.delete(codeHash);
  if (!w || w.expiresAt <= Date.now()) return null;
  return w.value;
}
export function startSsoStateGc(): ReturnType<typeof setInterval> {
  const t = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of states) if (v.expiresAt <= now) states.delete(k);
    for (const [k, v] of codes) if (v.expiresAt <= now) codes.delete(k);
  }, 60_000);
  if (typeof t.unref === "function") t.unref();
  return t;
}
```

- [ ] **Step 4: Run it green.** `cd backend && bun test test/sso-state.test.ts` → PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(firm/sso): ephemeral single-use SSO state + code store"`

---

### Task 4: Config additions

**Files:**
- Modify: `backend/src/lib/config.ts`
- Test: covered by Task 6's integration test (no standalone test).

- [ ] **Step 1: Add to the `config` object** in `backend/src/lib/config.ts` (alongside the other `num`/`str` fields):

```ts
  /** Public base URL the IdP redirects back to: `${ssoCallbackBase}/auth/sso/callback`.
   *  Must match the redirect URI the firm registers with their IdP. */
  ssoCallbackBase: str("SSO_CALLBACK_BASE", "https://api.keepance.com"),
  ssoStateTtlSeconds: num("SSO_STATE_TTL_SECONDS", 600),
  ssoCodeTtlSeconds: num("SSO_CODE_TTL_SECONDS", 120),
```

- [ ] **Step 2: Commit.** `git add -A && git commit -m "feat(firm/sso): SSO callback + TTL config"`

---

### Task 5: Admin SSO-config contract + routes

**Files:**
- Modify: `backend/src/contract.ts` (add shapes + endpoint paths)
- Create: `backend/src/routes/sso.ts` (admin handlers in this task; member handlers in Task 6)
- Modify: `backend/src/server.ts` (register admin routes)
- Test: `backend/test/sso-admin.test.ts`

- [ ] **Step 1: Add contract shapes** to `backend/src/contract.ts` (and mirror later in the client copy, Task 9):

```ts
// --- SSO (OIDC) admin config ----------------------------------------------
export type IdpProvider = "entra" | "google" | "generic";
export interface SsoConfigSetRequest {
  provider: IdpProvider;
  issuer: string;
  client_id: string;
  client_secret: string;   // write-only; never returned
  enabled: boolean;
}
export interface SsoConfigView {
  configured: boolean;
  provider?: IdpProvider;
  issuer?: string;
  client_id?: string;
  enabled?: boolean;
  has_secret?: boolean;
  /** The redirect URI the firm must register with their IdP. */
  redirect_uri: string;
}
```

Add to the `ENDPOINTS` object in `backend/src/contract.ts`:
```ts
  ssoConfigSet: "/org/sso/config/set",
  ssoConfigGet: "/org/sso/config/get",
  ssoConfigDelete: "/org/sso/config/delete",
  ssoStart: "/auth/sso/start",
  ssoCallback: "/auth/sso/callback",
  ssoExchange: "/auth/sso/exchange",
```

- [ ] **Step 2: Write the failing test** (mirror `requireAdmin` usage from `backend/test`/`routes/admin.ts` — an admin access token is needed; reuse the helper the existing admin tests use to mint one, e.g. `issueAuthTokens` against an admin user):

```ts
// backend/test/sso-admin.test.ts
import { test, expect, beforeAll } from "bun:test";
import { getStore, Store } from "../src/lib/db.ts";
import { buildServeOptions } from "../src/server.ts";
import { fanout } from "../src/lib/matters.ts";
import { issueAuthTokens } from "../src/lib/services.ts";
import { hashPassword } from "../src/lib/crypto.ts";

let base: string; let adminToken: string; let memberToken: string; let orgId: string;

beforeAll(async () => {
  const store = new Store(":memory:");
  const org = store.createOrg({ name: "Weston", plan: "practice", packs: ["legal"], seat_limit: 5 });
  orgId = org.org_id;
  const admin = store.createUser({ org_id: org.org_id, email: "admin@weston.com", password_hash: await hashPassword("x".repeat(12)), role: "admin" });
  const member = store.createUser({ org_id: org.org_id, email: "m@weston.com", password_hash: await hashPassword("x".repeat(12)), role: "member" });
  adminToken = issueAuthTokens(store, admin).access_token;
  memberToken = issueAuthTokens(store, member).access_token;
  const srv = Bun.serve(buildServeOptions(store, fanout));
  base = `http://${srv.hostname}:${srv.port}`;
});

async function post(path: string, body: unknown, token?: string) {
  return fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

test("admin can set, get (secret-free), and delete SSO config; member is forbidden", async () => {
  const set = await post("/org/sso/config/set", {
    provider: "generic", issuer: "https://idp.example.com",
    client_id: "client-abc", client_secret: "super-secret", enabled: true,
  }, adminToken);
  expect(set.status).toBe(200);

  const get = await post("/org/sso/config/get", {}, adminToken);
  expect(get.status).toBe(200);
  const view = await get.json();
  expect(view.configured).toBe(true);
  expect(view.client_id).toBe("client-abc");
  expect(view.has_secret).toBe(true);
  expect(view.redirect_uri).toContain("/auth/sso/callback");
  expect(JSON.stringify(view)).not.toContain("super-secret"); // secret never leaves

  const memberForbidden = await post("/org/sso/config/get", {}, memberToken);
  expect(memberForbidden.status).toBe(403);

  const del = await post("/org/sso/config/delete", {}, adminToken);
  expect(del.status).toBe(200);
  const get2 = await post("/org/sso/config/get", {}, adminToken);
  expect((await get2.json()).configured).toBe(false);
});
```

- [ ] **Step 3: Run it red.** `cd backend && bun test test/sso-admin.test.ts` → FAIL (404).

- [ ] **Step 4: Implement the admin handlers** in `backend/src/routes/sso.ts`. Reuse the `requireAdmin(req)` helper from `routes/admin.ts` (export it if not already exported, or replicate its 1-line role check via `authenticate`):

```ts
import { json, error, readJson, authenticate } from "../lib/http.ts";
import { encryptSecret } from "../lib/crypto.ts";
import { config } from "../lib/config.ts";
import type { Store } from "../lib/db.ts";
import type { IdpProvider } from "../lib/types.ts";

const VALID_PROVIDERS = new Set(["entra", "google", "generic"]);
const REDIRECT_URI = `${config.ssoCallbackBase.replace(/\/$/, "")}/auth/sso/callback`;

function requireAdminClaims(req: Request): { ok: true; orgId: string; userId: string } | { ok: false; resp: Response } {
  const auth = authenticate(req);
  if (!auth.ok) return { ok: false, resp: error("unauthorized", 401, auth.reason) };
  if (auth.claims.role !== "admin") return { ok: false, resp: error("forbidden", 403, "admin_only") };
  return { ok: true, orgId: auth.claims.org_id, userId: auth.claims.sub };
}

export async function handleSsoConfigSet(req: Request, store: Store): Promise<Response> {
  const a = requireAdminClaims(req); if (!a.ok) return a.resp;
  const body = await readJson<any>(req);
  if (!body) return error("invalid_json", 400);
  const { provider, issuer, client_id, client_secret, enabled } = body;
  if (!VALID_PROVIDERS.has(provider)) return error("invalid_provider", 400);
  if (typeof issuer !== "string" || !/^https:\/\//.test(issuer)) return error("invalid_issuer", 400, "issuer must be an https URL");
  if (typeof client_id !== "string" || !client_id.trim()) return error("invalid_client_id", 400);
  if (typeof client_secret !== "string" || !client_secret.trim()) return error("invalid_client_secret", 400);
  store.upsertOrgIdpConfig({
    org_id: a.orgId, provider, issuer: issuer.trim(), client_id: client_id.trim(),
    client_secret_enc: encryptSecret(client_secret), enabled: !!enabled,
  });
  store.audit({ org_id: a.orgId, actor_user_id: a.userId, action: "sso.config.set", target: a.orgId, detail: { provider, enabled: !!enabled } });
  return json({ ok: true, redirect_uri: REDIRECT_URI });
}

export function handleSsoConfigGet(req: Request, store: Store): Response {
  const a = requireAdminClaims(req); if (!a.ok) return a.resp;
  const cfg = store.getOrgIdpConfig(a.orgId);
  if (!cfg) return json({ configured: false, redirect_uri: REDIRECT_URI });
  return json({
    configured: true, provider: cfg.provider, issuer: cfg.issuer,
    client_id: cfg.client_id, enabled: cfg.enabled, has_secret: !!cfg.client_secret_enc,
    redirect_uri: REDIRECT_URI,
  });
}

export function handleSsoConfigDelete(req: Request, store: Store): Response {
  const a = requireAdminClaims(req); if (!a.ok) return a.resp;
  store.deleteOrgIdpConfig(a.orgId);
  store.audit({ org_id: a.orgId, actor_user_id: a.userId, action: "sso.config.delete", target: a.orgId });
  return json({ ok: true });
}
```

- [ ] **Step 5: Register in `server.ts`** (in the Admin section, after the `/org/users/list` line):

```ts
        if (path === "/org/sso/config/set" && method === "POST") return await handleSsoConfigSet(req, store);
        if (path === "/org/sso/config/get" && method === "POST") return handleSsoConfigGet(req, store);
        if (path === "/org/sso/config/delete" && method === "POST") return handleSsoConfigDelete(req, store);
```
…and add `import { handleSsoConfigSet, handleSsoConfigGet, handleSsoConfigDelete } from "./routes/sso.ts";` near the other route imports.

- [ ] **Step 6: Run it green.** `cd backend && bun test test/sso-admin.test.ts` → PASS.
- [ ] **Step 7: Commit.** `git add -A && git commit -m "feat(firm/sso): admin SSO-config routes (set/get/delete, secret-free reads)"`

---

### Task 6: Member SSO flow routes (start / callback / exchange)

**Files:**
- Modify: `backend/src/routes/sso.ts` (add member handlers)
- Modify: `backend/src/server.ts` (register the 3 member routes + start the SSO GC)
- Test: `backend/test/sso-flow.test.ts` (full flow against a mock IdP)

This is the heart of the wave. The test drives the entire flow with an injected mock IdP (discovery + jwks + token endpoint) so it runs in CI without a real IdP.

- [ ] **Step 1: Write the failing integration test.** It stands up a mock IdP via a second `Bun.serve` that returns a discovery doc pointing at itself, a JWKS, and a token endpoint that returns a signed id_token. Then: configure the org's IdP → `POST /auth/sso/start` → assert it returns an `auth_url` containing the mock authorization endpoint + a `state` → simulate the IdP by calling `GET /auth/sso/callback?code=...&state=...` → assert a 302 to `http://127.0.0.1:<port>/?sso_code=...` → `POST /auth/sso/exchange { sso_code }` → assert a `LoginResponse` whose `user.email` matches the member, and that an unknown email is rejected.

```ts
// backend/test/sso-flow.test.ts
import { test, expect, beforeAll } from "bun:test";
import { Store } from "../src/lib/db.ts";
import { buildServeOptions } from "../src/server.ts";
import { fanout } from "../src/lib/matters.ts";
import { issueAuthTokens } from "../src/lib/services.ts";
import { hashPassword } from "../src/lib/crypto.ts";
import { generateKeyPairSync, createPublicKey, createSign } from "node:crypto";

function b64url(o: unknown) { return Buffer.from(JSON.stringify(o)).toString("base64url"); }

// A tiny mock IdP: discovery + jwks + token endpoint that signs an id_token.
function startMockIdp(opts: { email: string; nonceSink: { value?: string } }) {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = createPublicKey(publicKey).export({ format: "jwk" }) as any;
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
  const { auth_url } = await startRes.json();
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

  // 3) exchange
  const exRes = await fetch(base + "/auth/sso/exchange", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sso_code: ssoCode }),
  });
  expect(exRes.status).toBe(200);
  const login = await exRes.json();
  expect(login.user.email).toBe("jane@weston.com");
  expect(typeof login.access_token).toBe("string");

  // sso_code is single-use
  const replay = await fetch(base + "/auth/sso/exchange", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sso_code: ssoCode }),
  });
  expect(replay.status).toBe(401);
});
```

> Note: the test reads `nonce` out of the auth URL and feeds it to the mock so the signed token's nonce matches. In production the nonce is generated in `start`, stored in state, and the real IdP echoes it. The mock's `nonceSink` is shared across the single in-flight flow, which is fine for this single-flow test.

- [ ] **Step 2: Run it red.** `cd backend && bun test test/sso-flow.test.ts` → FAIL (404 on `/auth/sso/start`).

- [ ] **Step 3: Implement the member handlers** in `backend/src/routes/sso.ts`:

```ts
import { rateLimit } from "../lib/http.ts";
import { decryptSecret, hmacHash, generateSecretToken } from "../lib/crypto.ts";
import { issueAuthTokens, publicUser } from "../lib/services.ts";
import { putState, takeState, putCode, takeCode } from "../lib/ssoState.ts";
import {
  fetchDiscovery, fetchJwks, buildAuthUrl, exchangeCode, verifyIdToken,
  emailFromClaims, genVerifier, challengeFor, randomToken,
} from "../lib/oidc.ts";

/** POST /auth/sso/start { email, loopback_port } -> { auth_url, state } */
export async function handleSsoStart(req: Request, store: Store, ip: string): Promise<Response> {
  const rl = rateLimit(ip, "sso"); if (!rl.ok) return error("rate_limited", 429, `Try again in ${rl.retryAfter}s`);
  const body = await readJson<any>(req);
  if (!body || typeof body.email !== "string") return error("invalid_request", 400);
  const port = Number(body.loopback_port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return error("invalid_loopback_port", 400);

  // Authenticate-only: the email must belong to an existing active user whose org has SSO enabled.
  // Always return a generic shape on the "not eligible" path so we don't leak which emails exist.
  const user = store.getUserByEmailNorm(body.email);
  const cfg = user ? store.getOrgIdpConfig(user.org_id) : null;
  if (!user || user.status !== "active" || !cfg || !cfg.enabled) {
    return error("sso_unavailable", 404, "SSO is not available for this email. Ask your firm admin.");
  }

  let disco;
  try { disco = await fetchDiscovery(cfg.issuer); }
  catch { return error("idp_unreachable", 502, "Could not reach your identity provider."); }

  const state = randomToken();
  const nonce = randomToken();
  const verifier = genVerifier();
  putState(state, { orgId: user.org_id, issuer: cfg.issuer, clientId: cfg.client_id, codeVerifier: verifier, nonce, loopbackPort: port }, config.ssoStateTtlSeconds);

  const auth_url = buildAuthUrl({
    authorizationEndpoint: disco.authorization_endpoint,
    clientId: cfg.client_id, redirectUri: REDIRECT_URI,
    state, nonce, codeChallenge: challengeFor(verifier), loginHint: body.email.trim().toLowerCase(),
  });
  return json({ auth_url, state });
}

/** GET /auth/sso/callback?code&state -> 302 to the desktop loopback with a one-time sso_code. */
export async function handleSsoCallback(req: Request, store: Store): Promise<Response> {
  const u = new URL(req.url);
  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state") ?? "";
  const st = takeState(state);
  const fail = (reason: string, port?: number) =>
    port
      ? Response.redirect(`http://127.0.0.1:${port}/?sso_error=${encodeURIComponent(reason)}`, 302)
      : error("sso_failed", 400, reason);
  if (!st) return fail("invalid_or_expired_state");
  if (!code) return fail("missing_code", st.loopbackPort);

  const cfg = store.getOrgIdpConfig(st.orgId);
  if (!cfg || !cfg.enabled) return fail("sso_disabled", st.loopbackPort);
  const clientSecret = decryptSecret(cfg.client_secret_enc);
  if (!clientSecret) return fail("server_misconfig", st.loopbackPort);

  let claims;
  try {
    const disco = await fetchDiscovery(cfg.issuer);
    const { id_token } = await exchangeCode({
      tokenEndpoint: disco.token_endpoint, clientId: cfg.client_id, clientSecret,
      code, codeVerifier: st.codeVerifier, redirectUri: REDIRECT_URI,
    });
    const jwks = await fetchJwks(disco.jwks_uri);
    const verified = await verifyIdToken(id_token, { issuer: disco.issuer || cfg.issuer, clientId: cfg.client_id, nonce: st.nonce, jwks });
    if (!verified.ok) return fail(`id_token_${verified.reason}`, st.loopbackPort);
    claims = verified.claims;
  } catch (e) {
    return fail("token_exchange_failed", st.loopbackPort);
  }

  const email = emailFromClaims(claims);
  const matched = email ? store.getUserByEmailNorm(email) : null;
  if (!matched || matched.org_id !== st.orgId || matched.status !== "active") {
    store.audit({ org_id: st.orgId, actor_user_id: null, action: "sso.login.rejected", target: email ?? "unknown", detail: { reason: matched ? "org_or_status" : "no_user" } });
    return fail("no_matching_account", st.loopbackPort);
  }

  const ssoCode = generateSecretToken();
  putCode(hmacHash(ssoCode), { userId: matched.user_id }, config.ssoCodeTtlSeconds);
  store.audit({ org_id: st.orgId, actor_user_id: matched.user_id, action: "sso.login", target: matched.user_id, detail: { provider: cfg.provider } });
  return Response.redirect(`http://127.0.0.1:${st.loopbackPort}/?sso_code=${encodeURIComponent(ssoCode)}&state=${encodeURIComponent(state)}`, 302);
}

/** POST /auth/sso/exchange { sso_code } -> LoginResponse (same shape as /auth/login). */
export async function handleSsoExchange(req: Request, store: Store, ip: string): Promise<Response> {
  const rl = rateLimit(ip, "sso"); if (!rl.ok) return error("rate_limited", 429, `Try again in ${rl.retryAfter}s`);
  const body = await readJson<any>(req);
  if (!body || typeof body.sso_code !== "string") return error("invalid_request", 400);
  const entry = takeCode(hmacHash(body.sso_code));
  if (!entry) return error("invalid_sso_code", 401);
  const user = store.getUser(entry.userId);
  if (!user || user.status !== "active") return error("user_invalid", 403);
  const tokens = issueAuthTokens(store, user);
  return json({ user: publicUser(user), ...tokens });
}
```

> `REDIRECT_URI` and `requireAdminClaims` are already defined at the top of this file from Task 5; ensure the Task-5 imports (`json, error, readJson, authenticate, encryptSecret, config`) and Task-6 imports are merged into one import block at the top.

- [ ] **Step 4: Register member routes in `server.ts`** (in the `--- Auth ---` section, after `/auth/me`):

```ts
        if (path === "/auth/sso/start" && method === "POST") return await handleSsoStart(req, store, ip);
        if (path === "/auth/sso/callback" && method === "GET") return await handleSsoCallback(req, store);
        if (path === "/auth/sso/exchange" && method === "POST") return await handleSsoExchange(req, store, ip);
```
Add to the `sso.ts` import: `handleSsoStart, handleSsoCallback, handleSsoExchange`. And next to `startRateLimitGc()` / `startSyncTicketGc()` near the bottom of `server.ts`, add `startSsoStateGc();` (import it from `./lib/ssoState.ts`).

- [ ] **Step 5: Run it green.** `cd backend && bun test test/sso-flow.test.ts` → PASS. Then run the whole backend suite: `cd backend && bun test` → all green (no regressions).
- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat(firm/sso): member OIDC flow — start, callback, one-time-code exchange"`

---

### Task 7: Rust loopback SSO command (Tauri)

**Files:**
- Create: `src-tauri/src/commands/firm/mod.rs`, `src-tauri/src/commands/firm/sso.rs`
- Modify: `src-tauri/src/lib.rs` (declare `mod firm;` under commands + register `firm_sso_authenticate` in the invoke handler)
- Modify: `src-tauri/src/commands/mod.rs` if a `commands` module index exists (follow the existing `mail` registration pattern)
- Test: Rust unit tests inside `sso.rs` (`cargo test -p <crate> firm::sso` — match the crate name used by the gmail tests)

The command does the full desktop dance in Rust (reqwest), returning the backend's `LoginResponse` JSON to the frontend. Reuse `bind_loopback`, `open_browser`, and the redirect-line parsing approach from `commands/mail/gmail/oauth.rs`.

- [ ] **Step 1: Write the failing Rust unit test** (parser for the backend→loopback redirect, which carries `sso_code`/`sso_error`, not `code`/`state`):

```rust
// in src-tauri/src/commands/firm/sso.rs (tests module)
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_loopback_redirect_extracts_sso_code() {
        let got = parse_sso_redirect("GET /?sso_code=abc123&state=xyz HTTP/1.1");
        assert_eq!(got, SsoRedirect::Code("abc123".to_string()));
    }
    #[test]
    fn parse_loopback_redirect_surfaces_error() {
        let got = parse_sso_redirect("GET /?sso_error=no_matching_account HTTP/1.1");
        assert_eq!(got, SsoRedirect::Error("no_matching_account".to_string()));
    }
    #[test]
    fn parse_loopback_redirect_none_when_empty() {
        assert_eq!(parse_sso_redirect("GET / HTTP/1.1"), SsoRedirect::None);
    }
}
```

- [ ] **Step 2: Run it red.** `cd src-tauri && cargo test firm::sso` → FAIL (module missing).

- [ ] **Step 3: Implement `src-tauri/src/commands/firm/sso.rs`.** Reuse the gmail helpers (either `use crate::commands::mail::gmail::oauth::{bind_loopback, open_browser};` if they're `pub`, or copy the ~30 lines of `bind_loopback`/`open_browser`/the request-line read loop). The redirect parser is SSO-specific:

```rust
use anyhow::anyhow;
use serde::Serialize;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[derive(Debug, PartialEq, Eq)]
pub enum SsoRedirect { Code(String), Error(String), None }

/// Parse the backend->loopback redirect. Carries `sso_code` (success) or
/// `sso_error` (failure). Values are not percent-decoded here (the backend
/// percent-encodes; we decode after splitting). Returns the first present of
/// (error, code) — error takes precedence.
pub fn parse_sso_redirect(request_line: &str) -> SsoRedirect {
    let Some(after) = request_line.splitn(2, ' ').nth(1) else { return SsoRedirect::None };
    let Some(pathq) = after.splitn(2, ' ').next() else { return SsoRedirect::None };
    let Some(query) = pathq.splitn(2, '?').nth(1) else { return SsoRedirect::None };
    let mut code = None; let mut err = None;
    for pair in query.split('&') {
        let mut kv = pair.splitn(2, '=');
        match (kv.next().unwrap_or(""), kv.next().unwrap_or("")) {
            ("sso_code", v) => code = Some(decode(v)),
            ("sso_error", v) => err = Some(decode(v)),
            _ => {}
        }
    }
    if let Some(e) = err { SsoRedirect::Error(e) }
    else if let Some(c) = code { SsoRedirect::Code(c) }
    else { SsoRedirect::None }
}

fn decode(s: &str) -> String {
    // minimal percent-decode for the query value
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i+1..i+3], 16) { out.push(b); i += 3; continue; }
        }
        out.push(bytes[i]); i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[derive(Serialize)]
struct StartReq<'a> { email: &'a str, loopback_port: u16 }

/// Full desktop SSO dance. Returns the backend's LoginResponse JSON as a string.
#[tauri::command]
pub async fn firm_sso_authenticate(backend_base: String, email: String) -> Result<String, String> {
    run(backend_base, email).await.map_err(|e| e.to_string())
}

async fn run(backend_base: String, email: String) -> anyhow::Result<String> {
    let base = backend_base.trim_end_matches('/').to_string();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();

    let http = reqwest::Client::builder().timeout(Duration::from_secs(30)).build()?;
    let start: serde_json::Value = http.post(format!("{base}/auth/sso/start"))
        .json(&StartReq { email: &email, loopback_port: port })
        .send().await?.json().await?;
    let auth_url = start.get("auth_url").and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!(start.get("detail").and_then(|d| d.as_str()).unwrap_or("sso_start_failed").to_string()))?;

    if let Err(e) = open::that(auth_url) { log::warn!("firm sso: could not open browser: {e}"); }

    // Wait for the backend->loopback redirect (5 min).
    let code = await_sso_redirect(listener, Duration::from_secs(300)).await?;

    let exchange: serde_json::Value = http.post(format!("{base}/auth/sso/exchange"))
        .json(&serde_json::json!({ "sso_code": code }))
        .send().await?.json().await?;
    if exchange.get("access_token").is_none() {
        anyhow::bail!(exchange.get("error").and_then(|e| e.as_str()).unwrap_or("exchange_failed").to_string());
    }
    Ok(exchange.to_string())
}

async fn await_sso_redirect(listener: tokio::net::TcpListener, timeout: Duration) -> anyhow::Result<String> {
    tokio::time::timeout(timeout, async move {
        let (mut socket, _peer) = listener.accept().await?;
        let mut buf = Vec::with_capacity(4096);
        let mut tmp = [0u8; 1];
        loop {
            socket.read_exact(&mut tmp).await?;
            buf.push(tmp[0]);
            if buf.ends_with(b"\r\n") || buf.len() > 8192 { break; }
        }
        let line = String::from_utf8_lossy(&buf).trim_end().to_string();
        let html_ok = b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html><body>Signed in. You can close this tab and return to Advisor Prep Hero.</body></html>";
        let html_err = b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html><body>Sign-in failed. Return to Advisor Prep Hero and try again.</body></html>";
        match parse_sso_redirect(&line) {
            SsoRedirect::Code(c) => { let _ = socket.write_all(html_ok).await; let _ = socket.flush().await; Ok(c) }
            SsoRedirect::Error(e) => { let _ = socket.write_all(html_err).await; let _ = socket.flush().await; Err(anyhow!(e)) }
            SsoRedirect::None => { let _ = socket.write_all(html_err).await; Err(anyhow!("no_code_in_redirect")) }
        }
    }).await.map_err(|_| anyhow!("timed_out_waiting_for_sso"))?
}
```

- [ ] **Step 4: Wire the module.** In `src-tauri/src/commands/firm/mod.rs`: `pub mod sso;`. In `src-tauri/src/lib.rs` (or wherever `mail` commands are registered) add `firm::sso::firm_sso_authenticate` to `tauri::generate_handler![...]`, and ensure `mod firm;` is declared in the commands module index, mirroring how `mail` is wired. If `bind_loopback`/`open_browser` in gmail's `oauth.rs` are not `pub`, either make them `pub` or keep the self-contained copies above (the plan's code is self-contained — it does not depend on gmail symbols).

- [ ] **Step 5: Run it green.** `cd src-tauri && cargo test firm::sso` → PASS. Then `cargo build` to confirm the command registers and the crate compiles.
- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat(firm/sso): Tauri loopback command driving the OIDC desktop dance"`

---

### Task 8: Client contract mirror + FirmApiClient methods

**Files:**
- Modify: `src/modules/firm/contract.ts` (mirror the Task-5 shapes + endpoint paths)
- Modify: `src/modules/firm/FirmApiClient.ts` (add `ssoConfigGet/Set/Delete`)
- Test: `tests/unit/firm/ssoApiClient.test.ts` (create; mock `fetch`)

- [ ] **Step 1: Mirror the contract** — add to `src/modules/firm/contract.ts` the exact same `IdpProvider`, `SsoConfigSetRequest`, `SsoConfigView` types from Task 5, and add to `FIRM_ENDPOINTS`:

```ts
  ssoConfigSet: '/org/sso/config/set',
  ssoConfigGet: '/org/sso/config/get',
  ssoConfigDelete: '/org/sso/config/delete',
  ssoStart: '/auth/sso/start',
  ssoExchange: '/auth/sso/exchange',
```

- [ ] **Step 2: Write the failing test** for the client methods (mock `request`/`fetch` per the existing FirmApiClient test style — check `tests/` for how the client is exercised; if none, mock global `fetch`):

```ts
// tests/unit/firm/ssoApiClient.test.ts
import { describe, it, expect, vi } from "vitest";
import { FirmApiClient } from "@/modules/firm/FirmApiClient";

describe("FirmApiClient SSO config", () => {
  it("ssoConfigGet posts to the get endpoint with the access token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ configured: false, redirect_uri: "x" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new FirmApiClient(); // adapt to the real ctor signature
    const view = await client.ssoConfigGet("access-token-123");
    expect(view.configured).toBe(false);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/org/sso/config/get");
  });
});
```

- [ ] **Step 3: Run it red.** `npm run test -- tests/unit/firm/ssoApiClient.test.ts` → FAIL.

- [ ] **Step 4: Implement the methods** in `FirmApiClient.ts`, following the existing authed-POST helper (the class already has a private `request()` that attaches `Authorization: Bearer` and retries on 401 — reuse it; these are admin calls needing the access token):

```ts
async ssoConfigGet(accessToken: string): Promise<SsoConfigView> {
  return this.request(FIRM_ENDPOINTS.ssoConfigGet, { method: "POST", accessToken, body: {} });
}
async ssoConfigSet(accessToken: string, req: SsoConfigSetRequest): Promise<{ ok: true; redirect_uri: string }> {
  return this.request(FIRM_ENDPOINTS.ssoConfigSet, { method: "POST", accessToken, body: req });
}
async ssoConfigDelete(accessToken: string): Promise<{ ok: true }> {
  return this.request(FIRM_ENDPOINTS.ssoConfigDelete, { method: "POST", accessToken, body: {} });
}
```

> Match the real `request()` signature in `FirmApiClient.ts` (the Explore map cites it at ~line 137). If `request` takes positional args, adapt the calls. Import `SsoConfigView`, `SsoConfigSetRequest`, `FIRM_ENDPOINTS` from `./contract`.

- [ ] **Step 5: Run it green.** `npm run test -- tests/unit/firm/ssoApiClient.test.ts` → PASS.
- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat(firm/sso): client contract mirror + SSO-config API methods"`

---

### Task 9: `signInSso` store action

**Files:**
- Modify: `src/stores/firmStore.ts`
- Test: `tests/unit/firm/signInSso.test.ts` (create)

- [ ] **Step 1: Write the failing test** — mock the Tauri `invoke` to return a `LoginResponse` JSON string and assert `signInSso` runs the same post-login path (`storeAuthTokens`, sets `session.org`, caches `seatPublicKeyPem`). Mock `@tauri-apps/api/core`'s `invoke` and the `FirmApiClient` (`me`, `getSeatPublicKey`):

```ts
// tests/unit/firm/signInSso.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(JSON.stringify({
    user: { user_id: "u1", email: "jane@weston.com", role: "member", status: "active", created_at: "2026-01-01" },
    access_token: "at", access_expires_at: "2026-01-01", refresh_token: "rt", refresh_expires_at: "2026-02-01",
  })),
}));

describe("firmStore.signInSso", () => {
  beforeEach(() => { /* reset store + mock FirmApiClient.me/getSeatPublicKey + firmKeychain */ });

  it("authenticates via the Tauri command and establishes the session", async () => {
    const { useFirmStore } = await import("@/stores/firmStore");
    await useFirmStore.getState().signInSso("jane@weston.com");
    const st = useFirmStore.getState();
    expect(st.session?.user?.email).toBe("jane@weston.com");
    expect(st.accessToken).toBe("at");
  });
});
```

> Adapt the assertions to the real `firmStore` shape (the Explore map: `signIn` at firmStore.ts:170 does `login` → `storeAuthTokens` → `me` → `getSeatPublicKey` → persist session). The test should mock the same collaborators `signIn` uses.

- [ ] **Step 2: Run it red.** `npm run test -- tests/unit/firm/signInSso.test.ts` → FAIL.

- [ ] **Step 3: Implement `signInSso`** in `firmStore.ts`. Factor the shared post-login work out of `signIn` into a private helper `establishSession(tokens, user)` (if not already separable) and call it from both. The action:

```ts
signInSso: async (email: string) => {
  set({ signingIn: true, error: null });          // match the existing signIn loading flags
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const backendBase = FIRM_BACKEND_BASE;          // the same base FirmApiClient uses
    const raw = await invoke<string>("firm_sso_authenticate", { backendBase, email });
    const login = JSON.parse(raw) as LoginResponse; // { user, access_token, refresh_token, ... }
    const userId = login.user.user_id;
    await storeAuthTokens(userId, login.access_token, login.refresh_token);
    // Same post-login path as password signIn:
    const client = new FirmApiClient();
    const me = await client.me(login.access_token);
    const pem = await client.getSeatPublicKey();
    set((s) => ({
      accessToken: login.access_token,
      seatPublicKeyPem: pem,
      session: { ...s.session, user: login.user, org: me.org, activated: s.session?.activated ?? false },
      signingIn: false,
    }));
    // If already activated on this machine, validate the seat (mirror signIn).
    if (get().session?.activated) await get().validateSeat();
  } catch (e) {
    set({ signingIn: false, error: (e as Error).message || "SSO sign-in failed" });
    throw e;
  }
},
```

> Use the EXACT collaborators `signIn` uses (`storeAuthTokens`, the `FirmApiClient` instance pattern, the `session` shape, the loading/error field names). Add `signInSso` to the store's TypeScript interface. `FIRM_BACKEND_BASE` is whatever constant FirmApiClient resolves its base from — reuse it, don't hardcode.

- [ ] **Step 4: Run it green.** `npm run test -- tests/unit/firm/signInSso.test.ts` → PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(firm/sso): signInSso store action reusing the post-login session path"`

---

### Task 10: FirmSignIn — "Sign in with SSO"

**Files:**
- Modify: `src/components/firm/FirmSignIn.tsx`
- Test: `tests/unit/firm/FirmSignIn.sso.test.tsx` (create) — render, type an email, click "Sign in with SSO", assert `signInSso` called with that email; assert the button is hidden when not running under Tauri.

- [ ] **Step 1: Write the failing test** (React Testing Library; mock `firmStore.signInSso` + the Tauri-detection util the app uses, e.g. `isTauri()` from `src/utils`):

```tsx
// tests/unit/firm/FirmSignIn.sso.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FirmSignIn } from "@/components/firm/FirmSignIn";

const signInSso = vi.fn();
vi.mock("@/stores/firmStore", () => ({ useFirmStore: (sel: any) => sel({ signInSso, signIn: vi.fn(), session: null }) }));
vi.mock("@/utils/platform", () => ({ isTauri: () => true })); // adapt to the real detector

describe("FirmSignIn SSO", () => {
  it("calls signInSso with the entered email", async () => {
    render(<FirmSignIn />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "jane@weston.com" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in with sso/i }));
    expect(signInSso).toHaveBeenCalledWith("jane@weston.com");
  });
});
```

- [ ] **Step 2: Run it red.** `npm run test -- tests/unit/firm/FirmSignIn.sso.test.tsx` → FAIL.

- [ ] **Step 3: Implement.** In `FirmSignIn.tsx`, in the sign-in panel under the existing email/password form, add a divider and a "Sign in with SSO" button (light-theme styling, matching the existing shadcn/Tailwind look — per Jameson's light-theme preference). Only render it when running under Tauri (SSO needs the loopback command). On click, call `signInSso(email)` using the already-bound email field; show the existing error state on failure. No password needed for the SSO path.

```tsx
{isTauri() && (
  <>
    <div className="my-3 flex items-center gap-2 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
    </div>
    <Button type="button" variant="outline" className="w-full"
      onClick={() => signInSso(email)} disabled={!email || signingIn}>
      Sign in with SSO
    </Button>
    <p className="mt-1 text-xs text-muted-foreground">
      Use your firm's Microsoft, Google, or company login. Your admin sets this up.
    </p>
  </>
)}
```

- [ ] **Step 4: Run it green.** `npm run test -- tests/unit/firm/FirmSignIn.sso.test.tsx` → PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(firm/sso): Sign in with SSO affordance in FirmSignIn"`

---

### Task 11: FirmAdminConsole — SSO configuration section

**Files:**
- Modify: `src/components/firm/FirmAdminConsole.tsx`
- Test: `tests/unit/firm/FirmAdminConsole.sso.test.tsx` (create) — render, fill issuer/client_id/client_secret, save → `ssoConfigSet` called with those values; the displayed redirect URI is copyable; secret field is write-only (never pre-filled from `has_secret`).

- [ ] **Step 1: Write the failing test** (mock `FirmApiClient.ssoConfigGet/Set` + the store's `accessToken`):

```tsx
// tests/unit/firm/FirmAdminConsole.sso.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const ssoConfigGet = vi.fn().mockResolvedValue({ configured: false, redirect_uri: "https://api.keepance.com/auth/sso/callback" });
const ssoConfigSet = vi.fn().mockResolvedValue({ ok: true, redirect_uri: "https://api.keepance.com/auth/sso/callback" });
vi.mock("@/modules/firm/FirmApiClient", () => ({ FirmApiClient: vi.fn(() => ({ ssoConfigGet, ssoConfigSet })) }));
vi.mock("@/stores/firmStore", () => ({ useFirmStore: (sel: any) => sel({ accessToken: "at", session: { user: { role: "admin" } } }) }));

import { FirmAdminConsole } from "@/components/firm/FirmAdminConsole";

describe("FirmAdminConsole SSO", () => {
  it("saves SSO config", async () => {
    render(<FirmAdminConsole />);
    await waitFor(() => expect(ssoConfigGet).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText(/issuer/i), { target: { value: "https://login.microsoftonline.com/t/v2.0" } });
    fireEvent.change(screen.getByLabelText(/client id/i), { target: { value: "client-abc" } });
    fireEvent.change(screen.getByLabelText(/client secret/i), { target: { value: "shh" } });
    fireEvent.click(screen.getByRole("button", { name: /save sso/i }));
    await waitFor(() => expect(ssoConfigSet).toHaveBeenCalledWith("at", expect.objectContaining({
      issuer: "https://login.microsoftonline.com/t/v2.0", client_id: "client-abc", client_secret: "shh",
    })));
  });
});
```

- [ ] **Step 2: Run it red.** `npm run test -- tests/unit/firm/FirmAdminConsole.sso.test.tsx` → FAIL.

- [ ] **Step 3: Implement.** Add a "Single sign-on (SSO)" card to `FirmAdminConsole.tsx` (admin-only, which the whole console already is). Fields: provider `<select>` (Microsoft Entra ID / Google Workspace / Generic OIDC → `entra`/`google`/`generic`), issuer URL, client ID, client secret (write-only password input; show "secret saved" when `has_secret` && untouched), an `enabled` toggle, and a read-only, copyable **Redirect URI** the admin pastes into their IdP (value from `view.redirect_uri`), plus one help line per provider on where to register the app. Load via `ssoConfigGet(accessToken)` on mount; save via `ssoConfigSet`; a "Remove SSO" button calls `ssoConfigDelete`. Light theme, consistent with the existing console cards. Show the saved provider/issuer/client_id when `configured`.

- [ ] **Step 4: Run it green.** `npm run test -- tests/unit/firm/FirmAdminConsole.sso.test.tsx` → PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(firm/sso): admin SSO configuration UI in FirmAdminConsole"`

---

### Task 12: Full typecheck + suites + changelog

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Typecheck + lint.** Run `npx tsc --noEmit` (root) and `cd backend && bunx tsc --noEmit` (if the backend has a tsconfig) → no errors. `npm run lint` → clean.
- [ ] **Step 2: Full test suites.** `npm run test` (client), `cd backend && bun test` (backend), `cd src-tauri && cargo test` (Rust). All green. If any pre-existing failures exist, confirm they pre-date this branch (compare against HEAD before the wave) and note them; do not let SSO tests fail.
- [ ] **Step 3: Update `CHANGELOG.md`** under `## [Unreleased]`:

```markdown
### Added
- **SSO (OIDC) for firm tier** — members sign in through their organization's identity provider (Microsoft Entra ID, Google Workspace, or generic OIDC) via the system browser, exchanged into the existing seat-token session. Backend is a confidential OIDC relying party; per-org IdP config (issuer, client ID, encrypted client secret) is managed in the firm admin console. Authenticate-only: SSO signs in members an admin has already added — it never auto-creates accounts. SAML is out of scope for v1.
  - Files: `backend/src/lib/oidc.ts`, `backend/src/lib/ssoState.ts`, `backend/src/routes/sso.ts`, `backend/src/lib/db.ts` (org_idp_config), `src-tauri/src/commands/firm/sso.rs`, `src/stores/firmStore.ts` (signInSso), `src/components/firm/FirmSignIn.tsx`, `src/components/firm/FirmAdminConsole.tsx`
```

- [ ] **Step 4: Commit.** `git add -A && git commit -m "chore(firm/sso): typecheck, full suites green, changelog"`

---

### Task 13: Verification against Authentik + honesty-gated re-claim of "SSO"

**Files:**
- Create: `docs/quality/2026-06-11-wave3a-sso/RUNBOOK.md` + `RESULTS.md`
- Modify (only after the runbook is green): `src/config/pricing.ts`, website copy
- Test: manual/scripted against the server's Authentik

- [ ] **Step 1: Stand up a test IdP.** Use the Authentik instance on this server (or `docker run` Authentik if not already up). Create an OIDC "provider" + application: note the issuer (`https://<authentik>/application/o/<slug>/`), client_id, client_secret, and set the redirect URI to the backend's `https://api.keepance.com/auth/sso/callback` (or, for a local end-to-end test, run the backend locally and use its `SSO_CALLBACK_BASE`/loopback-reachable callback; document whichever you use). Create an Authentik user whose email matches a seeded Advisor Prep Hero member.

- [ ] **Step 2: Run the live flow.** With the backend pointed at the Authentik issuer (admin console "Save SSO"), launch the desktop app (`npm run tauri dev`), enter the member email on the firm sign-in screen, click **Sign in with SSO**, complete Authentik in the system browser, and confirm the app lands in the authenticated firm session (the member's `/auth/me` org shows, seat activation proceeds). Capture: a screenshot of the Authentik consent, the app post-login state, and the backend audit rows (`sso.login`). Write `RESULTS.md` with per-step verdicts; record any defects and fix them (re-review discipline — reviews have caught real bugs every wave).

- [ ] **Step 3: Negative checks.** Confirm: an Authentik user whose email is NOT a Advisor Prep Hero member is rejected at the callback (`no_matching_account`, audit `sso.login.rejected`); a tampered/expired flow fails closed; the client_secret never appears in any API response or log. Record in `RESULTS.md`.

- [ ] **Step 4: HONESTY GATE — only now re-claim SSO.** With Steps 2–3 green, re-instate the SSO claim that was removed in commit c0454da:
  - `src/config/pricing.ts`: add SSO back to the Firm tier's feature list (firm-tier only).
  - Website copy: re-add the SSO line to the firm/pricing sections (search the `website/` tree for where the other firm features are listed; mirror the voice rules — no em dashes, first-person where the page uses it).
  - **Do NOT deploy the website.** Per the standing guardrail, the production website deploy + any release publish waits for Jameson's explicit go. Commit the copy change with a message noting it ships with the next release.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(firm/sso): verified against Authentik; re-claim SSO on firm tier (deploy-gated)"` and push the branch.

---

## Self-Review (run after the plan is executed, before requesting final review)

1. **Spec coverage:** Entra/Google/generic OIDC auth-code flow ✓ (Tasks 2,5,6,7); per-org admin config ✓ (Tasks 1,5,11); system-browser sign-in exchanged into the Ed25519 seat token ✓ (Tasks 6,7,9 — `issueAuthTokens` → unchanged `/org/activate`); walls/seats unchanged ✓ (no seat/wall code touched); SAML out ✓ (not built); Authentik verification ✓ (Task 13); honesty rule ✓ (Task 13 gates the re-claim). Authenticate-only (no JIT) ✓ (Task 6 rejects unmatched emails).
2. **Placeholder scan:** none — every new module has full code; edits to existing files name exact files + insertion points and defer to the established pattern where a signature must be matched (flagged explicitly).
3. **Type consistency:** `OrgIdpConfig`, `IdpProvider`, `SsoConfigView`, `SsoConfigSetRequest`, `IdTokenClaims`, `SsoStateEntry` are defined once and reused; `FIRM_ENDPOINTS`/`ENDPOINTS` paths match between client and backend contracts; `issueAuthTokens`/`publicUser` reused verbatim from `services.ts`.

## Risks / watch-items for the executor
- **Matching existing signatures:** `FirmApiClient.request()`, the `firmStore` session shape, and the Tauri command-registration site are the three places to read the real code and conform (the plan flags each). Don't invent new patterns.
- **Entra email claim quirks:** some Entra tenants omit `email` and only emit `preferred_username`/`upn`; `emailFromClaims` handles that, but Task 13's Authentik run won't exercise it — note it as a residual to confirm on a real Entra tenant when one is available (the handoff allows "a real Entra tenant when available").
- **Discovery caching across config changes:** if an admin changes the issuer, the 1-hour disco/JWKS cache could serve stale endpoints. Acceptable for v1 (issuer rarely changes); if it bites in Task 13, key the cache include a config version or clear on `upsertOrgIdpConfig`.
