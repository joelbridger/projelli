/**
 * CLIENT-FACING API CONTRACT (chunk 1: identity + licensing).
 *
 * This file is the single source of truth for the request/response shapes the
 * Keepance desktop app (and the future admin UI) speak to this backend. It is
 * intentionally dependency-free and self-contained so it can be copied into, or
 * imported by, the desktop repo's `src/` to wire `useLicense.ts` and an admin
 * surface to the real server. Keep this in sync with routes/*.ts.
 *
 * Compatibility note: the desktop client today (src/hooks/useLicense.ts) POSTs
 * `/activate { license_key, machine_id }` and `/validate { token }`, reading
 * back `{ token, tier, packs, seats, expires_at }` / `{ valid, tier, ... }`.
 * The new contract PRESERVES those field names and adds the firm pieces:
 *   - `/org/activate` is the new activate (requires a firm access token + binds
 *     a real seat); it still returns `token`/`tier`/`packs`/`seats`/`expires_at`,
 *     so the client's existing reader keeps working, plus `seat_id`.
 *   - `/seat/validate` and `/seat/heartbeat` accept `{ seat_token }` (and also
 *     the legacy `{ token }`) and return the same `{ valid, tier, packs, seats }`
 *     plus `seats_used`.
 * Migration: solo/local mode is unchanged and never calls this server. A firm
 * user signs in (device/PKCE in production; email+password here), then activates.
 */

// ---------------------------------------------------------------------------
// Shared vocabulary (identical to src/hooks/useLicense.ts)
// ---------------------------------------------------------------------------
export type Plan = "personal" | "professional" | "practice";
export type ProfessionPack = "legal" | "tax" | "consulting";
export type UserRole = "admin" | "member";

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export interface LoginRequest {
  email: string;
  password: string;
}
export interface AuthTokensResponse {
  access_token: string; // short-lived HS256 JWT — send as `Authorization: Bearer`
  access_expires_at: string; // ISO
  refresh_token: string; // opaque high-entropy token; store in OS keychain, NOT localStorage
  refresh_expires_at: string; // ISO
}
export interface LoginResponse extends AuthTokensResponse {
  user: PublicUser;
}
export interface RefreshRequest {
  refresh_token: string;
}
export type RefreshResponse = AuthTokensResponse;
export interface LogoutRequest {
  refresh_token: string;
}
export interface MeResponse {
  user: PublicUser;
  org: { org_id: string; name: string; plan: Plan; packs: ProfessionPack[]; seat_limit: number } | null;
}
export interface PublicUser {
  user_id: string;
  email: string;
  role: UserRole;
  status: "active" | "deprovisioned";
  created_at: string;
}

// ---------------------------------------------------------------------------
// Licensing / seats  (the client-facing core)
// ---------------------------------------------------------------------------

/** POST /org/activate  — requires Authorization: Bearer <access_token>. */
export interface ActivateRequest {
  license_key: string;
  machine_id: string; // stable per-machine uuid (client already has getMachineId())
  machine_label?: string; // optional friendly name shown to admins
  app_version?: string;
}
/** 200 on success. Field names overlap the legacy /activate response. */
export interface ActivateResponse {
  token: string; // the signed seat token (legacy field name)
  seat_token: string; // explicit alias of `token`
  tier: Plan;
  packs: ProfessionPack[];
  seats: number; // org seat_limit
  seat_id: string;
  machine_id: string;
  expires_at: string; // ISO; client trusts signature+expiry offline until then
}
/** 409 when the seat_limit is hit — the N+1 machine. */
export interface SeatLimitExceededResponse {
  error: "seat_limit_exceeded";
  detail: string;
  seat_limit: number;
  seats: SeatSummary[]; // current consumers, so an admin can revoke/transfer
}

/** POST /seat/validate  and  POST /seat/heartbeat  — no auth header; the seat
 *  token IS the credential. Accepts `seat_token` (preferred) or `token`. */
export interface SeatValidateRequest {
  seat_token: string;
}
export interface SeatValidResponse {
  valid: true;
  tier: Plan;
  packs: ProfessionPack[];
  seats: number; // seat_limit
  seats_used: number; // active seats in the org right now
  seat_id: string;
  expires_at: string | null;
}
export interface SeatInvalidResponse {
  valid: false;
  reason: string; // "revoked" | "expired" | "org_suspended" | "user_deprovisioned" | "signature_invalid" | ...
}
export type SeatValidateResponse = SeatValidResponse | SeatInvalidResponse;

// ---------------------------------------------------------------------------
// Admin (role=admin; Authorization: Bearer <access_token>)
// ---------------------------------------------------------------------------
export interface SeatSummary {
  seat_id: string;
  user_id: string;
  machine_id: string;
  machine_label: string | null;
  status: "active" | "revoked";
  bound_at: string;
  last_seen: string;
  inactive: boolean; // no heartbeat within the inactivity window (reclaim candidate)
  revoked_at: string | null;
  revoked_reason: string | null;
}
/** POST /org/seats */
export interface ListSeatsResponse {
  org_id: string;
  plan: Plan;
  packs: ProfessionPack[];
  seat_limit: number;
  seats_used: number;
  seats: SeatSummary[];
}
/** POST /org/seat/revoke */
export interface RevokeSeatRequest {
  seat_id: string;
  reason?: string;
}
/** POST /org/user/deprovision */
export interface DeprovisionUserRequest {
  user_id: string;
}
/** POST /org/seats/transfer */
export interface TransferSeatRequest {
  from_seat_id: string;
  to_user_id: string;
  to_machine_id: string;
  to_machine_label?: string;
}
/** POST /org/users  (admin creates a member) */
export interface CreateUserRequest {
  email: string;
  password: string; // >= 12 chars
  role?: UserRole; // default "member"
}

/** POST /admin/org  — billing-driven provisioning (protect at network layer). */
export interface CreateOrgRequest {
  name: string;
  plan: Plan;
  packs?: ProfessionPack[];
  seat_limit: number;
  admin_email: string;
  admin_password: string;
  billing_customer_id?: string;
}
export interface CreateOrgResponse {
  org: { org_id: string; name: string; plan: Plan; packs: ProfessionPack[]; seat_limit: number };
  admin: PublicUser;
  license_key: string; // shown ONCE; server stores only a keyed hash
}

// ---------------------------------------------------------------------------
// Errors (generic envelope used by 4xx/5xx that aren't a typed shape above)
// ---------------------------------------------------------------------------
export interface ApiError {
  error: string;
  detail?: string;
}

/** Endpoint map, for reference / typed client generation. */
export const ENDPOINTS = {
  health: { method: "GET", path: "/healthz" },
  seatPublicKey: { method: "GET", path: "/.well-known/seat-pubkey" },
  login: { method: "POST", path: "/auth/login" },
  refresh: { method: "POST", path: "/auth/refresh" },
  logout: { method: "POST", path: "/auth/logout" },
  me: { method: "GET", path: "/auth/me" },
  activate: { method: "POST", path: "/org/activate" },
  seatValidate: { method: "POST", path: "/seat/validate" },
  seatHeartbeat: { method: "POST", path: "/seat/heartbeat" },
  listSeats: { method: "POST", path: "/org/seats" },
  revokeSeat: { method: "POST", path: "/org/seat/revoke" },
  deprovisionUser: { method: "POST", path: "/org/user/deprovision" },
  transferSeat: { method: "POST", path: "/org/seats/transfer" },
  createUser: { method: "POST", path: "/org/users" },
  audit: { method: "POST", path: "/org/audit" },
  createOrg: { method: "POST", path: "/admin/org" },
} as const;
