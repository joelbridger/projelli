/**
 * OIDC relying-party primitives for the firm SSO flow. The backend is a
 * CONFIDENTIAL client: it holds each org's client_secret and exchanges the
 * authorization code server-side. ID tokens are RS256-signed by the IdP and
 * verified here against the IdP's JWKS (iss/aud/exp/nonce all checked).
 */
import { createVerify, createPublicKey, randomBytes, createHash } from "node:crypto";

/** True for http(s) URLs whose host is exactly a loopback address (127.0.0.1 / ::1).
 *  Used to exempt local test IdPs from the https-only requirement; real hostnames
 *  (incl. tricks like http://127.0.0.1.evil.com) must return false. */
export function isLoopbackIssuer(url: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|\[::1\]|::1)(:\d+)?(\/|$)/.test(url.trim());
}

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
  const normalizedIssuer = issuer.replace(/\/$/, "");
  const cached = discoCache.get(normalizedIssuer);
  if (cached && Date.now() - cached.at < DISCO_TTL_MS) return cached.disco;
  const wellKnown = normalizedIssuer + "/.well-known/openid-configuration";
  const res = await get(wellKnown);
  if (res.status !== 200 || !res.json?.token_endpoint) throw new Error("oidc_discovery_failed");
  const disco = res.json as OidcDiscovery;

  // Fix 1 (I-1): RFC 8414 §3.3 — returned issuer MUST match the requested issuer (trailing-slash normalized)
  if ((disco.issuer ?? "").replace(/\/$/, "") !== normalizedIssuer) {
    throw new Error("oidc_issuer_mismatch");
  }

  // Fix 2 (M-6): all endpoint URLs must use https:// — unless the issuer is a loopback
  // address (127.0.0.1 or ::1), which is test/dev-only and can never appear in production.
  const isLoopback = isLoopbackIssuer(normalizedIssuer);
  const endpoints: (string | undefined)[] = [disco.authorization_endpoint, disco.token_endpoint, disco.jwks_uri];
  if (!isLoopback && endpoints.some((ep) => typeof ep !== "string" || !ep.startsWith("https://"))) {
    throw new Error("oidc_insecure_endpoint");
  }

  discoCache.set(normalizedIssuer, { at: Date.now(), disco });
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

  // Fix 4 (M-5): guard non-object header/claims (e.g. base64url-encoded null or array)
  if (typeof header !== "object" || header === null || Array.isArray(header)) return { ok: false, reason: "malformed" };
  if (typeof claims !== "object" || claims === null || Array.isArray(claims)) return { ok: false, reason: "malformed" };

  if (header.alg !== "RS256") return { ok: false, reason: "bad_alg" };

  // Fix 3 (I-3): kid-miss must try ALL JWKS keys (supports IdP key rotation)
  // If kid is present in the header, prefer the matching key; if none match (rotation),
  // attempt verification against every key and accept if any succeeds.
  const keys = opts.jwks.keys;
  if (keys.length === 0) return { ok: false, reason: "no_jwk" };

  const headerKid: string | undefined = header.kid;
  // Build an ordered candidate list: matching-kid key first, then all remaining keys.
  const preferredIdx = headerKid !== undefined ? keys.findIndex((k) => k.kid === headerKid) : -1;
  const orderedKeys = preferredIdx >= 0
    ? [keys[preferredIdx], ...keys.slice(0, preferredIdx), ...keys.slice(preferredIdx + 1)]
    : [...keys];

  const signingInput = `${h}.${p}`;
  const sigBuf = Buffer.from(s, "base64url");
  let sigOk = false;
  for (const jwk of orderedKeys) {
    let pub;
    try { pub = createPublicKey({ key: jwk as any, format: "jwk" }); }
    catch { continue; } // malformed key — skip, not fatal
    try {
      const verifier = createVerify("RSA-SHA256");
      verifier.update(signingInput);
      if (verifier.verify(pub, sigBuf)) { sigOk = true; break; }
    } catch { continue; }
  }
  if (!sigOk) return { ok: false, reason: "signature_invalid" };

  // Fix 5 (M-2): allow ±60s clock-skew on exp
  const CLOCK_SKEW_S = 60;
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (claims.iss !== opts.issuer) return { ok: false, reason: "iss_mismatch" };
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(opts.clientId)) return { ok: false, reason: "aud_mismatch" };
  if (typeof claims.exp !== "number" || claims.exp < now - CLOCK_SKEW_S) return { ok: false, reason: "expired" };
  if (typeof claims.iat !== "number" || claims.iat > now + 60 || claims.iat < now - 600) return { ok: false, reason: "iat_invalid" };
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
