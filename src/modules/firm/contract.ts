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
export type ProfessionPack = 'legal' | 'tax' | 'consulting';
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
  members: Array<{
    matter_id: string;
    user_id: string;
    org_id: string;
    role: MatterRole;
    created_at: string;
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
  key_epoch: number;
  author_seat: string;
  created_at: string;
  ciphertext_b64: string;
}
export interface PullUpdatesResponse {
  matter_id: string;
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
 */
export interface SyncTicketResponse {
  ticket: string;
  expires_in_ms: number;
}
export interface SyncReadyFrame {
  type: 'ready';
  matter_id: string;
  backlog: number;
  latest_cursor: number;
}
export interface SyncUpdateFrame {
  type: 'update';
  matter_id: string;
  cursor: number;
  blob_id: string;
  key_epoch: number;
  author_seat: string;
  created_at: string;
  ciphertext_b64: string;
}
export type SyncFrame = SyncReadyFrame | SyncUpdateFrame;

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

// --- Errors ----------------------------------------------------------------
export interface ApiError {
  error: string;
  detail?: string;
}

/** Endpoint paths (mirror of backend ENDPOINTS). `:id` = matter_id. */
export const FIRM_ENDPOINTS = {
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
  createMatter: '/org/matters',
  listMatters: '/org/matters/list',
  archiveMatter: '/matter/:id/archive',
  addMatterMember: '/matter/:id/members/add',
  removeMatterMember: '/matter/:id/members/remove',
  listMatterMembers: '/matter/:id/members/list',
  setWall: '/matter/:id/wall/set',
  clearWall: '/matter/:id/wall/clear',
  pushUpdate: '/matter/:id/updates',
  pullUpdates: '/matter/:id/updates',
  syncTicket: '/matter/:id/sync-ticket',
  syncSocket: '/matter/:id/sync',
  assuredInfer: '/assured/infer',
  assuredKeySet: '/assured/keys/set',
  assuredKeyList: '/assured/keys/list',
  assuredKeyDelete: '/assured/keys/delete',
} as const;
