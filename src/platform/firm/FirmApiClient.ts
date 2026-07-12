/**
 * FirmApiClient — the typed HTTP client for the firm backend.
 *
 * Wraps every `/auth`, `/org`, `/seat`, `/matter`, and `/assured` endpoint the
 * desktop client uses. Concerns kept here (not in the store/UI):
 *   - base-URL resolution (firmConfig)
 *   - CORS-safe fetch in production Tauri builds (reuses the model layer's
 *     `getCorsSafeFetch`, which swaps in the Tauri HTTP plugin)
 *   - automatic access-token refresh on a 401 (one retry), via an injected
 *     refresh callback so token persistence stays in the store/keychain
 *
 * It holds NO secrets long-term: tokens are passed in per call (the store owns
 * them and persists them to the keychain). This keeps the client easy to unit
 * test with a mocked `fetch`.
 */

import { getCorsSafeFetch } from '@/platform/providers/fetchUtils';
import { getFirmApiBase } from './firmConfig';
import {
  FIRM_ENDPOINTS,
  type LoginResponse,
  type RefreshResponse,
  type MeResponse,
  type ActivateResponse,
  type SeatLimitExceededResponse,
  type SeatValidateResponse,
  type CreateMatterResponse,
  type ListMattersResponse,
  type MatterMembersResponse,
  type AddMatterMemberResponse,
  type RemoveMatterMemberResponse,
  type SetWallResponse,
  type ClearWallResponse,
  type PushUpdateResponse,
  type PullUpdatesResponse,
  type SyncTicketResponse,
  type ListSeatsResponse,
  type ListProviderKeysResponse,
  type SetProviderKeyResponse,
  type DeleteProviderKeyResponse,
  type AssuredProvider,
  type MatterRole,
  type UserRole,
  type RegisterDeviceResponse,
  type FetchOrgUserDevicesResponse,
  type PublishMatterKeysRequest,
  type PublishMatterKeysResponse,
  type FetchMatterKeysResponse,
  type PublishIntakeKeysRequest,
  type PublishIntakeKeysResponse,
  type FetchIntakeKeysResponse,
  type ListOrgAdminsResponse,
  type MatterMineResponse,
  type PublicUser,
  type ListOrgUsersResponse,
  type SsoConfigSetRequest,
  type SsoConfigView,
  type MatterHandle,
  type StreamHandle,
  type IntakeHandle,
  parseMatterHandle,
  parseStreamHandle,
  parseIntakeHandle,
} from './contract';
import { OPAQUE_PROVISIONING_NONCE_PATTERN } from './opaqueBlobId';

export class FirmApiError extends Error {
  status: number;
  code: string | undefined;
  /** Present on a 409 seat-limit response so the UI can offer revoke/transfer. */
  seatLimit?: SeatLimitExceededResponse | undefined;
  constructor(status: number, code: string | undefined, message: string) {
    super(message);
    this.name = 'FirmApiError';
    this.status = status;
    this.code = code;
  }
}

/** 8 MiB ciphertext pages expand to roughly 11 MiB once base64-encoded. */
export const MAX_PULL_RESPONSE_BYTES = 16 * 1024 * 1024;

/** Token provider: how the client gets the current access token and refreshes. */
export interface TokenSource {
  getAccessToken(): string | null;
  /**
   * Refresh the access token (rotates the refresh token too). Returns the new
   * access token, or null if refresh failed (caller should treat as signed out).
   * The store implements this and persists the rotated tokens to the keychain.
   */
  refreshAccessToken(): Promise<string | null>;
}

/** Closed server-approved reasons for ending a device's firm access. */
export type SeatRevocationReasonCode = 'admin_revoked' | 'device_lost' | 'security_incident';

function hasHeaderGetter(value: unknown): value is Pick<Headers, 'get'> {
  return typeof value === 'object' && value !== null
    && typeof (value as { get?: unknown }).get === 'function';
}

