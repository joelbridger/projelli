/**
 * firmStore — the orchestration layer for the FIRM tier (opt-in).
 *
 * Solo/local mode never touches this store; it stays accountless. A firm user
 * signs in, activates a seat, and from then on this store is the single source
 * of truth for "are we a firm seat, and what does it entitle?".
 *
 * SECURITY MODEL
 * ──────────────
 *   - SECRETS (access token, refresh token, seat token, per-matter keys) live
 *     ONLY in the OS keychain (firmKeychain). They are NEVER persisted to
 *     localStorage and are NOT held in the persisted slice of this store.
 *   - The persisted slice holds only NON-secret session metadata so the app can
 *     reload the keychain secrets for the known user on next launch and show the
 *     firm UI immediately, then re-validate online.
 *
 * Entitlement: an active firm seat grants the Firm tier via `decideFirmEntitlement`
 * (the pure decision layer). Offline grace mirrors the rest of the app: a
 * network blip never bricks a paying firm; data access is never gated.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isTauri } from '@tauri-apps/api/core';
import {
  FirmApiClient,
  FirmApiError,
  type TokenSource,
} from '@/platform/firm/FirmApiClient';
import { getFirmApiBase } from '@/platform/firm/firmConfig';
import { verifySeatToken } from '@/platform/firm/seatToken';
import {
  storeAuthTokens,
  storeSeatToken,
  loadFirmTokens,
  clearUserSecrets,
} from '@/platform/firm/firmKeychain';
import {
  decideFirmEntitlement,
  type FirmSeatState,
} from '@/platform/firm/firmEntitlement';
import type { Entitlement } from '@/platform/licensing/entitlements';
import type {
  LoginResponse,
  PublicUser,
  Plan,
  ProfessionPack,
  SeatLimitExceededResponse,
  AssuredProvider,
  OrgClaimResponse,
} from '@/platform/firm/contract';
import { SK_FIRM_SESSION, SK_MACHINE_ID } from '@/config/identity';
import { OfflineModeBlockedError } from '@/platform/privacy/networkClient';
import {
  getNetworkPolicyStatus,
  subscribeToOfflineModeChanges,
} from '@/platform/privacy/offlineMode';

/** Stable per-machine id, shared with the licensing hook's convention. */
function getMachineId(): string {
  if (typeof localStorage === 'undefined') return 'unknown-machine';
  let id = localStorage.getItem(SK_MACHINE_ID);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SK_MACHINE_ID, id);
  }
  return id;
}

export interface FirmOrg {
  org_id: string;
  name: string;
  plan: Plan;
  packs: ProfessionPack[];
  seat_limit: number;
}

/** NON-secret session metadata persisted to localStorage. */
interface PersistedFirmSession {
  userId: string;
  email: string;
  role: 'admin' | 'member';
  org: FirmOrg | null;
  seatId: string | null;
  tier: Plan | null;
  packs: ProfessionPack[];
  seats: number;
  /** ISO of the last successful online seat validate (last-known-good). */
  lastValidatedAt: string | null;
  /** Whether a seat has been activated on this machine. */
  activated: boolean;
  /** Public key needed to verify a cached seat while deliberately offline. */
  seatPublicKeyPem?: string | null;
  /** A known revocation must remain known after relaunching offline. */
  lastServerVerdict?: 'valid' | 'revoked' | 'unknown';
}

interface FirmState {
  // session metadata (persisted; non-secret)
  session: PersistedFirmSession | null;
  // runtime-only (NOT persisted)
  accessToken: string | null;
  seatToken: string | null;
  seatPublicKeyPem: string | null;
  serverVerdict: 'valid' | 'revoked' | 'unknown';
  offlineSeatValid: boolean;
  isOffline: boolean;
  /** An intentional Offline Mode skip, never an outage or server verdict. */
  validationDeferredByOfflineMode: boolean;
  isLoading: boolean;
  error: string | null;
  /** Providers for which the firm has a managed (assured) key configured. */
  assuredProviders: AssuredProvider[];

