/**
 * Firm backend API contract (client copy).
 *
 * Mirrors `backend/src/contract.ts` — the single source of truth for the
 * request/response shapes the desktop app speaks to the firm backend. The
 * backend README explicitly recommends copying this dependency-free file into
 * the desktop repo to wire the client; keep the two in sync.
 *
 * Only the shapes the client actually reads/sends are reproduced here. The
 * relay stores OPAQUE ciphertext only — `ciphertext_b64` is a client-encrypted
 * Yjs update the relay never parses (see MatterSyncClient + matterCrypto).
 */

// --- Shared vocabulary -----------------------------------------------------
export type Plan = 'personal' | 'professional' | 'practice';
export type ProfessionPack = 'advisor' | 'legal' | 'tax' | 'consulting';
export type UserRole = 'admin' | 'member';

// --- Auth ------------------------------------------------------------------
export interface LoginRequest {
  email: string;
  password: string;
}
export interface AuthTokensResponse {
  access_token: string;
  access_expires_at: string;
  refresh_token: string;
  refresh_expires_at: string;
}
export interface PublicUser {
  user_id: string;
  email: string;
  role: UserRole;
  status: 'active' | 'deprovisioned';
  created_at: string;
}
export interface LoginResponse extends AuthTokensResponse {
  user: PublicUser;
}
export type RefreshResponse = AuthTokensResponse;
export interface MeResponse {
  user: PublicUser;
  org: {
    org_id: string;
    name: string;
    plan: Plan;
    packs: ProfessionPack[];
    seat_limit: number;
  } | null;
}

// --- Licensing / seats -----------------------------------------------------
export interface ActivateRequest {
  license_key: string;
  machine_id: string;
  machine_label?: string;
  app_version?: string;
}
export interface ActivateResponse {
  token: string;
  seat_token: string;
  tier: Plan;
  packs: ProfessionPack[];
  seats: number;
  seat_id: string;
  machine_id: string;
  expires_at: string;
}
export interface SeatLimitExceededResponse {
  error: 'seat_limit_exceeded';
  detail: string;
  seat_limit: number;
  seats: SeatSummary[];
}
export interface SeatValidateRequest {
  seat_token: string;
}
export interface SeatValidResponse {
  valid: true;
  tier: Plan;
  packs: ProfessionPack[];
  seats: number;
  seats_used: number;
  seat_id: string;
  expires_at: string | null;
}
export interface SeatInvalidResponse {
  valid: false;
  reason: string;
}
export type SeatValidateResponse = SeatValidResponse | SeatInvalidResponse;

// --- Admin -----------------------------------------------------------------
export interface SeatSummary {
  seat_id: string;
  user_id: string;
  machine_id: string;
  machine_label: string | null;
  status: 'active' | 'revoked';
  bound_at: string;
  last_seen: string;
  inactive: boolean;
  revoked_at: string | null;
  revoked_reason: string | null;
}
export interface ListSeatsResponse {
  org_id: string;
  plan: Plan;
  packs: ProfessionPack[];
  seat_limit: number;
  seats_used: number;
  seats: SeatSummary[];
}
export interface RevokeSeatRequest {
  seat_id: string;
  reason?: string;
}
export interface DeprovisionUserRequest {
  user_id: string;
}
export interface CreateUserRequest {
  email: string;
  password: string;
  role?: UserRole;
}

// --- Matters / ethical walls / E2EE sync relay -----------------------------
export type MatterStatus = 'active' | 'archived';
export type MatterRole = 'owner' | 'editor' | 'viewer';

export interface FirmMatter {
  matter_id: string;
  org_id: string;
  client_name: string;
  status: MatterStatus;
  /** Bumps on member-remove / wall-set; client rotates the matter key to match. */
  key_epoch: number;
  created_at: string;
}
export interface CreateMatterRequest {
  client_name: string;
}
export interface CreateMatterResponse {
  matter: FirmMatter;
}
export interface ListMattersResponse {
  matters: FirmMatter[];
}
export interface AddMatterMemberRequest {
  user_id: string;
  role?: MatterRole;
}
export interface AddMatterMemberResponse {
  ok: true;
  key_epoch: number;
  key_release: 'release_to_member' | 'blocked_walled';
}
export interface RemoveMatterMemberRequest {
  user_id: string;
}
export interface RemoveMatterMemberResponse {
  ok: true;
  removed: boolean;
  key_epoch: number;
}
export interface MatterMembersResponse {
  matter_id: string;
  key_epoch: number;
  /** Members with email included (joined from users table; same-org, admin-visible). */
  members: Array<{
    matter_id: string;
    user_id: string;
    org_id: string;
    role: MatterRole;
    created_at: string;
    /** Email from the users table. Present when the backend returns it (firm wiring v2). */
    email?: string | null;
  }>;
  walls: Array<{
    matter_id: string;
    user_id: string;
    org_id: string;
    reason: string | null;
    created_by: string;
    created_at: string;
  }>;
}