async function readJson<T>(res: Response, maxBytes?: number): Promise<T> {
  // Some small unit-test response doubles intentionally expose only `text()`.
  // Real Fetch Responses always have Headers; a missing header object simply
  // means use the streaming byte counter below.
  const possibleHeaders = (res as unknown as { headers?: unknown }).headers;
  const contentLength = maxBytes === undefined || !hasHeaderGetter(possibleHeaders)
    ? 0
    : Number(possibleHeaders.get('content-length') ?? '0');
  if (maxBytes !== undefined && Number.isFinite(contentLength) && contentLength > maxBytes) {
    await res.body?.cancel();
    throw new FirmApiError(res.status, 'response_too_large', 'The relay returned an unexpectedly large response.');
  }
  let text: string;
  if (maxBytes === undefined || !res.body) {
    text = await res.text();
  } else {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new FirmApiError(res.status, 'response_too_large', 'The relay returned an unexpectedly large response.');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    text = new TextDecoder().decode(bytes);
  }
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new FirmApiError(res.status, 'bad_json', `Malformed response (HTTP ${String(res.status)}).`);
  }
}

export class FirmApiClient {
  private readonly tokens: TokenSource | null;

  constructor(tokens?: TokenSource) {
    this.tokens = tokens ?? null;
  }

  private url(path: string): string {
    return `${getFirmApiBase()}${path}`;
  }

