/**
 * Firm backend API contract (client copy).
 *
 * This is the authoritative contract for the request/response shapes the
 * desktop app speaks to the firm backend. It is deliberately dependency-free
 * so the backend's route tests can check it for privacy drift.
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

// --- V2 firm relay: opaque routing only ------------------------------------
/** A server-issued, 256-bit opaque shared-client routing handle. */
export type MatterHandle = string & { readonly __brand: 'MatterHandle' };
/** A client-generated, 256-bit opaque encrypted-stream routing handle. */
export type StreamHandle = string & { readonly __brand: 'StreamHandle' };
/** A client-generated, 256-bit opaque intake-key routing handle. */
export type IntakeHandle = string & { readonly __brand: 'IntakeHandle' };

const MATTER_HANDLE_RE = /^mh2_[A-Za-z0-9_-]{43}$/;
const STREAM_HANDLE_RE = /^sh2_[A-Za-z0-9_-]{43}$/;
const INTAKE_HANDLE_RE = /^ih2_[A-Za-z0-9_-]{43}$/;

/** Parse a v2 opaque routing handle. Never use this for a local Matter.id. */
export function parseMatterHandle(value: string): MatterHandle {
  if (!MATTER_HANDLE_RE.test(value)) throw new Error('Invalid v2 matter handle.');
  return value as MatterHandle;
}

/** Parse a v2 opaque routing handle. Never use this for a local document id. */
export function parseStreamHandle(value: string): StreamHandle {
  if (!STREAM_HANDLE_RE.test(value)) throw new Error('Invalid v2 stream handle.');
  return value as StreamHandle;
}

/** Parse a v2 opaque routing handle. Never use this for a local intake id. */
export function parseIntakeHandle(value: string): IntakeHandle {
  if (!INTAKE_HANDLE_RE.test(value)) throw new Error('Invalid v2 intake handle.');
  return value as IntakeHandle;
}

/** Generate a cryptographically random opaque stream handle on this device. */
export function generateStreamHandle(): StreamHandle {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return parseStreamHandle(`sh2_${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`);
}

/** Generate a cryptographically random opaque intake handle on this device. */
export function generateIntakeHandle(): IntakeHandle {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return parseIntakeHandle(`ih2_${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`);
}

export type MatterStatus = 'provisioning' | 'active' | 'archived';
export type MatterRole = 'owner' | 'editor' | 'viewer';

/** The server-visible representation deliberately contains no client metadata. */
export interface FirmMatter {
  matter_handle: MatterHandle;
  root_stream_handle: StreamHandle;
  status: MatterStatus;
  key_epoch: number;
  role?: MatterRole;
}
export interface CreateMatterResponse {
  matter_handle: MatterHandle;
  root_stream_handle: StreamHandle;
  key_epoch: 1;
  status: 'provisioning';
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
  key_epoch: number;
  /** Members with email included (joined from users table; same-org, admin-visible). */
  members: Array<{
    user_id: string;
    org_id: string;
    role: MatterRole;
    created_at: string;
    /** Email from the users table. Present when the backend returns it (firm wiring v2). */
    email?: string | null;
  }>;
  walls: Array<{
    user_id: string;
    org_id: string;
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
  key_epoch: number;
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
  key_epoch: number;
  since: number;
  cursor: number;
  latest_cursor: number;
  has_more: boolean;
  updates: PulledUpdate[];
}
/**
 * Response of the v2 stream sync-ticket endpoint: a short-lived, single-use ticket
 * for the WS upgrade. Authed like the HTTP relay (Bearer access + X-Seat-Token
 * header). The client puts ONLY this ticket on the WS URL — never a token.
 *
 * The ticket binds the opaque stream; the WebSocket URL carries no route ID.
 */
export interface SyncTicketResponse {
  ticket: string;
  expires_in_ms: number;
}
export interface SyncReadyFrame {
  type: 'ready';
  backlog: number;
  /** Cursor supplied in the ticket; socket replay begins strictly after it. */
  replay_from_cursor: number;
  latest_cursor: number;
  /** Current subscriber count (including self) at the moment the socket joined. */
  subscribers: number;
}
export interface SyncUpdateFrame {
  type: 'update';
  cursor: number;
  blob_id: string;
  key_epoch: number;
  author_seat: string;
  created_at: string;
  ciphertext_b64: string;
}
export interface SyncPresenceFrame {
  type: 'presence';
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

/** An intake handle is bound to one opaque matter when its first key is published. */
export interface PublishIntakeKeysRequest extends PublishMatterKeysRequest {
  matter_handle: MatterHandle;
}

export type PublishIntakeKeysResponse = PublishMatterKeysResponse;
export type FetchIntakeKeysResponse = FetchMatterKeysResponse;

/** Response for POST /org/admins — org admin users (used for escrow). */
export interface OrgAdminEntry {
  user_id: string;
  email: string;
  role: 'admin';
}

export interface ListOrgAdminsResponse {
  admins: OrgAdminEntry[];
}

// --- v2 opaque discovery ---------------------------------------------------

export interface MatterMineSummary {
  matter_handle: MatterHandle;
  root_stream_handle: StreamHandle;
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

/** V2 opaque firm-relay paths. Handle placeholders are validated before dispatch. */
export const FIRM_ENDPOINTS = {
  deviceRegister: '/device/register',
  orgUserDevices: '/org/users/devices',
  orgAdmins: '/org/admins',
  matterMine: '/v2/firm/matters/mine',
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
  createMatter: '/v2/firm/matters',
  listMatters: '/v2/firm/matters/list',
  activateMatter: '/v2/firm/matters/:matter_handle/activate',
  archiveMatter: '/v2/firm/matters/:matter_handle/archive',
  releaseMatterStream: '/v2/firm/matters/:matter_handle/streams/release',
  addMatterMember: '/v2/firm/matters/:matter_handle/members/add',
  removeMatterMember: '/v2/firm/matters/:matter_handle/members/remove',
  listMatterMembers: '/v2/firm/matters/:matter_handle/members/list',
  publishMatterKeys: '/v2/firm/matters/:matter_handle/keys/publish',
  fetchMatterKeys: '/v2/firm/matters/:matter_handle/keys/fetch',
  publishIntakeKeys: '/v2/firm/intake/:intake_handle/keys/publish',
  fetchIntakeKeys: '/v2/firm/intake/:intake_handle/keys/fetch',
  setWall: '/v2/firm/matters/:matter_handle/wall/set',
  clearWall: '/v2/firm/matters/:matter_handle/wall/clear',
  pushUpdate: '/v2/firm/matters/:matter_handle/streams/:stream_handle/updates',
  pullUpdates: '/v2/firm/streams/:stream_handle/updates',
  syncTicket: '/v2/firm/streams/:stream_handle/sync-ticket',
  syncSocket: '/v2/firm/sync',
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
