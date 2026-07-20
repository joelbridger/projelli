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
export type ProfessionPack = "advisor" | "legal" | "tax" | "consulting";
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

/** POST /admin/org — Authorization: Bearer ADMIN_PROVISION_SECRET, plus the edge block. */
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
// Chunk 2 — Matters, ethical walls, and the E2EE sync relay (DECISION.md §1+§4)
//
// ACL: a firm user can access a matter iff (member ∨ org-admin) ∧ ¬walled,
// default-deny, deny-overrides-allow. The relay is a DUMB PIPE: it stores opaque
// client-encrypted CRDT update blobs keyed by matter and fans them out to
// `allowed` seats. It NEVER holds the per-matter content key and never sees
// plaintext — clients encrypt/decrypt with a key released out of band into the
// OS keychain (`com.keepance.matter.<matter_id>`, §2), released only to
// `member ∧ ¬walled` and rotated (key_epoch++) on member-remove / wall-set.
// ---------------------------------------------------------------------------

export type MatterStatus = "active" | "archived";
export type MatterRole = "owner" | "editor" | "viewer";

export interface Matter {
  matter_id: string;
  org_id: string;
  client_name: string;
  status: MatterStatus;
  key_epoch: number; // bumps on member-remove / wall-set; client rotates the matter key to match
  created_at: string;
}

// ---- Admin: matter CRUD (role=admin; Authorization: Bearer <access_token>) --
/** POST /org/matters            { client_name }            -> { matter } (201) */
export interface CreateMatterRequest {
  client_name: string;
}
/** POST /org/matters/list                                  -> { matters: Matter[] } */
export interface ListMattersResponse {
  matters: Matter[];
}
/** POST /matter/:id/archive                                -> { ok, matter_id, status } */

// ---- Admin: membership ------------------------------------------------------
/** POST /matter/:id/members/add     { user_id, role? }     -> { ok, key_epoch, key_release } */
export interface AddMatterMemberRequest {
  user_id: string;
  role?: MatterRole; // default "editor"
}
/** POST /matter/:id/members/remove  { user_id }            -> { ok, removed, key_epoch (bumped) } */
export interface RemoveMatterMemberRequest {
  user_id: string;
}
/** POST /matter/:id/members/list                           -> members + walls + key_epoch */
export interface MatterMembersResponse {
  matter_id: string;
  key_epoch: number;
  /** Members with email included (joined from users table; same-org, admin-visible). */
  members: Array<{ matter_id: string; user_id: string; org_id: string; role: MatterRole; created_at: string; email: string | null }>;
  walls: Array<{ matter_id: string; user_id: string; org_id: string; reason: string | null; created_by: string; created_at: string }>;
}

// ---- Admin: list org users (role=admin; Authorization: Bearer <access_token>) --
/** POST /org/users/list  (admin only) -> org users with email+role+status */
export interface OrgUserEntry {
  user_id: string;
  email: string;
  role: UserRole;
  status: "active" | "deprovisioned";
}
export interface ListOrgUsersResponse {
  users: OrgUserEntry[];
}

// ---- Admin: ethical walls (explicit DENY; deny-overrides-allow) -------------
/** POST /matter/:id/wall/set     { user_id, reason? }      -> { ok, walled, key_epoch (bumped) } */
export interface SetWallRequest {
  user_id: string;
  reason?: string;
}
/** POST /matter/:id/wall/clear   { user_id }               -> { ok, cleared } (does NOT re-grant membership) */
export interface ClearWallRequest {
  user_id: string;
}

// ---- Relay (any firm member; access JWT + active seat + member∧¬walled) ------
/**
 * POST /matter/:id/updates  — append one opaque encrypted CRDT update.
 * `ciphertext_b64` is a base64 client-encrypted Yjs update; the relay stores the
 * bytes verbatim and never decodes them. Idempotent on (matter, blob_id).
 * 201 on first store, 200 on an idempotent retry (`duplicate: true`).
 * 401 if access/seat invalid, 403 if walled/non-member, 404 cross-org,
 * 413 if the blob exceeds the relay cap (1 MiB decoded).
 */