// --- Org users list (admin only) -------------------------------------------
export interface OrgUserEntry {
  user_id: string;
  email: string;
  role: UserRole;
  status: 'active' | 'deprovisioned';
}
export interface ListOrgUsersResponse {
  users: OrgUserEntry[];
}
export interface SetWallRequest {
  user_id: string;
  reason?: string;
}
export interface SetWallResponse {
  ok: true;
  walled: boolean;
  key_epoch: number;
}
export interface ClearWallRequest {
  user_id: string;
}
export interface ClearWallResponse {
  ok: true;
  cleared: boolean;
}

// --- Relay -----------------------------------------------------------------
export interface PushUpdateRequest {
  blob_id: string;
  ciphertext_b64: string;
  seat_token: string;
  key_epoch?: number;
  /** Document stream partition. Absent (or '_notes') = matter notes (backward-compatible). */
  doc_id?: string;
}
export interface PushUpdateResponse {
  ok: true;
  cursor: number;
  blob_id: string;
  key_epoch: number;
  duplicate: boolean;
}
export interface PulledUpdate {
  cursor: number;
  blob_id: string;
  /** Document stream this update belongs to. */
  doc_id: string;
  key_epoch: number;
  author_seat: string;
  created_at: string;
  ciphertext_b64: string;
}
export interface PullUpdatesResponse {
  matter_id: string;
  /** The doc_id stream this response covers. '_notes' when absent from the query. */
  doc_id: string;
  key_epoch: number;
  since: number;
  cursor: number;
  latest_cursor: number;
  has_more: boolean;
  updates: PulledUpdate[];
}
/**
 * Response of `POST /matter/:id/sync-ticket`: a short-lived, single-use ticket
 * for the WS upgrade. Authed like the HTTP relay (Bearer access + X-Seat-Token
 * header). The client puts ONLY this ticket on the WS URL — never a token.
 *
 * To subscribe to a specific document stream, add `&doc_id=<docId>` to the WS
 * URL (not the ticket endpoint). The doc_id is not a credential so it is safe
 * to carry on the upgrade URL. Absent doc_id → '_notes'.
 */
export interface SyncTicketResponse {
  ticket: string;
  expires_in_ms: number;
}
export interface SyncReadyFrame {
  type: 'ready';
  matter_id: string;
  /** Document stream this socket is subscribed to. '_notes' for matter notes. */
  doc_id: string;
  backlog: number;
  latest_cursor: number;
  /** Current subscriber count (including self) at the moment the socket joined. */
  subscribers?: number;
}
export interface SyncUpdateFrame {
  type: 'update';
  matter_id: string;
  /** Document stream this update belongs to. */
  doc_id: string;
  cursor: number;
  blob_id: string;
  key_epoch: number;
  author_seat: string;
  created_at: string;
  ciphertext_b64: string;
}
export interface SyncPresenceFrame {
  type: 'presence';
  matter_id: string;
  doc_id: string;
  /** Total connected subscribers including the recipient. */
  count: number;
}
export type SyncFrame = SyncReadyFrame | SyncUpdateFrame | SyncPresenceFrame;

// --- Assured zero-retention inference proxy --------------------------------
export type AssuredProvider = 'anthropic' | 'openai' | 'google';
export interface SetProviderKeyRequest {
  provider: AssuredProvider;
  api_key: string;
}
export interface SetProviderKeyResponse {
  ok: true;
  provider: AssuredProvider;
  key_last4: string;
}
export interface ManagedKeyInfo {
  provider: AssuredProvider;
  key_last4: string;
  updated_at: string;
  updated_by: string;
}
export interface ListProviderKeysResponse {
  keys: ManagedKeyInfo[];
}
export interface DeleteProviderKeyRequest {
  provider: AssuredProvider;
}
export interface DeleteProviderKeyResponse {
  ok: true;
  provider: AssuredProvider;
  deleted: boolean;
}

// --- Device registration + key distribution ---------------------------------

export interface RegisterDeviceRequest {
  device_id: string;
  machine_id: string;
  label: string;
  pubkey_jwk: JsonWebKey;
}

export interface RegisterDeviceResponse {
  ok: true;
}

export interface FetchOrgUserDevicesRequest {
  user_ids: string[];
}

export interface DeviceRecord {
  user_id: string;
  device_id: string;
  pubkey_jwk: JsonWebKey;
  label: string;
}

export interface FetchOrgUserDevicesResponse {
  devices: DeviceRecord[];
}

