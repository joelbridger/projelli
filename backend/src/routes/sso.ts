/**
 * SSO (OIDC) routes — admin config + member flow.
 *
 * Admin handlers (this task, Task 5):
 *   POST /org/sso/config/set    — store/update an org's IdP config (secret encrypted at rest)
 *   POST /org/sso/config/get    — read config view (secret NEVER returned)
 *   POST /org/sso/config/delete — remove config
 *
 * Member handlers (Task 6, added below this block):
 *   POST /auth/sso/start        — initiate OIDC flow for a given email
 *   GET  /auth/sso/callback     — IdP redirect target; exchanges code, redirects to desktop loopback
 *   POST /auth/sso/exchange     — desktop swaps one-time sso_code for LoginResponse
 */

import { json, error, readJson, authenticate, rateLimit } from "../lib/http.ts";
import { encryptSecret, decryptSecret, hmacHash, generateSecretToken } from "../lib/crypto.ts";
import { config } from "../lib/config.ts";
import { issueAuthTokens, publicUser } from "../lib/services.ts";
import { putState, takeState, putCode, takeCode } from "../lib/ssoState.ts";
import {
  fetchDiscovery, fetchJwks, buildAuthUrl, exchangeCode, verifyIdToken,
  emailFromClaims, genVerifier, challengeFor, randomToken, isLoopbackIssuer,
} from "../lib/oidc.ts";
import type { Store } from "../lib/db.ts";
import type { IdpProvider } from "../lib/types.ts";

const VALID_PROVIDERS = new Set<string>(["entra", "google", "generic"]);
const REDIRECT_URI = `${config.ssoCallbackBase.replace(/\/$/, "")}/auth/sso/callback`;

/** Require admin role; return { orgId, userId } or an error Response. */
function requireAdminClaims(req: Request, store: Store): { ok: true; orgId: string; userId: string } | { ok: false; resp: Response } {
  const auth = authenticate(req, store);
  if (!auth.ok) return { ok: false, resp: error("unauthorized", 401, auth.reason) };
  if (auth.claims.role !== "admin") return { ok: false, resp: error("forbidden", 403, "admin_required") };
  return { ok: true, orgId: auth.claims.org_id, userId: auth.claims.sub };
}

// ---------------------------------------------------------------------------
// Admin: set / get / delete SSO config
// ---------------------------------------------------------------------------

