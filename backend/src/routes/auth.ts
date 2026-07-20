/**
 * Identity / auth routes (firm members). Email + bcrypt password, short-lived
 * access JWT + rotating refresh token. Solo/local mode never touches any of
 * this — it's opt-in for firm users.
 *
 *   POST /auth/login    { email, password }            -> { user, access_token, refresh_token, ... }
 *   POST /auth/refresh  { refresh_token }              -> rotated tokens
 *   POST /auth/logout   { refresh_token }              -> revoke that refresh token
 *   GET  /auth/me       (Bearer access token)          -> the caller's identity
 *
 * NOTE — no public /auth/signup by design: an Org is the unit of purchase and
 * users belong to an org. Self-serve signup that mints a brand-new org is a
 * billing concern (LemonSqueezy -> POST /admin/org provisioning). Members are
 * created by an org admin (POST /org/users, see routes/admin.ts) or via the
 * dev bootstrap. So chunk 1 exposes login + refresh + logout + me here, and
 * admin-driven user creation in routes/admin.ts.
 */

import { type HttpRequest } from "../lib/requestBody.ts";
import { json, error, readJson, isEmail, rateLimit, authenticate } from "../lib/http.ts";
import { verifyPassword, hmacHash } from "../lib/crypto.ts";
import { issueAuthTokens, refreshAuthTokens, publicUser } from "../lib/services.ts";
import type { Store } from "../lib/db.ts";

export async function handleLogin(req: HttpRequest, store: Store, ip: string): Promise<Response> {
  const rl = rateLimit(ip, "login");
  if (!rl.ok) return error("rate_limited", 429, `Try again in ${rl.retryAfter}s`);

  const body = await readJson<{ email?: unknown; password?: unknown }>(req);
  if (!body) return error("invalid_json", 400);
  if (!isEmail(body.email) || typeof body.password !== "string") {
    return error("invalid_credentials", 401); // don't reveal which field
  }

  const row = store.getUserByEmailWithHash(body.email);
  // Always run a verify to keep timing roughly constant whether or not the user
  // exists (verifyPassword returns false on a dummy hash).
  const dummy = "$2b$12$0000000000000000000000000000000000000000000000000000a";
  const ok = await verifyPassword(body.password, row?.password_hash ?? dummy);
  if (!row || !ok) return error("invalid_credentials", 401);
  if (row.status !== "active") return error("user_deprovisioned", 403);

  const tokens = issueAuthTokens(store, row);
  return json({ user: publicUser(row), ...tokens });
}

export async function handleRefresh(req: HttpRequest, store: Store, ip: string): Promise<Response> {
  const rl = rateLimit(ip, "refresh");
  if (!rl.ok) return error("rate_limited", 429, `Try again in ${rl.retryAfter}s`);

  const body = await readJson<{ refresh_token?: unknown }>(req);
  if (!body || typeof body.refresh_token !== "string" || body.refresh_token.length === 0) {
    return error("invalid_request", 400);
  }
  const res = refreshAuthTokens(store, body.refresh_token);
  if (!res.ok) return error("invalid_refresh_token", 401, res.reason);
  return json(res.tokens);
}

export async function handleLogout(req: HttpRequest, store: Store): Promise<Response> {
  const body = await readJson<{ refresh_token?: unknown }>(req);
  if (!body || typeof body.refresh_token !== "string") return error("invalid_request", 400);
  const row = store.getRefreshTokenByHash(hmacHash(body.refresh_token));
  if (row) store.revokeRefreshToken(row.token_id);
  // Always 200 — logout is idempotent and shouldn't leak token validity.
  return json({ ok: true });
}

export function handleMe(req: HttpRequest, store: Store): Response {
  const auth = authenticate(req);
  if (!auth.ok) return error("unauthorized", 401, auth.reason);
  const user = store.getUser(auth.claims.sub);
  if (!user) return error("unauthorized", 401, "user_not_found");
  const org = store.getOrg(user.org_id);
  return json({ user: publicUser(user), org: org ? { org_id: org.org_id, name: org.name, plan: org.plan, packs: org.packs, seat_limit: org.seat_limit } : null });
}