export interface WrappedKeyEntry {
  user_id: string;
  device_id: string;
  wrapped_key_b64: string;
}

export interface PublishMatterKeysRequest {
  epoch: number;
  wrapped: WrappedKeyEntry[];
}

export interface PublishMatterKeysResponse {
  ok: true;
  stored: number;
}

export interface FetchMatterKeysRequest {
  device_id: string;
}

export interface FetchMatterKeysResponse {
  epoch: number;
  wrapped_key_b64: string;
}

/** Firm-only, per-device wrapped intake private-key grants. */
export interface PublishIntakeKeysRequest {
  epoch: number;
  wrapped: WrappedKeyEntry[];
}

export interface PublishIntakeKeysResponse {
  ok: true;
  stored: number;
}

export interface FetchIntakeKeysResponse {
  epoch: number;
  wrapped_key_b64: string;
}

/** Response for POST /org/admins — org admin users (used for escrow). */
export interface OrgAdminEntry {
  user_id: string;
  email: string;
  role: 'admin';
}

export interface ListOrgAdminsResponse {
  admins: OrgAdminEntry[];
}

// --- /matter/mine ----------------------------------------------------------

export interface MatterMineSummary {
  matter_id: string;
  client_name: string;
  status: MatterStatus;
  key_epoch: number;
  role: MatterRole;
}

export interface MatterMineResponse {
  matters: MatterMineSummary[];
}

// --- /org/claim (Phase 1) --------------------------------------------------

export interface OrgClaimRequest {
  license_key: string;
  email: string;
  password: string;
  /** Optional: rename the org on first claim. */
  org_name?: string;
}

export interface OrgClaimResponse extends AuthTokensResponse {
  org: {
    org_id: string;
    name: string;
    plan: Plan;
    packs: ProfessionPack[];
    seat_limit: number;
  };
  user: PublicUser;
}

// --- SSO (OIDC) admin config -----------------------------------------------
export type IdpProvider = 'entra' | 'google' | 'generic';

export interface SsoConfigSetRequest {
  provider: IdpProvider;
  issuer: string;
  client_id: string;
  /** Write-only; never returned by the API. Omit (or leave blank) to keep the existing secret on an update. Required on first setup. */
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

// --- Errors ----------------------------------------------------------------
export interface ApiError {
  error: string;
  detail?: string;
}

/** Endpoint paths (mirror of backend ENDPOINTS). `:id` = matter_id. */
export const FIRM_ENDPOINTS = {
  deviceRegister: '/device/register',
  orgUserDevices: '/org/users/devices',
  orgAdmins: '/org/admins',
  matterMine: '/matter/mine',
  orgClaim: '/org/claim',
  lemonSqueezyWebhook: '/webhooks/lemonsqueezy',
  health: '/healthz',
  seatPublicKey: '/.well-known/seat-pubkey',
  login: '/auth/login',
  refresh: '/auth/refresh',
  logout: '/auth/logout',
  me: '/auth/me',
  activate: '/org/activate',
  seatValidate: '/seat/validate',
  seatHeartbeat: '/seat/heartbeat',
  listSeats: '/org/seats',
  revokeSeat: '/org/seat/revoke',
  deprovisionUser: '/org/user/deprovision',
  createUser: '/org/users',
  listOrgUsers: '/org/users/list',
  createMatter: '/org/matters',
  listMatters: '/org/matters/list',
  archiveMatter: '/matter/:id/archive',
  addMatterMember: '/matter/:id/members/add',
  removeMatterMember: '/matter/:id/members/remove',
  listMatterMembers: '/matter/:id/members/list',
  publishMatterKeys: '/matter/:id/keys/publish',
  fetchMatterKeys: '/matter/:id/keys/fetch',
  publishIntakeKeys: '/intake/:id/keys',
  fetchIntakeKeys: '/intake/:id/keys',
  setWall: '/matter/:id/wall/set',
  clearWall: '/matter/:id/wall/clear',
  pushUpdate: '/matter/:id/updates',
  pullUpdates: '/matter/:id/updates',
  syncTicket: '/matter/:id/sync-ticket',
  syncSocket: '/matter/:id/sync',
  notifySend: '/notify/send',
  notifyInbox: '/notify/inbox',
  notifyAck: '/notify/ack',
  assuredInfer: '/assured/infer',
  assuredKeySet: '/assured/keys/set',
  assuredKeyList: '/assured/keys/list',
  assuredKeyDelete: '/assured/keys/delete',
  ssoConfigSet: '/org/sso/config/set',
  ssoConfigGet: '/org/sso/config/get',
  ssoConfigDelete: '/org/sso/config/delete',
  ssoStart: '/auth/sso/start',
  ssoExchange: '/auth/sso/exchange',
} as const;