  // --- low-level fetch with optional auth + one refresh retry ---------------
  private async request<T>(
    path: string,
    init: {
      method: string;
      body?: unknown;
      auth?: boolean;
      query?: Record<string, string>;
      /** Extra request headers (e.g. X-Seat-Token — kept OUT of the URL). */
      headers?: Record<string, string>;
      /** Cancels a bounded relay operation such as document-stream creation. */
      signal?: AbortSignal;
      /** Reject a response before it can be fully buffered in memory. */
      maxResponseBytes?: number;
    } = {
      method: 'GET',
    },
  ): Promise<T> {
    const doFetch = async (accessToken: string | null): Promise<Response> => {
      // F-120: firm-relay traffic is NOT "your AI provider" — opt out of the
      // status-bar egress pulse so its copy never lies about the destination.
      const fetchFn = await getCorsSafeFetch({ signalEgress: false });
      const headers: Record<string, string> = { ...(init.headers ?? {}) };
      if (init.body !== undefined) headers['Content-Type'] = 'application/json';
      if (init.auth && accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
      let fullPath = path;
      if (init.query) {
        const qs = new URLSearchParams(init.query).toString();
        fullPath += (path.includes('?') ? '&' : '?') + qs;
      }
      return fetchFn(this.url(fullPath), {
        method: init.method,
        headers,
        ...(init.signal ? { signal: init.signal } : {}),
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
    };

    let accessToken = init.auth && this.tokens ? this.tokens.getAccessToken() : null;
    let res = await doFetch(accessToken);

    // One automatic refresh + retry on a 401 for authed calls.
    if (res.status === 401 && init.auth && this.tokens) {
      const refreshed = await this.tokens.refreshAccessToken();
      if (refreshed) {
        accessToken = refreshed;
        res = await doFetch(accessToken);
      }
    }

    if (!res.ok) {
      const err = await readJson<{ error?: string; detail?: string } & Partial<SeatLimitExceededResponse>>(
        res,
      ).catch(() => ({}) as { error?: string; detail?: string });
      const apiErr = new FirmApiError(
        res.status,
        err.error,
        err.detail ?? err.error ?? `Request failed (HTTP ${String(res.status)}).`,
      );
      if (res.status === 409 && err.error === 'seat_limit_exceeded') {
        apiErr.seatLimit = err as SeatLimitExceededResponse;
      }
      throw apiErr;
    }
    return readJson<T>(res, init.maxResponseBytes);
  }

  // --- open endpoints --------------------------------------------------------
  async getSeatPublicKey(): Promise<string> {
    // F-120: relay traffic — see `request` above.
    const fetchFn = await getCorsSafeFetch({ signalEgress: false });
    const res = await fetchFn(this.url(FIRM_ENDPOINTS.seatPublicKey));
    if (!res.ok) throw new FirmApiError(res.status, undefined, 'Could not fetch seat public key.');
    return res.text();
  }

  // --- auth ------------------------------------------------------------------
  login(email: string, password: string): Promise<LoginResponse> {
    return this.request<LoginResponse>(FIRM_ENDPOINTS.login, {
      method: 'POST',
      body: { email, password },
    });
  }

  refresh(refreshToken: string): Promise<RefreshResponse> {
    return this.request<RefreshResponse>(FIRM_ENDPOINTS.refresh, {
      method: 'POST',
      body: { refresh_token: refreshToken },
    });
  }

  async logout(refreshToken: string): Promise<void> {
    await this.request<{ ok: true }>(FIRM_ENDPOINTS.logout, {
      method: 'POST',
      body: { refresh_token: refreshToken },
    });
  }

  me(): Promise<MeResponse> {
    return this.request<MeResponse>(FIRM_ENDPOINTS.me, { method: 'GET', auth: true });
  }

  // --- licensing / seats -----------------------------------------------------
  activate(
    licenseKey: string,
    machineId: string,
  ): Promise<ActivateResponse> {
    return this.request<ActivateResponse>(FIRM_ENDPOINTS.activate, {
      method: 'POST',
      auth: true,
      body: {
        license_key: licenseKey,
        machine_id: machineId,
      },
    });
  }

  seatValidate(seatToken: string): Promise<SeatValidateResponse> {
    return this.request<SeatValidateResponse>(FIRM_ENDPOINTS.seatValidate, {
      method: 'POST',
      body: { seat_token: seatToken },
    });
  }

  seatHeartbeat(seatToken: string): Promise<SeatValidateResponse> {
    return this.request<SeatValidateResponse>(FIRM_ENDPOINTS.seatHeartbeat, {
      method: 'POST',
      body: { seat_token: seatToken },
    });
  }

  // --- matters ---------------------------------------------------------------
  /** Provision an empty opaque shell. Client names and local IDs never cross this boundary. */
  createMatter(provisioningNonce: string, signal?: AbortSignal): Promise<CreateMatterResponse> {
    if (!OPAQUE_PROVISIONING_NONCE_PATTERN.test(provisioningNonce)) {
      throw new Error('Invalid opaque provisioning retry receipt.');
    }
    return this.request<CreateMatterResponse>(FIRM_ENDPOINTS.createMatter, {
      method: 'POST',
      auth: true,
      body: { provisioning_nonce: provisioningNonce },
      ...(signal ? { signal } : {}),
    });
  }

  activateMatter(matterHandle: MatterHandle, signal?: AbortSignal): Promise<{ ok: true }> {
    const handle = parseMatterHandle(matterHandle);
    return this.request<{ ok: true }>(
      FIRM_ENDPOINTS.activateMatter.replace(':matter_handle', encodeURIComponent(handle)),
      { method: 'POST', auth: true, body: {}, ...(signal ? { signal } : {}) },
    );
  }

  /** Hide an activated shell again when promotion cannot finish safely. */
  archiveMatter(matterHandle: MatterHandle, signal?: AbortSignal): Promise<{ ok: true }> {
    const handle = parseMatterHandle(matterHandle);
    return this.request<{ ok: true }>(
      FIRM_ENDPOINTS.archiveMatter.replace(':matter_handle', encodeURIComponent(handle)),
      { method: 'POST', auth: true, body: {}, ...(signal ? { signal } : {}) },
    );
  }

  /** Owner-only release after the encrypted root index has tombstoned a document stream. */
  releaseMatterStream(matterHandle: MatterHandle, streamHandle: StreamHandle): Promise<{ ok: true }> {
    return this.request<{ ok: true }>(
      FIRM_ENDPOINTS.releaseMatterStream.replace(':matter_handle', encodeURIComponent(parseMatterHandle(matterHandle))),
      { method: 'POST', auth: true, body: { stream_handle: parseStreamHandle(streamHandle) } },
    );
  }

  listMatters(): Promise<ListMattersResponse> {
    return this.request<ListMattersResponse>(FIRM_ENDPOINTS.listMatters, {
      method: 'POST',
      auth: true,
      body: {},
    });
  }

  /**
   * POST /matter/mine — list shared matters the calling member has access to
   * (member AND not walled). Requires Bearer + X-Seat-Token.
   */
  matterMine(seatToken: string): Promise<MatterMineResponse> {
    return this.request<MatterMineResponse>(FIRM_ENDPOINTS.matterMine, {
      method: 'POST',
      auth: true,
      body: {},
      headers: { 'X-Seat-Token': seatToken },
    });
  }

  listMatterMembers(matterHandle: MatterHandle, signal?: AbortSignal): Promise<MatterMembersResponse> {
    const handle = parseMatterHandle(matterHandle);
    return this.request<MatterMembersResponse>(
      FIRM_ENDPOINTS.listMatterMembers.replace(':matter_handle', encodeURIComponent(handle)),
      { method: 'POST', auth: true, body: {}, ...(signal ? { signal } : {}) },
    );
  }

  addMatterMember(
    matterHandle: MatterHandle,
    userId: string,
    role?: MatterRole,
  ): Promise<AddMatterMemberResponse> {
    return this.request<AddMatterMemberResponse>(
      FIRM_ENDPOINTS.addMatterMember.replace(':matter_handle', encodeURIComponent(parseMatterHandle(matterHandle))),
      { method: 'POST', auth: true, body: { user_id: userId, ...(role ? { role } : {}) } },
    );
  }

  removeMatterMember(matterHandle: MatterHandle, userId: string): Promise<RemoveMatterMemberResponse> {
    return this.request<RemoveMatterMemberResponse>(
      FIRM_ENDPOINTS.removeMatterMember.replace(':matter_handle', encodeURIComponent(parseMatterHandle(matterHandle))),
      { method: 'POST', auth: true, body: { user_id: userId } },
    );
  }

  setWall(matterHandle: MatterHandle, userId: string): Promise<SetWallResponse> {
    return this.request<SetWallResponse>(
      FIRM_ENDPOINTS.setWall.replace(':matter_handle', encodeURIComponent(parseMatterHandle(matterHandle))),
      { method: 'POST', auth: true, body: { user_id: userId } },
    );
  }

  clearWall(matterHandle: MatterHandle, userId: string): Promise<ClearWallResponse> {
    return this.request<ClearWallResponse>(
      FIRM_ENDPOINTS.clearWall.replace(':matter_handle', encodeURIComponent(parseMatterHandle(matterHandle))),
      { method: 'POST', auth: true, body: { user_id: userId } },
    );
  }

  // --- device registration + key distribution --------------------------------

  registerDevice(
    deviceId: string,
    machineId: string,
    pubkeyJwk: JsonWebKey,
    signal?: AbortSignal,
  ): Promise<RegisterDeviceResponse> {
    return this.request<RegisterDeviceResponse>(FIRM_ENDPOINTS.deviceRegister, {
      method: 'POST',
      auth: true,
      body: {
        device_id: deviceId,
        machine_id: machineId,
        pubkey_jwk: pubkeyJwk,
      },
      ...(signal ? { signal } : {}),
    });
  }

  fetchOrgUserDevices(userIds: string[], signal?: AbortSignal): Promise<FetchOrgUserDevicesResponse> {
    return this.request<FetchOrgUserDevicesResponse>(FIRM_ENDPOINTS.orgUserDevices, {
      method: 'POST',
      auth: true,
      body: { user_ids: userIds },
      ...(signal ? { signal } : {}),
    });
  }

  listOrgAdmins(signal?: AbortSignal): Promise<ListOrgAdminsResponse> {
    return this.request<ListOrgAdminsResponse>(FIRM_ENDPOINTS.orgAdmins, {
      method: 'POST',
      auth: true,
      ...(signal ? { signal } : {}),
    });
  }

  /**
   * List all users in the caller's org (admin only). Returns user_id, email,
   * role, and status so the admin console can resolve user_ids to emails without
   * requiring a create-first pattern or a local cache.
   */
  listOrgUsers(): Promise<ListOrgUsersResponse> {
    return this.request<ListOrgUsersResponse>(FIRM_ENDPOINTS.listOrgUsers, {
      method: 'POST',
      auth: true,
    });
  }

  publishMatterKeys(
    matterHandle: MatterHandle,
    payload: PublishMatterKeysRequest,
    signal?: AbortSignal,
  ): Promise<PublishMatterKeysResponse> {
    return this.request<PublishMatterKeysResponse>(
      FIRM_ENDPOINTS.publishMatterKeys.replace(':matter_handle', encodeURIComponent(parseMatterHandle(matterHandle))),
      { method: 'POST', auth: true, body: payload, ...(signal ? { signal } : {}) },
    );
  }

  fetchMatterKeys(matterHandle: MatterHandle, deviceId: string, seatToken: string): Promise<FetchMatterKeysResponse> {
    return this.request<FetchMatterKeysResponse>(
      FIRM_ENDPOINTS.fetchMatterKeys.replace(':matter_handle', encodeURIComponent(parseMatterHandle(matterHandle))),
      { method: 'POST', auth: true, body: { device_id: deviceId }, headers: { 'X-Seat-Token': seatToken } },
    );
  }

  publishIntakeKeys(
    intakeHandle: IntakeHandle,
    payload: PublishIntakeKeysRequest,
    signal?: AbortSignal,
  ): Promise<PublishIntakeKeysResponse> {
    return this.request<PublishIntakeKeysResponse>(
      FIRM_ENDPOINTS.publishIntakeKeys.replace(':intake_handle', encodeURIComponent(parseIntakeHandle(intakeHandle))),
      {
        method: 'POST',
        auth: true,
        body: { ...payload, matter_handle: parseMatterHandle(payload.matter_handle) },
        ...(signal ? { signal } : {}),
      },
    );
  }

  fetchIntakeKeys(intakeHandle: IntakeHandle, deviceId: string, seatToken: string): Promise<FetchIntakeKeysResponse> {
    return this.request<FetchIntakeKeysResponse>(
      FIRM_ENDPOINTS.fetchIntakeKeys.replace(':intake_handle', encodeURIComponent(parseIntakeHandle(intakeHandle))),
      { method: 'POST', auth: true, body: { device_id: deviceId }, headers: { 'X-Seat-Token': seatToken } },
    );
  }

  // --- E2EE relay ------------------------------------------------------------
  pushUpdate(
    matterHandle: MatterHandle,
    streamHandle: StreamHandle,
    blobId: string,
    ciphertextB64: string,
    seatToken: string,
    keyEpoch: number,
    signal?: AbortSignal,
  ): Promise<PushUpdateResponse> {
    return this.request<PushUpdateResponse>(
      FIRM_ENDPOINTS.pushUpdate
        .replace(':matter_handle', encodeURIComponent(parseMatterHandle(matterHandle)))
        .replace(':stream_handle', encodeURIComponent(parseStreamHandle(streamHandle))),
      {
        method: 'POST',
        auth: true,
        body: {
          blob_id: blobId,
          ciphertext_b64: ciphertextB64,
          seat_token: seatToken,
          key_epoch: keyEpoch,
        },
        ...(signal ? { signal } : {}),
      },
    );
  }

  pullUpdates(streamHandle: StreamHandle, since: number, seatToken: string): Promise<PullUpdatesResponse> {
    return this.request<PullUpdatesResponse>(
      FIRM_ENDPOINTS.pullUpdates.replace(':stream_handle', encodeURIComponent(parseStreamHandle(streamHandle))),
      {
        method: 'GET',
        auth: true,
        query: { since: String(since) },
        headers: { 'X-Seat-Token': seatToken },
        maxResponseBytes: MAX_PULL_RESPONSE_BYTES,
      },
    );
  }

  /**
   * Mint a single-use, short-lived ticket for the live-sync WebSocket. Authed
   * (access JWT) + the seat token in the X-Seat-Token header — exactly like the
   * HTTP relay. The returned ticket is the ONLY credential the client puts on the
   * WS URL; the access/seat token never appears in a WebSocket URL.
   *
   */
  createSyncTicket(streamHandle: StreamHandle, seatToken: string, since: number): Promise<SyncTicketResponse> {
    return this.request<SyncTicketResponse>(
      FIRM_ENDPOINTS.syncTicket.replace(':stream_handle', encodeURIComponent(parseStreamHandle(streamHandle))),
      {
        method: 'POST',
        auth: true,
        body: { since },
        headers: { 'X-Seat-Token': seatToken },
      },
    );
  }

  // --- admin: seats + users --------------------------------------------------
  listSeats(): Promise<ListSeatsResponse> {
    return this.request<ListSeatsResponse>(FIRM_ENDPOINTS.listSeats, {
      method: 'POST',
      auth: true,
    });
  }

  revokeSeat(seatId: string, reasonCode: SeatRevocationReasonCode): Promise<{ ok: true }> {
    return this.request<{ ok: true }>(FIRM_ENDPOINTS.revokeSeat, {
      method: 'POST',
      auth: true,
      body: { seat_id: seatId, reason_code: reasonCode },
    });
  }

  deprovisionUser(userId: string): Promise<{ ok: true }> {
    return this.request<{ ok: true }>(FIRM_ENDPOINTS.deprovisionUser, {
      method: 'POST',
      auth: true,
      body: { user_id: userId },
    });
  }

  createUser(email: string, password: string, role?: UserRole): Promise<{ user: PublicUser }> {
    return this.request<{ user: PublicUser }>(FIRM_ENDPOINTS.createUser, {
      method: 'POST',
      auth: true,
      body: { email, password, ...(role ? { role } : {}) },
    });
  }

  // --- org claim (self-serve purchase -> provision) ---------------------------
  /**
   * POST /org/claim — claim a provisioned-but-unclaimed org.
   *
   * Called from the "I just bought Lantern Firm" path in FirmSignIn. No auth
   * required: the license key IS the credential that proves purchase.
   * Returns full auth tokens + org + user on success.
   * Throws FirmApiError with status 409 (code 'already_claimed') or 404 (code
   * 'license_key_not_found') on the two expected failure modes.
   */
  orgClaim(
    licenseKey: string,
    email: string,
    password: string,
  ): Promise<import('./contract').OrgClaimResponse> {
    return this.request<import('./contract').OrgClaimResponse>(FIRM_ENDPOINTS.orgClaim, {
      method: 'POST',
      body: {
        license_key: licenseKey.trim(),
        email: email.trim(),
        password,
      },
    });
  }

  // --- admin: assured managed keys -------------------------------------------
  listProviderKeys(): Promise<ListProviderKeysResponse> {
    return this.request<ListProviderKeysResponse>(FIRM_ENDPOINTS.assuredKeyList, {
      method: 'POST',
      auth: true,
    });
  }

  setProviderKey(provider: AssuredProvider, apiKey: string): Promise<SetProviderKeyResponse> {
    return this.request<SetProviderKeyResponse>(FIRM_ENDPOINTS.assuredKeySet, {
      method: 'POST',
      auth: true,
      body: { provider, api_key: apiKey },
    });
  }

  deleteProviderKey(provider: AssuredProvider): Promise<DeleteProviderKeyResponse> {
    return this.request<DeleteProviderKeyResponse>(FIRM_ENDPOINTS.assuredKeyDelete, {
      method: 'POST',
      auth: true,
      body: { provider },
    });
  }

  // --- admin: SSO (OIDC) config ----------------------------------------------

  /** GET the org's SSO configuration (secret-free view). Admin only. */
  ssoConfigGet(): Promise<SsoConfigView> {
    return this.request<SsoConfigView>(FIRM_ENDPOINTS.ssoConfigGet, {
      method: 'POST',
      auth: true,
      body: {},
    });
  }

  /** Set (upsert) the org's SSO configuration. Admin only. */
  ssoConfigSet(req: SsoConfigSetRequest): Promise<{ ok: true; redirect_uri: string }> {
    return this.request<{ ok: true; redirect_uri: string }>(FIRM_ENDPOINTS.ssoConfigSet, {
      method: 'POST',
      auth: true,
      body: req,
    });
  }

  /** Delete the org's SSO configuration. Admin only. */
  ssoConfigDelete(): Promise<{ ok: true }> {
    return this.request<{ ok: true }>(FIRM_ENDPOINTS.ssoConfigDelete, {
      method: 'POST',
      auth: true,
      body: {},
    });
  }
}
