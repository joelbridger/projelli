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

import { json, error, readJson, authenticate } from "../lib/http.ts";
import { encryptSecret } from "../lib/crypto.ts";
import { config } from "../lib/config.ts";
import type { Store } from "../lib/db.ts";
import type { IdpProvider } from "../lib/types.ts";

const VALID_PROVIDERS = new Set<string>(["entra", "google", "generic"]);
const REDIRECT_URI = `${config.ssoCallbackBase.replace(/\/$/, "")}/auth/sso/callback`;

/** Require admin role; return { orgId, userId } or an error Response. */
function requireAdminClaims(req: Request): { ok: true; orgId: string; userId: string } | { ok: false; resp: Response } {
  const auth = authenticate(req);
  if (!auth.ok) return { ok: false, resp: error("unauthorized", 401, auth.reason) };
  if (auth.claims.role !== "admin") return { ok: false, resp: error("forbidden", 403, "admin_required") };
  return { ok: true, orgId: auth.claims.org_id, userId: auth.claims.sub };
}

// ---------------------------------------------------------------------------
// Admin: set / get / delete SSO config
// ---------------------------------------------------------------------------

export async function handleSsoConfigSet(req: Request, store: Store): Promise<Response> {
  const a = requireAdminClaims(req); if (!a.ok) return a.resp;
  const body = await readJson<{ provider?: unknown; issuer?: unknown; client_id?: unknown; client_secret?: unknown; enabled?: unknown }>(req);
  if (!body) return error("invalid_json", 400);
  const { provider, issuer, client_id, client_secret, enabled } = body;
  if (typeof provider !== "string" || !VALID_PROVIDERS.has(provider)) return error("invalid_provider", 400);
  // Length caps mirror http.isNonEmptyString's 512 default; the secret gets a generous 4 KB.
  if (typeof issuer !== "string" || issuer.length > 512 || !/^https:\/\//.test(issuer.trim())) return error("invalid_issuer", 400, "issuer must be an https URL");
  if (typeof client_id !== "string" || !client_id.trim() || client_id.length > 512) return error("invalid_client_id", 400);
  if (typeof client_secret !== "string" || !client_secret.trim() || client_secret.length > 4096) return error("invalid_client_secret", 400);
  store.upsertOrgIdpConfig({
    org_id: a.orgId, provider: provider as IdpProvider, issuer: issuer.trim(), client_id: client_id.trim(),
    client_secret_enc: encryptSecret(client_secret.trim()), enabled: !!enabled,
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

// ---------------------------------------------------------------------------
// Member flow handlers will be added here in Task 6:
//   export async function handleSsoStart(...)
//   export async function handleSsoCallback(...)
//   export async function handleSsoExchange(...)
// ---------------------------------------------------------------------------
