/**
 * Service layer: the business logic that sits between HTTP handlers and the
 * store. Pure-ish functions that take a Store, so tests can drive them against
 * an in-memory DB without booting the server.
 *
 * This is where seat tokens get minted, auth tokens issued/rotated, and the
 * licensing invariants (seat_limit, revocation, org status) live.
 */

import { config } from "./config.ts";
import {
  signAccessJwt,
  signSeatToken,
  verifySeatToken,
  generateSecretToken,
  hmacHash,
  nowSeconds,
} from "./crypto.ts";
import type { Store } from "./db.ts";
import type { Org, User, Seat, AccessTokenClaims, SeatTokenClaims } from "./types.ts";

// ---------------------------------------------------------------------------
// Auth tokens
// ---------------------------------------------------------------------------
export interface AuthTokens {
  access_token: string;
  access_expires_at: string; // ISO
  refresh_token: string;
  refresh_expires_at: string; // ISO
}

/** Issue a fresh access JWT + a new (stored, hashed) refresh token for a user. */
export function issueAuthTokens(store: Store, user: User): AuthTokens {
  const org = store.getOrg(user.org_id);
  if (user.status !== "active" || !org || org.status !== "active") throw new Error("inactive_auth_subject");
  const now = nowSeconds();
  const accessExp = now + config.accessTokenTtlSeconds;
  const refresh = generateSecretToken();
  const refreshExpSeconds = now + config.refreshTokenTtlSeconds;
  const refreshExpiresAt = new Date(refreshExpSeconds * 1000).toISOString();
  const sid = store.createRefreshToken({
    user_id: user.user_id,
    token_hash: hmacHash(refresh),
    expires_at: refreshExpiresAt,
  });
  const claims: AccessTokenClaims = {
    sub: user.user_id, org_id: user.org_id, role: user.role, email: user.email,
    iss: config.issuer, iat: now, exp: accessExp, typ: "access", sid,
  };
  const access = signAccessJwt(claims as unknown as Record<string, unknown>);

  return {
    access_token: access,
    access_expires_at: new Date(accessExp * 1000).toISOString(),
    refresh_token: refresh,
    refresh_expires_at: refreshExpiresAt,
  };
}

export type RefreshResult =
  | { ok: true; tokens: AuthTokens }
  | { ok: false; reason: "invalid" | "expired" | "revoked" | "user_inactive" | "org_inactive" | "authority_unavailable" };

/** Exchange a refresh token for a new access token + rotated refresh token. */
export function refreshAuthTokens(store: Store, presentedRefresh: string): RefreshResult {
  let row;
  try { row = store.getRefreshTokenByHash(hmacHash(presentedRefresh)); }
  catch { return { ok: false, reason: "authority_unavailable" }; }
  if (!row) return { ok: false, reason: "invalid" };
  if (row.revoked_at) return { ok: false, reason: "revoked" };
  if (new Date(row.expires_at).getTime() <= Date.now()) return { ok: false, reason: "expired" };

  const user = store.getUser(row.user_id);
  if (!user || user.status !== "active") return { ok: false, reason: "user_inactive" };
  const org = store.getOrg(user.org_id);
  if (!org || org.status !== "active") return { ok: false, reason: "org_inactive" };

  // Rotate the refresh token (one-time use). Reuse of the old token afterwards
  // is rejected as revoked — basic refresh-token reuse protection.
  const now = nowSeconds();
  const newRefresh = generateSecretToken();
  const refreshExpiresAt = new Date((now + config.refreshTokenTtlSeconds) * 1000).toISOString();
  const sid = store.rotateRefreshToken({
    old_token_id: row.token_id,
    user_id: user.user_id,
    new_token_hash: hmacHash(newRefresh),
    expires_at: refreshExpiresAt,
  });

  const accessExp = now + config.accessTokenTtlSeconds;
  const claims: AccessTokenClaims = {
    sub: user.user_id,
    org_id: user.org_id,
    role: user.role,
    email: user.email,
    iss: config.issuer,
    iat: now,
    exp: accessExp,
    typ: "access",
    sid,
  };
  return {
    ok: true,
    tokens: {
      access_token: signAccessJwt(claims as unknown as Record<string, unknown>),
      access_expires_at: new Date(accessExp * 1000).toISOString(),
      refresh_token: newRefresh,
      refresh_expires_at: refreshExpiresAt,
    },
  };
}