export interface PushUpdateRequest {
  blob_id: string; // client uuid; per-(matter,doc_id) idempotency key
  ciphertext_b64: string; // opaque, base64; relay never parses it
  seat_token: string; // a valid, active seat token (chunk-1)
  key_epoch?: number; // the matter key epoch this blob was sealed under (defaults to current)
  /** Document stream partition. Absent (or '_notes') = matter notes (backward-compatible). */
  doc_id?: string;
}
export interface PushUpdateResponse {
  ok: true;
  cursor: number; // the assigned monotonic id; advance your `since` to this
  blob_id: string;
  key_epoch: number;
  duplicate: boolean;
}
/**
 * GET /matter/:id/updates?since=<cursor>[&doc_id=<id>]  — cursor catch-up.
 * Returns updates strictly AFTER `since`, ascending. `since=0` = full history.
 * `doc_id` filters to a specific document stream; absent = '_notes' (backward compat).
 * (Access JWT via Authorization header; seat token via the X-Seat-Token header —
 * never the query string, so no credential lands in an access log.)
 */
export interface PullUpdatesResponse {
  matter_id: string;
  /** The doc_id stream this response covers. '_notes' when absent from the query. */
  doc_id: string;
  key_epoch: number;
  since: number;
  cursor: number; // highest cursor in this page (== since if empty)
  latest_cursor: number; // highest cursor stored (for "am I caught up?")
  has_more: boolean; // more pages beyond this one
  updates: Array<{
    cursor: number;
    blob_id: string;
    /** Document stream this update belongs to. */
    doc_id: string;
    key_epoch: number;
    author_seat: string;
    created_at: string;
    ciphertext_b64: string; // opaque, base64; decrypt client-side with the matter key
  }>;
}
/**
 * POST /matter/:id/sync-ticket — mint a short-lived, single-use ticket for the
 * WS upgrade. Authed exactly like the HTTP relay (Authorization: Bearer access
 * JWT + X-Seat-Token header), runs the same matter-access gate, and returns an
 * opaque ticket bound to {matter,user,seat,org}. The client puts ONLY this ticket
 * on the WS URL (`?ticket=<t>`) — never the access/seat token.
 *
 * To subscribe to a specific document stream, add `&doc_id=<docId>` to the WS
 * URL (not the ticket endpoint). The doc_id is not a credential so it is safe
 * to carry on the upgrade URL. Absent doc_id → '_notes'.
 */
export interface SyncTicketResponse {
  ticket: string;
  expires_in_ms: number;
}
/**
 * WS /matter/:id/sync?ticket=<t>  — live fan-out.
 * The browser WebSocket can't set headers, so the upgrade carries a SINGLE-USE
 * TICKET (minted by POST /matter/:id/sync-ticket) — never the access/seat token,
 * so no credential lands in an access log. On open the server sends
 * `{ type:"ready", backlog, latest_cursor }` then the backlog as `update` frames,
 * then live `update` frames as peers push. Inbound frames are ignored — writes
 * go through the audited HTTP POST. Frame shape:
 */
export interface SyncReadyFrame {
  type: "ready";
  matter_id: string;
  /** Document stream this socket is subscribed to. '_notes' for matter notes. */
  doc_id: string;
  backlog: number;
  latest_cursor: number;
  /** Current subscriber count (including self) at the moment the socket joined. */
  subscribers?: number;
}
export interface SyncUpdateFrame {
  type: "update";
  matter_id: string;
  /** Document stream this update belongs to. */
  doc_id: string;
  cursor: number;
  blob_id: string;
  key_epoch: number;
  author_seat: string;
  created_at: string;
  ciphertext_b64: string; // opaque, base64
}
export interface SyncPresenceFrame {
  type: "presence";
  matter_id: string;
  doc_id: string;
  /** Total connected subscribers including the recipient. */
  count: number;
}

// ---------------------------------------------------------------------------
// Chunk 3 — Assured zero-retention inference proxy (DECISION.md §5)
//
// The FIRM option (vs. pure BYOK): managed inference + a DPA. A firm seat sends
// a provider-native inference request; the proxy attaches the org's MANAGED key
// (encrypted at rest, never returned), forwards the body STRAIGHT to the
// provider as an opaque stream, and streams the response back — persisting only
// non-content metadata for billing. The prompt/completion are NEVER written to
// disk, DB, or logs (enforced by construction; see backend/src/lib/assured.ts).
//
// /assured/infer is unusual: its control fields ride in HEADERS, not a JSON
// envelope, because the BODY is the provider-native payload that must pass
// through untouched. Each response carries `X-Keepance-No-Retention: true`.
// ---------------------------------------------------------------------------

export type AssuredProvider = "anthropic" | "openai" | "google";

/**
 * POST /assured/infer — headers, not a JSON wrapper, carry the control fields:
 *   Authorization: Bearer <access_token>
 *   X-Seat-Token:  <a valid, active seat token>
 *   X-Provider:    anthropic | openai | google
 *   X-Model:       <provider model id>
 *   X-Stream:      "1" (default) | "0"
 * Body: the PROVIDER-NATIVE request payload (Anthropic /v1/messages, OpenAI
 *       /v1/chat/completions, Google :generateContent). Piped upstream verbatim.
 * Response: the provider's response streamed back verbatim (SSE when streaming),
 *           plus `X-Keepance-No-Retention: true` and `X-Keepance-Request-Id`.
 */
