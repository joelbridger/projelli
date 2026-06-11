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