export async function handleSsoConfigSet(req: Request, store: Store): Promise<Response> {
  const a = requireAdminClaims(req, store); if (!a.ok) return a.resp;
  const body = await readJson<{ provider?: unknown; issuer?: unknown; client_id?: unknown; client_secret?: unknown; enabled?: unknown }>(req);
  if (!body) return error("invalid_json", 400);
  const { provider, issuer, client_id, client_secret, enabled } = body;
  if (typeof provider !== "string" || !VALID_PROVIDERS.has(provider)) return error("invalid_provider", 400);
  // Length caps mirror http.isNonEmptyString's 512 default; the secret gets a generous 4 KB.
  if (typeof issuer !== "string" || issuer.length > 512) return error("invalid_issuer", 400, "issuer must be an https URL");
  const issuerTrimmed = issuer.trim();
  if (!isLoopbackIssuer(issuerTrimmed) && !/^https:\/\//.test(issuerTrimmed)) return error("invalid_issuer", 400, "issuer must be an https URL");
  if (typeof client_id !== "string" || !client_id.trim() || client_id.length > 512) return error("invalid_client_id", 400);

  // client_secret is optional on updates: if omitted/blank, preserve the existing encrypted secret.
  const secretProvided = typeof client_secret === "string" && client_secret.trim().length > 0;
  if (secretProvided && (client_secret as string).length > 4096) return error("invalid_client_secret", 400);

  // Determine which encrypted secret to store.
  let client_secret_enc: string;
  if (secretProvided) {
    client_secret_enc = encryptSecret((client_secret as string).trim());
  } else {
    // No new secret — look up the existing config.
    const existing = store.getOrgIdpConfig(a.orgId);
    if (!existing) {
      // First-time setup: a secret is required.
      return error("invalid_client_secret", 400, "a client secret is required for first-time setup");
    }
    client_secret_enc = existing.client_secret_enc;
  }

  store.upsertOrgIdpConfig({
    org_id: a.orgId, provider: provider as IdpProvider, issuer: issuerTrimmed, client_id: client_id.trim(),
    client_secret_enc, enabled: !!enabled,
  });
  store.audit({ org_id: a.orgId, actor_user_id: a.userId, action: "sso.config.set", target: a.orgId, detail: { provider, enabled: !!enabled } });
  return json({ ok: true, redirect_uri: REDIRECT_URI });
}

export function handleSsoConfigGet(req: Request, store: Store): Response {
  const a = requireAdminClaims(req, store); if (!a.ok) return a.resp;
  const cfg = store.getOrgIdpConfig(a.orgId);
  if (!cfg) return json({ configured: false, redirect_uri: REDIRECT_URI });
  return json({
    configured: true, provider: cfg.provider, issuer: cfg.issuer,
    client_id: cfg.client_id, enabled: cfg.enabled, has_secret: !!cfg.client_secret_enc,
    redirect_uri: REDIRECT_URI,
  });
}

export function handleSsoConfigDelete(req: Request, store: Store): Response {
  const a = requireAdminClaims(req, store); if (!a.ok) return a.resp;
  store.deleteOrgIdpConfig(a.orgId);
  store.audit({ org_id: a.orgId, actor_user_id: a.userId, action: "sso.config.delete", target: a.orgId });
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// Member flow: start / callback / exchange
// ---------------------------------------------------------------------------

/** POST /auth/sso/start { email, loopback_port } -> { auth_url, state } */
export async function handleSsoStart(req: Request, store: Store, ip: string): Promise<Response> {
  const rl = rateLimit(ip, "sso_start"); if (!rl.ok) return error("rate_limited", 429, `Try again in ${rl.retryAfter}s`);
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
export async function handleSsoCallback(req: Request, store: Store, ip: string): Promise<Response> {
  const rl = rateLimit(ip, "sso_callback"); if (!rl.ok) return error("rate_limited", 429, `Try again in ${rl.retryAfter}s`);
  const u = new URL(req.url);
  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state") ?? "";
  const st = takeState(state);
  const fail = (reason: string, port?: number) =>
    port
      ? Response.redirect(`http://127.0.0.1:${port}/?sso_error=${encodeURIComponent(reason)}`, 302)
      : error("sso_failed", 400, reason);
  if (!st) return fail("invalid_or_expired_state");
  // Surface IdP-reported errors (e.g. consent denied) before checking code.
  const idpError = u.searchParams.get("error");
  if (idpError) return fail(`idp_error_${idpError}`, st.loopbackPort);
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
    // Use cfg.issuer (the stored, admin-verified value) — not disco.issuer — to
    // prevent an adversarial discovery doc from influencing the trusted issuer.
    const verified = await verifyIdToken(id_token, { issuer: cfg.issuer, clientId: cfg.client_id, nonce: st.nonce, jwks });
    if (!verified.ok) return fail(`id_token_${verified.reason}`, st.loopbackPort);
    claims = verified.claims;
  } catch {
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
  return Response.redirect(`http://127.0.0.1:${st.loopbackPort}/?sso_code=${encodeURIComponent(ssoCode)}`, 302);
}

/** POST /auth/sso/exchange { sso_code } -> LoginResponse (same shape as /auth/login). */
export async function handleSsoExchange(req: Request, store: Store, ip: string): Promise<Response> {
  const rl = rateLimit(ip, "sso_exchange"); if (!rl.ok) return error("rate_limited", 429, `Try again in ${rl.retryAfter}s`);
  const body = await readJson<any>(req);
  if (!body || typeof body.sso_code !== "string") return error("invalid_request", 400);
  const entry = takeCode(hmacHash(body.sso_code));
  if (!entry) return error("invalid_sso_code", 401);
  const user = store.getUser(entry.userId);
  const org = user ? store.getOrg(user.org_id) : null;
  if (!user || user.status !== "active" || !org || org.status !== "active") return error("user_invalid", 403);
  const tokens = issueAuthTokens(store, user);
  return json({ user: publicUser(user), ...tokens });
}
