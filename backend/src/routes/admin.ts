/**
 * Admin routes — all require a valid access token whose `role` is `admin` AND
 * whose `org_id` matches the org being acted on (no cross-org access).
 *
 *   POST /org/seats            -> list this org's seats (who / machine / last seen / inactive)
 *   POST /org/seat/revoke      { seat_id }            -> revoke one machine binding
 *   POST /org/user/deprovision { user_id }            -> revoke all the user's seats + tokens
 *   POST /org/seats/transfer   { from_seat_id, to_user_id, to_machine_id, to_machine_label? }
 *   POST /org/users            { email, password, role? }  -> create a member in this org
 *   GET/POST /org/audit        -> recent license/identity audit events
 *
 * Provisioning an Org + its first license key is a billing-side action, exposed
 * here as:
 *   POST /admin/org            { name, plan, packs?, seat_limit, admin_email, admin_password }
 *       -> creates org + admin user + an initial license key. Returns the
 *          plaintext license_key ONCE (never stored in plaintext).
 *
 * /admin/org uses the backend's existing Bearer-header mechanism with a
 * dedicated global provisioning credential. The edge block remains an
 * additional outer control.
 */

import { type HttpRequest } from "../lib/requestBody.ts";
import { json, error, readJson, isNonEmptyString, isEmail, isValidPassword, sanitizePacks, VALID_PLANS, authenticate, getBearer } from "../lib/http.ts";
import { config } from "../lib/config.ts";
import { hashPassword, generateLicenseKey, hmacEquals, hmacHash } from "../lib/crypto.ts";
import { publicSeat, publicUser, mintSeatToken } from "../lib/services.ts";
import type { Store } from "../lib/db.ts";
import type { AccessTokenClaims, Plan, ProfessionPack } from "../lib/types.ts";

/** Require admin role + return the verified claims, or an error Response. */
function requireAdmin(req: HttpRequest, store: Store): { ok: true; claims: AccessTokenClaims } | { ok: false; resp: Response } {
  const auth = authenticate(req, store);
  if (!auth.ok) return { ok: false, resp: error("unauthorized", 401, auth.reason) };
  if (auth.claims.role !== "admin") return { ok: false, resp: error("forbidden", 403, "admin_required") };
  return { ok: true, claims: auth.claims };
}

/** Global provisioning uses the existing Bearer header with a dedicated ops credential. */
function requireProvisioner(req: HttpRequest): { ok: true } | { ok: false; resp: Response } {
  const presented = getBearer(req) ?? "";
  if (!config.adminProvisionSecret || !hmacEquals(presented, hmacHash(config.adminProvisionSecret))) {
    return { ok: false, resp: error("unauthorized", 401) };
  }
  return { ok: true };
}

export async function handleListSeats(req: HttpRequest, store: Store): Promise<Response> {
  const a = requireAdmin(req, store);
  if (!a.ok) return a.resp;
  const org = store.getOrg(a.claims.org_id);
  if (!org) return error("org_not_found", 404);
  const seats = store.listSeats(org.org_id);
  return json({
    org_id: org.org_id,
    plan: org.plan,
    packs: org.packs,
    seat_limit: org.seat_limit,
    seats_used: seats.filter((s) => s.status === "active").length,
    seats: seats.map(publicSeat),
  });
}

export async function handleRevokeSeat(req: HttpRequest, store: Store): Promise<Response> {
  const a = requireAdmin(req, store);
  if (!a.ok) return a.resp;
  const body = await readJson<{ seat_id?: unknown; reason?: unknown }>(req);
  if (!body || !isNonEmptyString(body.seat_id, 64)) return error("missing_fields", 400);

  const seat = store.getSeat(body.seat_id);
  if (!seat) return error("seat_not_found", 404);
  if (seat.org_id !== a.claims.org_id) return error("forbidden", 403, "cross_org");

  const reason = isNonEmptyString(body.reason, 256) ? body.reason.trim() : "admin_revoked";
  const done = store.revokeSeat(seat.seat_id, reason);
  if (done) {
    store.audit({ org_id: seat.org_id, actor_user_id: a.claims.sub, action: "seat.revoke", target: seat.seat_id, detail: { reason } });
  }
  return json({ ok: true, seat_id: seat.seat_id, revoked: done });
}

