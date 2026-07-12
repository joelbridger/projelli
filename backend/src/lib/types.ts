/**
 * Domain types shared across the backend. The licensing vocabulary
 * (tiers + profession packs) is kept identical to the desktop client's
 * `src/hooks/useLicense.ts` so seat tokens slot straight into the existing
 * client state.
 */

// Mirrors src/hooks/useLicense.ts LicenseTier (sans 'free', which is the
// unlicensed fallback the client applies locally, never something we issue).
export type Plan = "personal" | "professional" | "practice";
export type ProfessionPack = "advisor" | "legal" | "tax" | "consulting";

export type OrgStatus = "active" | "suspended" | "unclaimed";
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
  | "seat.transfer"
  // ---- chunk 2: matters / ethical walls / E2EE sync relay --------------------
  | "matter.create"
  | "matter.archive"
  | "matter.stream.release"
  | "matter.activate"
  | "matter.member.add"
  | "matter.member.remove"
  | "matter.wall.set"
  | "matter.wall.clear"
  | "matter.key.rotate" // key_epoch bump — desktop key-release service rotates the matter key here
  | "matter.access.granted" // a push/pull/connect that passed the access gate
  | "matter.access.denied" // a push/pull/connect rejected (non-member, walled, cross-org)
  // ---- chunk 3: assured zero-retention inference proxy (DECISION.md §5) -------
  | "assured.key.set" // admin set/rotated an org managed provider key (metadata only)
  | "assured.key.delete" // admin removed an org managed provider key
  | "assured.infer" // a forwarded inference (metadata only — NEVER prompt/completion)
  | "assured.infer.rejected" // a rejected inference (bad seat, no key, provider error)
  // ---- chunk 4: device keys + wrapped matter keys + claim + webhook ---------
  | "device.register" // user registered a device public key
  | "matter.keys.publish" // admin published wrapped matter keys for members
  | "matter.keys.fetch" // member fetched their wrapped matter key
  | "intake.keys.publish" // admin/owner published wrapped intake keys for a matter
  | "intake.keys.fetch" // member fetched their wrapped intake key
  | "intake.access.granted" // intake key fetch passed the bound-matter access gate
  | "intake.access.denied" // intake key fetch failed the bound-matter access gate
  | "org.claim" // org claimed from unclaimed status via license key
  | "webhook.lemonsqueezy" // LemonSqueezy webhook processed
  // ---- chunk 5: SSO (OIDC) ---------------------------------------------------
  | "sso.config.set" // admin set/updated an org IdP configuration
  | "sso.config.delete" // admin removed an org IdP configuration
  | "sso.login" // user completed SSO sign-in
  | "sso.login.rejected"; // SSO sign-in rejected (bad token, disabled, unknown user, etc.)

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

// ---------------------------------------------------------------------------
// Chunk 2 — Matters, membership, ethical walls, and the E2EE sync relay.
//
// DECISION.md §4: Matter is the ACL unit; access = (member ∨ org-admin) ∧ ¬walled,
// default-deny, deny-overrides-allow. DECISION.md §1: the relay stores opaque,
// client-side-encrypted CRDT update blobs keyed by matter and fans them out to
// `allowed` seats; it never sees plaintext and never holds the per-matter key.
// ---------------------------------------------------------------------------

export type MatterStatus = "provisioning" | "active" | "archived";
/** Role a member holds inside a matter (UX/authoring hint; access is still member∧¬walled). */
export type MatterRole = "owner" | "editor" | "viewer";

export interface Matter {
  /** Random, validated `mh2_` routing value. Never a local/client identifier. */
  matter_handle: string;
  org_id: string;
  /** Random, validated `sh2_` bootstrap stream routing value. */
  root_stream_handle: string;
  status: MatterStatus;
  /**
   * Monotonic key epoch (starts at 1). The per-matter content-encryption key is
   * client-held (OS keychain, §2) and the relay never sees it — but the epoch is
   * tracked here so member-removal / wall-set can bump it. Updates carry the
   * epoch they were sealed under; the desktop key-release service rotates the
   * key on a bump so a removed/walled user's old key can't read new updates.
   */
  key_epoch: number;
  created_at: string; // ISO
}

export interface MatterMember {
  matter_handle: string;
  user_id: string;
  org_id: string;
  role: MatterRole;
  created_at: string; // ISO
}

/** An explicit DENY (a "screen"). Overrides any membership/admin role for (matter,user). */
export interface EthicalWall {
  matter_handle: string;
  user_id: string;
  org_id: string;
  created_by: string; // user_id of the admin who raised the screen
  created_at: string; // ISO
}

/**
 * One opaque, end-to-end-encrypted CRDT update. The relay stores BYTES IT CANNOT
 * READ: `ciphertext` is a client-encrypted Yjs update, `id` is the monotonic
 * fetch cursor, `author_seat` attributes the push (for audit, never trusted as
 * content), `key_epoch` is the matter epoch the client sealed under.
 */
export interface MatterUpdate {
  id: number; // monotonic cursor (AUTOINCREMENT)
  matter_handle: string;
  org_id: string;
  /** Random, validated `sh2_` stream routing value. */
  stream_handle: string;
  blob_id: string; // random client idempotency value; unique per stream
  ciphertext: Uint8Array; // opaque — never logged, never parsed
  author_seat: string; // seat_id that pushed it
  key_epoch: number; // matter key epoch this blob was encrypted under
  created_at: string; // ISO
}

/** Result of the §4 access predicate for (user, matter). */
export type MatterAccess =
  | { allowed: true; matter: Matter; reason: "member" | "admin" }
  | { allowed: false; matter: Matter; reason: "inactive" | "walled" | "not_member" }
  | { allowed: false; matter: null; reason: "matter_not_found" | "cross_org" };

// ---------------------------------------------------------------------------
// Chunk 4 — Device keys + wrapped matter keys + claim + webhook
// ---------------------------------------------------------------------------

/** A device's registered P-256 public key for wrapped matter-key delivery. */
export interface Device {
  device_id: string;
  user_id: string;
  org_id: string;
  machine_id: string;
  label: string;
  pubkey_jwk: string; // JSON text of EC P-256 public JWK
  created_at: string; // ISO
}

/** A per-device wrapped copy of a matter content key at a given epoch. */
export interface WrappedMatterKey {
  matter_handle: string;
  epoch: number;
  user_id: string;
  device_id: string;
  wrapped_key_b64: string;
  published_by: string; // user_id of the publisher (admin / owner)
  created_at: string; // ISO
}

/** Idempotency record for processed webhook events. */
export interface WebhookEvent {
  event_id: string; // LemonSqueezy event id (from meta.event_name + meta.custom_data or event id)
  processed_at: string; // ISO
}
