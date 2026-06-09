/**
 * Domain types shared across the backend. The licensing vocabulary
 * (tiers + profession packs) is kept identical to the desktop client's
 * `src/hooks/useLicense.ts` so seat tokens slot straight into the existing
 * client state.
 */

// Mirrors src/hooks/useLicense.ts LicenseTier (sans 'free', which is the
// unlicensed fallback the client applies locally, never something we issue).
export type Plan = "personal" | "professional" | "practice";
export type ProfessionPack = "legal" | "tax" | "consulting";

export type OrgStatus = "active" | "suspended";
export type UserRole = "admin" | "member";
export type UserStatus = "active" | "deprovisioned";
export type SeatStatus = "active" | "revoked";

export interface Org {
  org_id: string;
  name: string;
  billing_customer_id: string | null;
  plan: Plan;
  packs: ProfessionPack[];
  seat_limit: number;
  status: OrgStatus;
  created_at: string; // ISO
}

export interface User {
  user_id: string;
  org_id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  created_at: string;
}

export interface Seat {
  seat_id: string;
  org_id: string;
  user_id: string;
  machine_id: string;
  machine_label: string | null;
  status: SeatStatus;
  bound_at: string;
  last_seen: string;
  revoked_at: string | null;
  revoked_reason: string | null;
}

export interface LicenseKey {
  key_id: string;
  org_id: string;
  // We store only a keyed hash of the key; the plaintext is shown exactly once
  // at issuance and never persisted.
  key_hash: string;
  plan: Plan;
  packs: ProfessionPack[];
  seat_limit: number;
  issued_at: string;
  status: "active" | "disabled";
}

export type AuditAction =
  | "org.create"
  | "license.issue"
  | "user.create"
  | "user.deprovision"
  | "seat.activate"
  | "seat.activate.rejected_seat_limit"
  | "seat.heartbeat"
  | "seat.validate.rejected"
  | "seat.revoke"
  | "seat.transfer";

export interface AuditEvent {
  id: number;
  org_id: string;
  actor_user_id: string | null; // null = system / unauthenticated activate
  action: AuditAction;
  target: string | null; // seat_id, user_id, machine_id, etc.
  detail: string | null; // small JSON blob, never secrets/content
  ts: string;
}

/** Claims embedded in a signed seat token (what the desktop client reads). */
export interface SeatTokenClaims {
  // Stable identifiers
  org_id: string;
  user_id: string;
  seat_id: string;
  machine_id: string;
  // Entitlements (kept name-compatible with the client's license state)
  tier: Plan; // client field is `tier`
  packs: ProfessionPack[];
  seats: number; // = seat_limit; client surfaces this as "seats"
  // Standard JWT-ish claims
  iss: string;
  sub: string; // user_id (subject)
  iat: number;
  exp: number;
}

/** Claims in a short-lived access JWT (firm auth identity). */
export interface AccessTokenClaims {
  sub: string; // user_id
  org_id: string;
  role: UserRole;
  email: string;
  iss: string;
  iat: number;
  exp: number;
  typ: "access";
}