export async function handleDeprovisionUser(req: HttpRequest, store: Store): Promise<Response> {
  const a = requireAdmin(req, store);
  if (!a.ok) return a.resp;
  const body = await readJson<{ user_id?: unknown }>(req);
  if (!body || !isNonEmptyString(body.user_id, 64)) return error("missing_fields", 400);

  const target = store.getUser(body.user_id);
  if (!target) return error("user_not_found", 404);
  if (target.org_id !== a.claims.org_id) return error("forbidden", 403, "cross_org");

  // Revoke all seats, invalidate all refresh tokens, mark deprovisioned.
  const seatsRevoked = store.revokeAllSeatsForUser(target.user_id, "user_deprovisioned");
  store.revokeAllRefreshTokensForUser(target.user_id);
  store.setUserStatus(target.user_id, "deprovisioned");
  store.audit({ org_id: target.org_id, actor_user_id: a.claims.sub, action: "user.deprovision", target: target.user_id, detail: { seats_revoked: seatsRevoked } });

  // NOTE for chunk 2/3: this is also the signal to stop releasing per-matter
  // keys to this user (DECISION.md §4). Hook the matter-key service here.
  return json({ ok: true, user_id: target.user_id, seats_revoked: seatsRevoked });
}

export async function handleTransferSeat(req: HttpRequest, store: Store): Promise<Response> {
  const a = requireAdmin(req, store);
  if (!a.ok) return a.resp;
  const body = await readJson<{ from_seat_id?: unknown; to_user_id?: unknown; to_machine_id?: unknown; to_machine_label?: unknown }>(req);
  if (!body || !isNonEmptyString(body.from_seat_id, 64) || !isNonEmptyString(body.to_user_id, 64) || !isNonEmptyString(body.to_machine_id, 128)) {
    return error("missing_fields", 400);
  }
  const from = store.getSeat(body.from_seat_id);
  if (!from) return error("seat_not_found", 404);
  if (from.org_id !== a.claims.org_id) return error("forbidden", 403, "cross_org");

  const toUser = store.getUser(body.to_user_id);
  if (!toUser) return error("user_not_found", 404);
  if (toUser.org_id !== a.claims.org_id) return error("forbidden", 403, "cross_org");
  if (toUser.status !== "active") return error("user_deprovisioned", 403);

  const label = isNonEmptyString(body.to_machine_label, 128) ? body.to_machine_label.trim() : null;
  const res = store.transferSeat({
    from_seat_id: from.seat_id,
    to_user_id: toUser.user_id,
    to_machine_id: body.to_machine_id.trim(),
    to_machine_label: label,
  });
  if (!res.ok) return error("transfer_failed", 409, res.reason);

  store.audit({ org_id: from.org_id, actor_user_id: a.claims.sub, action: "seat.transfer", target: res.seat.seat_id, detail: { from_seat_id: from.seat_id, to_user_id: toUser.user_id } });

  // Mint a fresh seat token for the new binding so the admin can hand it over
  // (or the target re-activates and gets its own).
  const org = store.getOrg(from.org_id)!;
  const minted = mintSeatToken(org, toUser, res.seat);
  return json({ ok: true, seat: publicSeat(res.seat), seat_token: minted.token, expires_at: minted.expiresAt });
}

export async function handleCreateUser(req: HttpRequest, store: Store): Promise<Response> {
  const a = requireAdmin(req, store);
  if (!a.ok) return a.resp;
  const body = await readJson<{ email?: unknown; password?: unknown; role?: unknown }>(req);
  if (!body) return error("invalid_json", 400);
  if (!isEmail(body.email)) return error("invalid_email", 400);
  if (!isValidPassword(body.password)) return error("weak_password", 400, "Password must be at least 12 characters.");
  const role = body.role === "admin" ? "admin" : "member";

  if (store.getUserByEmailWithHash((body.email as string).trim())) {
    return error("email_taken", 409);
  }
  const hash = await hashPassword(body.password as string);
  const user = store.createUser({ org_id: a.claims.org_id, email: (body.email as string).trim(), password_hash: hash, role });
  store.audit({ org_id: a.claims.org_id, actor_user_id: a.claims.sub, action: "user.create", target: user.user_id, detail: { role } });
  return json({ user: publicUser(user) }, 201);
}