  // actions
  signIn: (
    email: string,
    password: string
  ) => Promise<{ ok: boolean; error?: string }>;
  /**
   * Sign in through the firm's configured OIDC identity provider (e.g. Microsoft
   * Entra ID, Google Workspace). The Tauri command `firm_sso_authenticate` drives
   * the system browser flow and returns a standard LoginResponse JSON string; the
   * store then runs the IDENTICAL post-login path as `signIn`.
   * Only available on the desktop (Tauri) — the SSO loopback command requires it.
   */
  signInSso: (email: string) => Promise<void>;
  /**
   * Abort a pending signInSso() sign-in immediately (user clicked Cancel, or
   * closed the IdP popup and gave up) instead of leaving it to hit the
   * 5-minute server-side timeout. No-op outside Tauri or with no sign-in in
   * flight. Never touches an already-established session.
   */
  signInSsoCancel: () => Promise<void>;
  /**
   * Claim an unclaimed org with the license key the buyer received from
   * LemonSqueezy. On success the session is populated exactly like signIn
   * (tokens persisted to keychain, org + user in store). The prefilled license
   * key is returned so the caller can pre-fill the activation form.
   */
  claimOrg: (
    licenseKey: string,
    email: string,
    password: string,
    orgName?: string
  ) => Promise<{ ok: boolean; error?: string; claimedLicenseKey?: string }>;
  activateSeat: (
    licenseKey: string,
    machineLabel?: string
  ) => Promise<{
    ok: boolean;
    error?: string;
    seatLimit?: SeatLimitExceededResponse;
  }>;
  signOut: () => Promise<void>;
  /** Re-hydrate secrets from the keychain for a previously signed-in user. */
  hydrate: () => Promise<void>;
  /** Online seat validate + heartbeat; updates verdict + last-known-good. */
  validateSeat: () => Promise<void>;
  /** Refresh the list of providers with a managed assured key (admin view). */
  refreshAssuredProviders: () => Promise<void>;
  /** A TokenSource the FirmApiClient uses (auto-refresh on 401). */
  tokenSource: () => TokenSource;
  /** A FirmApiClient bound to this store's token source. */
  client: () => FirmApiClient;
}

// F2.4 follow-up: whether the in-flight signInSso() call has been asked to
// cancel. Module-scoped (not store state) because it's an internal
// coordination flag between signInSso and signInSsoCancel, not something
// any consumer should read or persist. Reset at the start of every
// signInSso() call; only meaningful while that call's promise is pending
// (the UI's Cancel button only exists for that window).
let ssoCancelRequested = false;

function emptyVerdict(): Pick<
  FirmState,
  | 'serverVerdict'
  | 'offlineSeatValid'
  | 'isOffline'
  | 'validationDeferredByOfflineMode'
> {
  return {
    serverVerdict: 'unknown',
    offlineSeatValid: false,
    isOffline: false,
    validationDeferredByOfflineMode: false,
  };
}

/** The native policy is authoritative. An unavailable policy fails closed. */
async function offlineModeBlocksFirmNetwork(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return (await getNetworkPolicyStatus()).offlineMode;
  } catch {
    return true;
  }
}

async function assertFirmNetworkAllowed(action: string): Promise<void> {
  if (await offlineModeBlocksFirmNetwork()) {
    throw new OfflineModeBlockedError(action);
  }
}

/**
 * Shared post-login path: given a LoginResponse (from either password login or
 * SSO code-exchange), store the auth tokens in the OS keychain, fetch org
 * context + seat public key, and persist the session. Called by both `signIn`
 * and `signInSso` so the two paths can never drift.
 */