export interface AssuredInferHeaders {
  "X-Seat-Token": string;
  "X-Provider": AssuredProvider;
  "X-Model": string;
  "X-Stream"?: "1" | "0";
}

/** POST /assured/keys/set  (admin) — store/rotate the org's managed provider key. */
export interface SetProviderKeyRequest {
  provider: AssuredProvider;
  api_key: string; // encrypted at rest immediately; never stored/returned in plaintext
}
export interface SetProviderKeyResponse {
  ok: true;
  provider: AssuredProvider;
  key_last4: string; // non-secret display hint
}
/** POST /assured/keys/list (admin) — providers with a managed key (no secrets). */
export interface ListProviderKeysResponse {
  keys: Array<{ provider: AssuredProvider; key_last4: string; updated_at: string; updated_by: string }>;
}
/** POST /assured/keys/delete (admin) { provider } */
export interface DeleteProviderKeyRequest {
  provider: AssuredProvider;
}
/** POST /assured/billing (admin) — METADATA-ONLY usage rows (no prompt/completion). */
export interface InferenceBillingRow {
  request_id: string;
  org_id: string;
  seat_id: string;
  provider: AssuredProvider;
  model: string;
  input_tokens: number;
  output_tokens: number;
  status: number;
  latency_ms: number;
  ts: string;
}
export interface InferenceBillingResponse {
  rows: InferenceBillingRow[];
}

// ---------------------------------------------------------------------------
// SSO (OIDC) admin config
// ---------------------------------------------------------------------------
export type IdpProvider = "entra" | "google" | "generic";
export interface SsoConfigSetRequest {
  provider: IdpProvider;
  issuer: string;
  client_id: string;
  /** Write-only; never returned. Omit (or leave blank) to keep the existing secret on an update. Required on first setup. */
  client_secret?: string;
  enabled: boolean;
}
export interface SsoConfigView {
  configured: boolean;
  provider?: IdpProvider;
  issuer?: string;
  client_id?: string;
  enabled?: boolean;
  has_secret?: boolean;
  /** The redirect URI the firm must register with their IdP. */
  redirect_uri: string;
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
  listOrgUsers: { method: "POST", path: "/org/users/list" },
  audit: { method: "POST", path: "/org/audit" },
  createOrg: { method: "POST", path: "/admin/org" },
  // Chunk 2 — matters / ethical walls / E2EE sync relay. `:id` = matter_id.
  createMatter: { method: "POST", path: "/org/matters" },
  listMatters: { method: "POST", path: "/org/matters/list" },
  archiveMatter: { method: "POST", path: "/matter/:id/archive" },
  addMatterMember: { method: "POST", path: "/matter/:id/members/add" },
  removeMatterMember: { method: "POST", path: "/matter/:id/members/remove" },
  listMatterMembers: { method: "POST", path: "/matter/:id/members/list" },
  setWall: { method: "POST", path: "/matter/:id/wall/set" },
  clearWall: { method: "POST", path: "/matter/:id/wall/clear" },
  pushUpdate: { method: "POST", path: "/matter/:id/updates" },
  pullUpdates: { method: "GET", path: "/matter/:id/updates" }, // X-Seat-Token header
  syncTicket: { method: "POST", path: "/matter/:id/sync-ticket" }, // mint WS ticket
  syncSocket: { method: "GET", path: "/matter/:id/sync" }, // WebSocket upgrade (?ticket=)
  // Chunk 3 — assured zero-retention inference proxy.
  assuredInfer: { method: "POST", path: "/assured/infer" },
  assuredKeySet: { method: "POST", path: "/assured/keys/set" },
  assuredKeyList: { method: "POST", path: "/assured/keys/list" },
  assuredKeyDelete: { method: "POST", path: "/assured/keys/delete" },
  assuredBilling: { method: "POST", path: "/assured/billing" },
  // SSO (OIDC) admin config + member flow.
  ssoConfigSet: { method: "POST", path: "/org/sso/config/set" },
  ssoConfigGet: { method: "POST", path: "/org/sso/config/get" },
  ssoConfigDelete: { method: "POST", path: "/org/sso/config/delete" },
  ssoStart: { method: "POST", path: "/auth/sso/start" },
  ssoCallback: { method: "GET", path: "/auth/sso/callback" },
  ssoExchange: { method: "POST", path: "/auth/sso/exchange" },
} as const;