export function handleAudit(req: HttpRequest, store: Store): Response {
  const a = requireAdmin(req, store);
  if (!a.ok) return a.resp;
  return json({ events: store.listAudit(a.claims.org_id) });
}

/**
 * POST /org/users/list (admin only) — returns every user in the admin's org
 * with their user_id, email, role, and status. Admins use this to resolve
 * user_ids to emails in the admin console and to look up existing users before
 * inviting them to a matter (avoiding the create-then-409 pattern).
 *
 * Access: role=admin in the same org. Never crosses org boundaries.
 */
export function handleListOrgUsers(req: HttpRequest, store: Store): Response {
  const a = requireAdmin(req, store);
  if (!a.ok) return a.resp;
  const users = store.listOrgUsers(a.claims.org_id);
  return json({ users });
}

/**
 * Provision a brand-new org + admin + initial license key. The caller must be
 * the dedicated provisioning Bearer credential; the privileged route registry
 * also enforces this before dispatch, and this inner check keeps direct handler
 * calls fail-closed. Returns the license key plaintext exactly once.
 */
export async function handleCreateOrg(req: HttpRequest, store: Store): Promise<Response> {
  const a = requireProvisioner(req);
  if (!a.ok) return a.resp;
  const body = await readJson<{
    name?: unknown;
    plan?: unknown;
    packs?: unknown;
    seat_limit?: unknown;
    admin_email?: unknown;
    admin_password?: unknown;
    billing_customer_id?: unknown;
  }>(req);
  if (!body) return error("invalid_json", 400);
  if (!isNonEmptyString(body.name, 200)) return error("invalid_name", 400);
  if (typeof body.plan !== "string" || !VALID_PLANS.has(body.plan)) return error("invalid_plan", 400);
  if (typeof body.seat_limit !== "number" || !Number.isInteger(body.seat_limit) || body.seat_limit < 1 || body.seat_limit > 10000) {
    return error("invalid_seat_limit", 400);
  }
  if (!isEmail(body.admin_email)) return error("invalid_admin_email", 400);
  if (!isValidPassword(body.admin_password)) return error("weak_password", 400, "Admin password must be at least 12 characters.");

  if (store.getUserByEmailWithHash((body.admin_email as string).trim())) {
    return error("email_taken", 409);
  }

  const plan = body.plan as Plan;
  const packs = sanitizePacks(body.packs) as ProfessionPack[];
  const org = store.createOrg({
    name: body.name.trim(),
    plan,
    packs,
    seat_limit: body.seat_limit,
    billing_customer_id: isNonEmptyString(body.billing_customer_id, 128) ? body.billing_customer_id.trim() : null,
  });
  const hash = await hashPassword(body.admin_password as string);
  const admin = store.createUser({ org_id: org.org_id, email: (body.admin_email as string).trim(), password_hash: hash, role: "admin" });

  const licenseKey = generateLicenseKey();
  const lk = store.createLicenseKey({ org_id: org.org_id, key_hash: hmacHash(licenseKey), plan, packs, seat_limit: body.seat_limit });

  store.audit({ org_id: org.org_id, actor_user_id: admin.user_id, action: "org.create", target: org.org_id, detail: { plan, seat_limit: body.seat_limit } });
  store.audit({ org_id: org.org_id, actor_user_id: admin.user_id, action: "license.issue", target: lk.key_id, detail: { plan } });

  return json(
    {
      org: { org_id: org.org_id, name: org.name, plan: org.plan, packs: org.packs, seat_limit: org.seat_limit },
      admin: publicUser(admin),
      // Shown ONCE. The server stores only a keyed hash.
      license_key: licenseKey,
    },
    201,
  );
}