async function establishSessionFromLogin(
  res: LoginResponse,
  set: (
    partial: Partial<FirmState> | ((s: FirmState) => Partial<FirmState>)
  ) => void,
  get: () => FirmState
): Promise<void> {
  const user: PublicUser = res.user;
  await storeAuthTokens(user.user_id, res.access_token, res.refresh_token);

  // Fetch org context + the seat public key (for offline verification).
  set({ accessToken: res.access_token });
  let org: FirmOrg | null = null;
  let seatPublicKeyPem: string | null = get().seatPublicKeyPem;
  try {
    const me = await new FirmApiClient(get().tokenSource()).me();
    org = me.org;
  } catch {
    /* non-fatal; org fills in on next validate */
  }
  try {
    seatPublicKeyPem = await new FirmApiClient().getSeatPublicKey();
  } catch {
    /* non-fatal; offline verify just won't run until we have it */
  }

  // Carry forward a prior seat for the SAME user (re-sign-in); otherwise
  // start fresh.
  const prevSession = get().session;
  const prev =
    prevSession && prevSession.userId === user.user_id ? prevSession : null;
  set({
    session: {
      userId: user.user_id,
      email: user.email,
      role: user.role,
      org,
      seatId: prev ? prev.seatId : null,
      tier: prev ? prev.tier : null,
      packs: prev ? prev.packs : [],
      seats: prev ? prev.seats : 1,
      lastValidatedAt: prev ? prev.lastValidatedAt : null,
      activated: prev ? prev.activated : false,
      seatPublicKeyPem,
      lastServerVerdict: prev?.lastServerVerdict ?? 'unknown',
    },
    seatPublicKeyPem,
    isLoading: false,
    error: null,
    isOffline: false,
  });
  // If a seat was already activated on this machine, re-validate it.
  if (get().session?.activated) void get().validateSeat();
}