// ---------------------------------------------------------------------------
// Seat tokens
// ---------------------------------------------------------------------------
/** Mint a signed seat token for a bound seat. Entitlements come from the org. */
export function mintSeatToken(org: Org, user: User, seat: Seat): { token: string; expiresAt: string; claims: SeatTokenClaims } {
  const now = nowSeconds();
  const exp = now + config.seatTokenTtlSeconds;
  const claims: SeatTokenClaims = {
    org_id: org.org_id,
    user_id: user.user_id,
    seat_id: seat.seat_id,
    machine_id: seat.machine_id,
    tier: org.plan,
    packs: org.packs,
    seats: org.seat_limit,
    iss: config.issuer,
    sub: user.user_id,
    iat: now,
    exp,
  };
  return {
    token: signSeatToken(claims as unknown as Record<string, unknown>, config.seatPrivateKey),
    expiresAt: new Date(exp * 1000).toISOString(),
    claims,
  };
}

export interface SeatActivationResult {
  status: "activated" | "seat_limit_exceeded" | "license_invalid" | "license_disabled" | "org_suspended" | "user_invalid";
  http: number;
  body: Record<string, unknown>;
}

/**
 * The core /org/activate flow: verify the license key + the authenticated user,
 * bind a seat under the org's seat_limit, and return a signed seat token. The
 * N+1 machine fails closed with the current seat list so an admin can act.
 */
export function activateSeatForUser(
  store: Store,
  input: { user: User; licenseKey: string; machineId: string; machineLabel: string | null },
): SeatActivationResult {
  const { user } = input;

  if (user.status !== "active") {
    return { status: "user_invalid", http: 403, body: { error: "user_deprovisioned" } };
  }

  const lk = store.getLicenseKeyByHash(hmacHash(input.licenseKey));
  if (!lk || lk.org_id !== user.org_id) {
    store.audit({ org_id: user.org_id, actor_user_id: user.user_id, action: "seat.validate.rejected", target: input.machineId, detail: { reason: "license_invalid" } });
    return { status: "license_invalid", http: 403, body: { error: "invalid_license" } };
  }
  if (lk.status !== "active") {
    return { status: "license_disabled", http: 403, body: { error: "license_disabled" } };
  }

  const org = store.getOrg(user.org_id);
  if (!org) return { status: "license_invalid", http: 403, body: { error: "invalid_license" } };
  if (org.status !== "active") {
    return { status: "org_suspended", http: 403, body: { error: "org_suspended" } };
  }

  // The license key may carry a smaller seat_limit than the org; honour the
  // tighter of the two (defence in depth — the key is the issued entitlement).
  const seatLimit = Math.min(org.seat_limit, lk.seat_limit);

  const res = store.activateSeat({
    org_id: org.org_id,
    user_id: user.user_id,
    machine_id: input.machineId,
    machine_label: input.machineLabel,
    seat_limit: seatLimit,
  });

  if (!res.ok) {
    // Fail closed; hand the admin the current seat list so they can revoke/transfer.
    const seats = store.listSeats(org.org_id).filter((s) => s.status === "active");
    store.audit({
      org_id: org.org_id,
      actor_user_id: user.user_id,
      action: "seat.activate.rejected_seat_limit",
      target: input.machineId,
      detail: { seat_limit: seatLimit, active: seats.length },
    });
    return {
      status: "seat_limit_exceeded",
      http: 409,
      body: {
        error: "seat_limit_exceeded",
        detail: `All ${seatLimit} seats are in use. An admin must revoke or transfer a seat.`,
        seat_limit: seatLimit,
        seats: seats.map(publicSeat),
      },
    };
  }

  const { token, expiresAt, claims } = mintSeatToken(org, user, res.seat);
  store.audit({
    org_id: org.org_id,
    actor_user_id: user.user_id,
    action: "seat.activate",
    target: res.seat.seat_id,
    detail: { machine_id: input.machineId, reused: res.reused },
  });

  // Response shape stays compatible with the client's existing /activate reader
  // (token, tier, packs, seats, expires_at), plus the new seat identifiers.
  return {
    status: "activated",
    http: 200,
    body: {
      token,
      seat_token: token, // explicit alias for the new client contract
      tier: claims.tier,
      packs: claims.packs,
      seats: claims.seats,
      seat_id: res.seat.seat_id,
      machine_id: res.seat.machine_id,
      expires_at: expiresAt,
    },
  };
}