export const useFirmStore = create<FirmState>()(
  persist(
    (set, get) => ({
      session: null,
      accessToken: null,
      seatToken: null,
      seatPublicKeyPem: null,
      ...emptyVerdict(),
      isLoading: false,
      error: null,
      assuredProviders: [],

      tokenSource: (): TokenSource => ({
        getAccessToken: () => get().accessToken,
        refreshAccessToken: async () => {
          const session = get().session;
          if (!session) return null;
          // Load the (rotating) refresh token from the keychain.
          const tokens = await loadFirmTokens(session.userId);
          if (!tokens) return null;
          try {
            await assertFirmNetworkAllowed('firm sign-in refresh');
            // Bare client (no token source) to avoid refresh recursion.
            const bare = new FirmApiClient();
            const res = await bare.refresh(tokens.refreshToken);
            await storeAuthTokens(
              session.userId,
              res.access_token,
              res.refresh_token
            );
            set({ accessToken: res.access_token, isOffline: false });
            return res.access_token;
          } catch (error) {
            if (error instanceof OfflineModeBlockedError) {
              set({ isOffline: true, validationDeferredByOfflineMode: true });
            }
            return null;
          }
        },
      }),

      client: () => new FirmApiClient(get().tokenSource()),

      signIn: async (email, password) => {
        set({ isLoading: true, error: null });
        try {
          const bare = new FirmApiClient();
          const res = await bare.login(email.trim(), password);
          await establishSessionFromLogin(res, set, get);
          return { ok: true };
        } catch (err) {
          const message =
            err instanceof FirmApiError
              ? err.message
              : err instanceof Error
                ? err.message
                : 'Sign-in failed';
          set({
            isLoading: false,
            error: message,
            isOffline: !(err instanceof FirmApiError),
          });
          return { ok: false, error: message };
        }
      },

      signInSso: async (email) => {
        set({ isLoading: true, error: null });
        ssoCancelRequested = false;
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const backendBase = getFirmApiBase();
          const raw = await invoke<string>('firm_sso_authenticate', {
            backendBase,
            email,
          });

          // `firm_sso_authenticate` already resolved (the loopback redirect
          // and code exchange both completed) — but the user may have
          // clicked Cancel in the narrow window right after that, before
          // this check runs. The Rust-side cancel flag is a no-op once its
          // own command has already returned, so treat this TS-side flag the
          // same way: no session gets established.
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- ssoCancelRequested flips via signInSsoCancel() across the await above (ESLint can't see it; same async pattern baselined in useAsk.ts).
          if (ssoCancelRequested) {
            throw new Error('cancelled');
          }

          const res = JSON.parse(raw) as LoginResponse;
          await establishSessionFromLogin(res, set, get);

          // Cancel can also arrive WHILE establishSessionFromLogin is
          // running — it stores keychain tokens as its first step, then
          // makes further network calls (me(), getSeatPublicKey()). If
          // cancel fired at any point during that, roll back: delete the
          // credential that was just stored and leave no session, so a
          // canceled flow never leaves the user silently signed in.
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- ssoCancelRequested flips via signInSsoCancel() during establishSessionFromLogin above (ESLint can't see it; same async pattern baselined in useAsk.ts).
          if (ssoCancelRequested) {
            await clearUserSecrets(res.user.user_id).catch(() => {});
            set({
              session: null,
              accessToken: null,
              isLoading: false,
              error: null,
              isOffline: false,
            });
            throw new Error('cancelled');
          }
        } catch (err) {
          // Tauri's invoke() rejects with the RAW STRING a Rust `Err(String)`
          // command returns (not wrapped in an Error) — `firm_sso_cancel`
          // produces exactly this shape, so `typeof err === 'string'` must be
          // checked before the generic Error/fallback branches, or a real
          // cancellation is misread as "SSO sign-in failed".
          const message =
            typeof err === 'string'
              ? err
              : err instanceof FirmApiError
                ? err.message
                : err instanceof Error
                  ? err.message
                  : 'SSO sign-in failed';
          // The user clicked Cancel — an intentional exit, not a failure, so
          // don't surface it as a store-level error (and no session was ever
          // established).
          const cancelled = message === 'cancelled';
          set({
            isLoading: false,
            error: cancelled ? null : message,
            isOffline: cancelled ? false : !(err instanceof FirmApiError),
          });
          throw err instanceof Error ? err : new Error(message);
        }
      },

      signInSsoCancel: async () => {
        // Flip the TS-side flag FIRST (before the await below) so it's
        // already visible to signInSso's post-checks even if the Rust
        // command has already returned by the time this runs.
        ssoCancelRequested = true;
        const { invoke, isTauri } = await import('@tauri-apps/api/core');
        if (!isTauri()) return;
        await invoke('firm_sso_cancel');
      },

      claimOrg: async (licenseKey, email, password, orgName) => {
        set({ isLoading: true, error: null });
        try {
          const bare = new FirmApiClient();
          const res: OrgClaimResponse = await bare.orgClaim(
            licenseKey,
            email,
            password,
            orgName
          );
          const user: PublicUser = res.user;
          await storeAuthTokens(
            user.user_id,
            res.access_token,
            res.refresh_token
          );

          // Fetch the seat public key for offline verification (non-fatal).
          let seatPublicKeyPem: string | null = get().seatPublicKeyPem;
          try {
            seatPublicKeyPem = await new FirmApiClient().getSeatPublicKey();
          } catch {
            /* non-fatal */
          }

          set({
            accessToken: res.access_token,
            session: {
              userId: user.user_id,
              email: user.email,
              role: user.role,
              org: res.org,
              seatId: null,
              tier: null,
              packs: [],
              seats: 1,
              lastValidatedAt: null,
              activated: false,
              seatPublicKeyPem,
              lastServerVerdict: 'unknown',
            },
            seatPublicKeyPem,
            isLoading: false,
            error: null,
            isOffline: false,
          });
          return { ok: true, claimedLicenseKey: licenseKey.trim() };
        } catch (err) {
          const message =
            err instanceof FirmApiError
              ? err.message
              : err instanceof Error
                ? err.message
                : 'Claim failed';
          set({
            isLoading: false,
            error: message,
            isOffline: !(err instanceof FirmApiError),
          });
          return { ok: false, error: message };
        }
      },

      activateSeat: async (licenseKey, machineLabel) => {
        const session = get().session;
        if (!session) return { ok: false, error: 'Sign in first.' };
        set({ isLoading: true, error: null });
        try {
          await assertFirmNetworkAllowed('firm seat activation');
          const client = get().client();
          const res = await client.activate(
            licenseKey.trim(),
            getMachineId(),
            machineLabel
          );
          await storeSeatToken(session.userId, res.seat_token);

          // Verify the freshly minted seat token offline against the public key.
          let offlineSeatValid = false;
          const pem = get().seatPublicKeyPem ?? (await safeGetPubKey(get));
          if (pem) {
            const v = await verifySeatToken(res.seat_token, pem);
            offlineSeatValid = v.valid;
          }

          const now = new Date().toISOString();
          set({
            seatToken: res.seat_token,
            seatPublicKeyPem: pem,
            serverVerdict: 'valid',
            offlineSeatValid,
            isOffline: false,
            validationDeferredByOfflineMode: false,
            isLoading: false,
            error: null,
            session: {
              ...session,
              seatId: res.seat_id,
              tier: res.tier,
              packs: res.packs,
              seats: res.seats,
              lastValidatedAt: now,
              activated: true,
              seatPublicKeyPem: pem,
              lastServerVerdict: 'valid',
            },
          });
          return { ok: true };
        } catch (err) {
          if (err instanceof FirmApiError && err.seatLimit) {
            set({ isLoading: false, error: err.message });
            return { ok: false, error: err.message, seatLimit: err.seatLimit };
          }
          const message =
            err instanceof Error ? err.message : 'Activation failed';
          set({ isLoading: false, error: message });
          return { ok: false, error: message };
        }
      },

      signOut: async () => {
        // Matter sync teardown is handled automatically by the subscription
        // in matterNotesSync.ts (useFirmStore.subscribe → stopAll on seatToken
        // cleared). We just clear credentials here.
        const session = get().session;
        if (session) {
          // Best-effort server logout with the current refresh token.
          try {
            const tokens = await loadFirmTokens(session.userId);
            if (tokens) await new FirmApiClient().logout(tokens.refreshToken);
          } catch {
            /* ignore */
          }
          await clearUserSecrets(session.userId);
        }
        set({
          session: null,
          accessToken: null,
          seatToken: null,
          ...emptyVerdict(),
          assuredProviders: [],
          error: null,
        });
      },

      hydrate: async () => {
        const session = get().session;
        if (!session) return;
        const tokens = await loadFirmTokens(session.userId);
        if (!tokens) {
          // Secrets gone (different machine / keychain cleared): treat as signed
          // out but keep no stale runtime tokens.
          set({ accessToken: null, seatToken: null, ...emptyVerdict() });
          return;
        }
        const offlineModeOn = await offlineModeBlocksFirmNetwork();
        const cachedPem =
          get().seatPublicKeyPem ?? session.seatPublicKeyPem ?? null;
        set({
          accessToken: tokens.accessToken,
          seatToken: tokens.seatToken ?? null,
          seatPublicKeyPem: cachedPem,
        });

        // Offline-verify the stored seat token immediately (works on a plane).
        let offlineSeatValid = false;
        let pem = cachedPem;
        // Offline Mode may use the cached public key but must never refresh it.
        if (!pem && !offlineModeOn) pem = await safeGetPubKey(get);
        if (pem && tokens.seatToken) {
          const v = await verifySeatToken(tokens.seatToken, pem);
          offlineSeatValid = v.valid;
        }
        const knownVerdict = session.lastServerVerdict ?? 'unknown';
        set({
          seatPublicKeyPem: pem,
          offlineSeatValid,
          // A previous server revocation is never turned into grace access.
          serverVerdict:
            offlineModeOn && knownVerdict !== 'revoked'
              ? 'unknown'
              : knownVerdict,
          isOffline: offlineModeOn,
          validationDeferredByOfflineMode: offlineModeOn,
        });

        // Then try an online validate to catch revocations.
        if (session.activated && !offlineModeOn) void get().validateSeat();
      },

      validateSeat: async () => {
        const session = get().session;
        const seatToken = get().seatToken;
        if (!session || !seatToken) return;
        try {
          await assertFirmNetworkAllowed('firm seat validation');
          const res = await new FirmApiClient().seatHeartbeat(seatToken);
          if (res.valid) {
            const now = new Date().toISOString();
            set((s) => ({
              serverVerdict: 'valid',
              isOffline: false,
              validationDeferredByOfflineMode: false,
              session: s.session
                ? {
                    ...s.session,
                    tier: res.tier,
                    packs: res.packs,
                    seats: res.seats,
                    seatId: res.seat_id,
                    lastValidatedAt: now,
                    lastServerVerdict: 'valid',
                  }
                : s.session,
            }));
          } else {
            // Server rejected the seat (revoked / deprovisioned / suspended).
            // Degrade features, keep data — never lock out.
            set((s) => ({
              serverVerdict: 'revoked',
              isOffline: false,
              validationDeferredByOfflineMode: false,
              session: s.session
                ? { ...s.session, lastServerVerdict: 'revoked' }
                : s.session,
            }));
          }
        } catch (error) {
          // Network failure — rely on the offline-verified token within grace.
          set((s) => ({
            serverVerdict:
              s.serverVerdict === 'revoked' ? 'revoked' : 'unknown',
            isOffline: true,
            validationDeferredByOfflineMode:
              error instanceof OfflineModeBlockedError,
          }));
        }
      },

      refreshAssuredProviders: async () => {
        const session = get().session;
        if (!session || session.role !== 'admin') {
          set({ assuredProviders: [] });
          return;
        }
        try {
          if (await offlineModeBlocksFirmNetwork()) {
            // Keep the cached list. An intentional stop is not a failed refresh.
            set({ isOffline: true, validationDeferredByOfflineMode: true });
            return;
          }
          const res = await get().client().listProviderKeys();
          set({ assuredProviders: res.keys.map((k) => k.provider) });
        } catch {
          /* leave as-is on error */
        }
      },
    }),
    {
      name: SK_FIRM_SESSION,
      version: 2,
      // Persist ONLY non-secret session metadata. Secrets stay in the keychain.
      partialize: (state) => ({ session: state.session }),
    }
  )
);

/** Fetch + cache the seat public key, tolerating failure (offline). */
async function safeGetPubKey(get: () => FirmState): Promise<string | null> {
  if (await offlineModeBlocksFirmNetwork()) return get().seatPublicKeyPem;
  try {
    return await new FirmApiClient().getSeatPublicKey();
  } catch {
    return get().seatPublicKeyPem;
  }
}

// Turning Offline Mode on changes the local entitlement input immediately.
// Turning it off deliberately does not restart validation or provider refresh.
subscribeToOfflineModeChanges((status) => {
  if (!status.offlineMode) return;
  useFirmStore.setState((current) => ({
    serverVerdict: current.serverVerdict === 'revoked' ? 'revoked' : 'unknown',
    isOffline: true,
    validationDeferredByOfflineMode: true,
  }));
});

// ─────────────────────────────────────────────────────────────────────
// Derived selectors
// ─────────────────────────────────────────────────────────────────────

/** Build the FirmSeatState the entitlement layer consumes. */
export function selectFirmSeatState(s: FirmState): FirmSeatState {
  const session = s.session;
  return {
    activated: Boolean(session?.activated),
    tier: session?.tier ?? 'free',
    packs: session?.packs ?? [],
    seats: session?.seats ?? 1,
    serverVerdict: s.serverVerdict,
    offlineValid: s.offlineSeatValid,
    lastValidatedAt: session?.lastValidatedAt ?? null,
  };
}

/** The firm entitlement (pure decision over the current seat state). */
export function selectFirmEntitlement(
  s: FirmState,
  now: Date = new Date()
): Entitlement {
  return decideFirmEntitlement(selectFirmSeatState(s), now);
}

/** True when the user is signed into a firm (regardless of seat state). */
export function selectIsFirmSignedIn(s: FirmState): boolean {
  return s.session != null;
}

/** True when an active firm seat currently grants the Firm tier. */
export function selectHasActiveFirmSeat(s: FirmState): boolean {
  return selectFirmEntitlement(s).aiEnabled && Boolean(s.session?.activated);
}

// Non-reactive accessors for provider construction outside React.
export function getFirmSeatToken(): string | null {
  return useFirmStore.getState().seatToken;
}
export function getFirmAccessToken(): string | null {
  return useFirmStore.getState().accessToken;
}
export function getAssuredProviders(): AssuredProvider[] {
  return useFirmStore.getState().assuredProviders;
}