export type SeatValidationResult =
  | { valid: true; body: Record<string, unknown> }
  | { valid: false; reason: string };

/**
 * Validate a presented seat token: signature + expiry (offline-equivalent),
 * then the online checks the client can't do — seat revoked? org suspended?
 * user deprovisioned? Returns the current plan/seats/used so the client can
 * refresh its view.
 */
export function validateSeatToken(store: Store, seatToken: string): SeatValidationResult {
  const res = verifySeatToken<SeatTokenClaims>(seatToken, config.seatPublicKey);
  if (!res.valid) return { valid: false, reason: res.reason };
  const claims = res.payload;

  const seat = store.getSeat(claims.seat_id);
  if (!seat) return { valid: false, reason: "seat_not_found" };
  if (seat.status === "revoked") return { valid: false, reason: "revoked" };

  const org = store.getOrg(claims.org_id);
  if (!org) return { valid: false, reason: "org_not_found" };
  if (org.status !== "active") return { valid: false, reason: "org_suspended" };

  const user = store.getUser(claims.user_id);
  if (!user || user.status !== "active") return { valid: false, reason: "user_deprovisioned" };

  const used = store.countActiveSeats(org.org_id);
  return {
    valid: true,
    body: {
      valid: true,
      tier: org.plan,
      packs: org.packs,
      seats: org.seat_limit,
      seats_used: used,
      seat_id: seat.seat_id,
      expires_at: claims.exp ? new Date(claims.exp * 1000).toISOString() : null,
    },
  };
}

/** Heartbeat: like validate, but also bumps last_seen so admins can spot idle seats. */
export function heartbeatSeat(store: Store, seatToken: string): SeatValidationResult {
  const result = validateSeatToken(store, seatToken);
  if (result.valid) {
    const res = verifySeatToken<SeatTokenClaims>(seatToken, config.seatPublicKey);
    if (res.valid) {
      store.touchSeat(res.payload.seat_id);
      store.audit({ org_id: res.payload.org_id, actor_user_id: res.payload.user_id, action: "seat.heartbeat", target: res.payload.seat_id });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Presentation helpers (never leak hashes / internal columns)
// ---------------------------------------------------------------------------
export function publicSeat(s: Seat): Record<string, unknown> {
  const inactiveCutoff = Date.now() - config.seatInactiveAfterSeconds * 1000;
  return {
    seat_id: s.seat_id,
    user_id: s.user_id,
    machine_id: s.machine_id,
    machine_label: s.machine_label,
    status: s.status,
    bound_at: s.bound_at,
    last_seen: s.last_seen,
    inactive: s.status === "active" && new Date(s.last_seen).getTime() < inactiveCutoff,
    revoked_at: s.revoked_at,
    revoked_reason: s.revoked_reason,
  };
}

export function publicUser(u: User): Record<string, unknown> {
  return { user_id: u.user_id, email: u.email, role: u.role, status: u.status, created_at: u.created_at };
}
