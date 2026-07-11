/**
 * useLicense — license activation, validation, and tier-gating hook for Lantern.
 *
 * Talks to the licenses.lanternplatform.app Bun service. The desktop app stores the
 * activation token in localStorage (would ideally be in the OS keychain, same
 * as API keys — that's a future TODO).
 *
 * Public API:
 *   const { tier, isLoading, isActivated, activate, deactivate, refresh } = useLicense();
 *
 * tier values:
 *   - 'free' — unactivated / post-trial; no paid features unlocked
 *   - 'personal' — $49 perpetual; full app, no profession pack
 *   - 'professional' — $129 perpetual; full app + ONE profession pack
 *   - 'practice' — $399 perpetual; full app + ALL packs + up to 5 seats
 *
 * profession packs (separate entitlement, not a feature flag):
 *   - 'legal' | 'tax' | 'consulting'
 *
 * Activation flow (from the user's perspective):
 *   1. User pastes their license key into Settings → License
 *   2. App POSTs to licenses.lanternplatform.app/activate with { license_key, machine_id }
 *   3. Server returns a signed JWT
 *   4. App stores the JWT in localStorage and calls /validate to confirm it
 *   5. UI now shows the user as activated, with the tier they purchased
 *
 * Re-validation flow:
 *   - On every app launch, the JWT is read from storage and verified locally
 *     by checking its `exp` field
 *   - Once a week (TODO: use a real timer), the app re-calls /validate to
 *     check the revocation list. If revoked, the local token is cleared.
 *   - If the JWT is past its 30-day expiration, the user falls back to free
 *     tier until they re-activate (online required).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { sendEvent } from '@/platform/utils/telemetry';
import { BRAND } from '@/config/brand';
import {
  egressFetch,
  OfflineModeBlockedError,
} from '@/platform/privacy/networkClient';
import {
  getNetworkPolicyStatus,
  subscribeToOfflineModeChanges,
} from '@/platform/privacy/offlineMode';
import {
  SK_MACHINE_ID,
  SK_LICENSE_TOKEN,
  SK_LICENSE_LAST_GOOD_AT,
} from '@/config/identity';

export type LicenseTier = 'free' | 'personal' | 'professional' | 'practice';
export type ProfessionPack = 'legal' | 'tax' | 'consulting';

export interface LicenseState {
  tier: LicenseTier;
  packs: ProfessionPack[];
  seats: number;
  isLoading: boolean;
  isActivated: boolean;
  expiresAt: Date | null;
  error: string | null;
  /**
   * License/subscription status as last understood (from the server's validate
   * response or the JWT). Feeds the entitlement layer; `undefined` is treated
   * conservatively (legacy payloads => "active if not expired").
   */
  status?: string | undefined;
  /**
   * The kind of license: old one-time product codes vs the 3.0 'subscription'
   * / 'trial'. Used to detect a pre-3.0 buyer for grandfathering.
   */
  type?: string | undefined;
  /** ISO purchase date, used as one grandfather signal (bought before 3.0). */
  purchasedAt: Date | null;
  /** Explicit perpetual/lifetime flag — the strongest grandfather signal. */
  perpetual?: boolean | undefined;
  /**
   * True when the most recent attempt to reach the license server FAILED. The
   * entitlement layer uses this to honor last-known-good during an outage so a
   * network blip never bricks a paying user.
   */
  isOffline: boolean;
  /**
   * ISO timestamp of the last time the server CONFIRMED this license valid
   * (last-known-good). Persisted so offline grace survives relaunches.
   */
  lastKnownGoodAt: Date | null;
  /** A deliberate Offline Mode skip, distinct from a broken network or revocation. */
  validationDeferredByOfflineMode: boolean;
}

const STORAGE_KEY = SK_LICENSE_TOKEN;
const MACHINE_ID_KEY = SK_MACHINE_ID;
const LAST_GOOD_KEY = SK_LICENSE_LAST_GOOD_AT;
const LICENSE_API_BASE = BRAND.urls.licenseApi;
const APP_VERSION = '2.1.0';

/**
 * Shape of the license validator's /activate and /validate JSON responses.
 * The server is dependency-free (see backend/src/contract.ts); we type the
 * fields we read so the entitlement plumbing is not built on `any`. Every field
 * is optional because legacy/error payloads may omit them.
 */
interface LicenseServerResponse {
  token?: string;
  tier?: LicenseTier;
  packs?: ProfessionPack[];
  seats?: number;
  expires_at?: string | null;
  purchased_at?: string | null;
  status?: string;
  type?: string;
  license_type?: string;
  perpetual?: boolean;
  valid?: boolean;
  reason?: string;
  detail?: string;
  error?: string;
}

/** Read the persisted last-known-good validation timestamp, if any. */
function readLastKnownGood(): Date | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(LAST_GOOD_KEY);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Persist the last-known-good validation timestamp. */
function writeLastKnownGood(when: Date): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LAST_GOOD_KEY, when.toISOString());
}

/**
 * Generate or retrieve a stable machine ID. Stored in localStorage.
 * (For better fingerprinting, this could use the OS hostname + a random UUID
 * via Tauri's invoke API, but localStorage is sufficient for now.)
 */
function getMachineId(): string {
  let id = localStorage.getItem(MACHINE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(MACHINE_ID_KEY, id);
  }
  return id;
}

/**
 * Decode a JWT payload without signature verification.
 * (Real verification happens server-side via /validate.)
 */
function decodeJwtPayload(
  token: string
): {
  tier?: LicenseTier;
  packs?: ProfessionPack[];
  seats?: number;
  exp?: number;
  sub?: string;
  status?: string;
  type?: string;
  license_type?: string;
  purchased_at?: string;
  perpetual?: boolean;
} | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const part = parts[1];
    if (!part) return null;
    const padded = part.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(padded + '==='.slice((padded.length + 3) % 4));
    return JSON.parse(decoded) as unknown as {
      tier?: LicenseTier;
      packs?: ProfessionPack[];
      seats?: number;
      exp?: number;
      sub?: string;
      status?: string;
      type?: string;
      license_type?: string;
      purchased_at?: string;
      perpetual?: boolean;
    };
  } catch {
    return null;
  }
}

/**
 * QA bypass: when the URL contains `?fakeLicense=personal`,
 * `?fakeLicense=professional`, or `?fakeLicense=practice`, treat the user
 * as activated without ever hitting the validator service. An optional
 * `&fakePacks=legal,tax,consulting` seeds the active profession pack(s).
 * Lets us visually verify the activated-state UI (green chip, pack labels,
 * etc.) without minting a real license. No-op in production URLs because
 * the params are never set there.
 */
function readFakeLicense(): {
  tier: LicenseTier;
  packs: ProfessionPack[];
} | null {
  if (typeof window === 'undefined') return null;
  // SECURITY (licensing audit): the `?fakeLicense=` QA bypass must NEVER work in
  // a production build — otherwise a user could unlock paid tiers (incl. Firm)
  // just by adding a URL param. It stays available on the Vite dev server (where
  // the QA / full-user-test playbook runs); `import.meta.env.DEV` is false in
  // every shipped/signed build and in the public web-demo build.
  if (!import.meta.env.DEV) return null;
  const m = window.location.search.match(
    /[?&]fakeLicense=(personal|professional|practice)\b/
  );
  if (!m) return null;
  const packsMatch = window.location.search.match(/[?&]fakePacks=([a-z,]+)/);
  const packs = packsMatch
    ? packsMatch[1]!
        .split(',')
        .filter(
          (p): p is ProfessionPack =>
            p === 'legal' || p === 'tax' || p === 'consulting'
        )
    : [];
  return { tier: m[1] as LicenseTier, packs };
}

export function useLicense() {
  const [state, setState] = useState<LicenseState>(() => {
    const lastKnownGoodAt = readLastKnownGood();
    const fake = readFakeLicense();
    if (fake) {
      return {
        tier: fake.tier,
        packs: fake.packs,
        seats: 1,
        isLoading: false,
        isActivated: true,
        expiresAt: null,
        error: null,
        purchasedAt: null,
        isOffline: false,
        lastKnownGoodAt,
        validationDeferredByOfflineMode: false,
      };
    }
    const token = localStorage.getItem(STORAGE_KEY);
    if (!token) {
      return {
        tier: 'free',
        packs: [],
        seats: 1,
        isLoading: false,
        isActivated: false,
        expiresAt: null,
        error: null,
        purchasedAt: null,
        isOffline: false,
        lastKnownGoodAt,
        validationDeferredByOfflineMode: false,
      };
    }
    const payload = decodeJwtPayload(token);
    if (!payload || !payload.exp) {
      return {
        tier: 'free',
        packs: [],
        seats: 1,
        isLoading: false,
        isActivated: false,
        expiresAt: null,
        error: null,
        purchasedAt: null,
        isOffline: false,
        lastKnownGoodAt,
        validationDeferredByOfflineMode: false,
      };
    }
    const expiresAt = new Date(payload.exp * 1000);
    const purchasedAt = payload.purchased_at
      ? new Date(payload.purchased_at)
      : null;
    // A grandfathered/perpetual license never expires by date. For a normal
    // subscription, an expired JWT just means we need to re-validate; we do NOT
    // wipe the token or hard-drop to free here, because the entitlement layer
    // will degrade gracefully (data stays accessible) and a refresh can restore
    // it. We only fall back to free if there's genuinely nothing usable.
    return {
      tier: payload.tier ?? 'free',
      packs: payload.packs ?? [],
      seats: payload.seats ?? 1,
      isLoading: false,
      isActivated: true,
      expiresAt,
      error: null,
      status: payload.status,
      type: payload.type ?? payload.license_type,
      purchasedAt:
        purchasedAt && !Number.isNaN(purchasedAt.getTime())
          ? purchasedAt
          : null,
      perpetual: payload.perpetual,
      isOffline: false,
      lastKnownGoodAt,
      validationDeferredByOfflineMode: false,
    };
  });
  const weeklyValidationTimer = useRef<ReturnType<typeof setInterval> | null>(
    null
  );

  /**
   * Activate a license key by sending it to the license validator.
   */
  const activate = useCallback(
    async (
      licenseKey: string
    ): Promise<{ success: boolean; error?: string }> => {
      setState((s) => ({ ...s, isLoading: true, error: null }));
      try {
        const res = await egressFetch(
          'license-api',
          `${LICENSE_API_BASE}/activate`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              license_key: licenseKey.trim(),
              machine_id: getMachineId(),
              app_version: APP_VERSION,
            }),
          }
        );
        const data = (await res.json()) as LicenseServerResponse;
        if (!res.ok) {
          const errorMsg = data.detail ?? data.error ?? 'Activation failed';
          setState((s) => ({ ...s, isLoading: false, error: errorMsg }));
          return { success: false, error: errorMsg };
        }
        if (!data.token) {
          const errorMsg = 'Activation failed: no token returned';
          setState((s) => ({ ...s, isLoading: false, error: errorMsg }));
          return { success: false, error: errorMsg };
        }
        localStorage.setItem(STORAGE_KEY, data.token);
        const now = new Date();
        writeLastKnownGood(now);
        const purchasedAt = data.purchased_at
          ? new Date(data.purchased_at)
          : null;
        setState({
          tier: data.tier ?? 'free',
          packs: data.packs ?? [],
          seats: data.seats ?? 1,
          isLoading: false,
          isActivated: true,
          expiresAt: data.expires_at ? new Date(data.expires_at) : null,
          error: null,
          status: data.status,
          type: data.type ?? data.license_type,
          purchasedAt:
            purchasedAt && !Number.isNaN(purchasedAt.getTime())
              ? purchasedAt
              : null,
          perpetual: data.perpetual,
          isOffline: false,
          lastKnownGoodAt: now,
          validationDeferredByOfflineMode: false,
        });
        // Anonymous funnel: someone successfully activated. Sent only if
        // the user opted into telemetry.
        void sendEvent('license_activated', {
          license_tier: data.tier as string,
        });
        return { success: true };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        if (err instanceof OfflineModeBlockedError) {
          setState((s) => ({
            ...s,
            isLoading: false,
            isOffline: true,
            validationDeferredByOfflineMode: true,
            error: errorMsg,
          }));
        } else {
          setState((s) => ({
            ...s,
            isLoading: false,
            error: `Network error: ${errorMsg}`,
          }));
        }
        return { success: false, error: errorMsg };
      }
    },
    []
  );

  /**
   * Deactivate the current license (clears local token, reverts to free tier).
   */
  const deactivate = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LAST_GOOD_KEY);
    setState({
      tier: 'free',
      packs: [],
      seats: 1,
      isLoading: false,
      isActivated: false,
      expiresAt: null,
      error: null,
      purchasedAt: null,
      isOffline: false,
      lastKnownGoodAt: null,
      validationDeferredByOfflineMode: false,
    });
    void sendEvent('license_deactivated');
  }, []);

  /**
   * Re-validate the current token against the server. Used periodically to
   * catch revocations (e.g., refunds).
   */
  const refresh = useCallback(async (): Promise<{
    valid: boolean;
    reason?: string;
  }> => {
    const token = localStorage.getItem(STORAGE_KEY);
    if (!token) return { valid: false, reason: 'no_token' };
    try {
      const res = await egressFetch(
        'license-api',
        `${LICENSE_API_BASE}/validate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        }
      );
      const data = (await res.json()) as LicenseServerResponse;
      if (!data.valid) {
        // The server rejected the token (e.g. a refund/revocation, or an
        // expired subscription). We record the status so the entitlement layer
        // can DEGRADE GRACEFULLY — AI + updates off, but the user's data, email,
        // matters, and EXPORT stay fully usable. We do NOT wipe the token here:
        // wiping it would also drop a grandfathered/perpetual buyer if the
        // server ever mis-reports, and the data-ownership guarantee means a
        // lapsed/revoked state must never become a hard lockout. The token is
        // only cleared when the user explicitly deactivates.
        setState((s) => ({
          ...s,
          isLoading: false,
          // Keep `isActivated` so the app still treats this as a known (if
          // lapsed) license rather than snapping back to an unactivated/trial
          // surface. The entitlement layer turns features off, not data.
          isActivated: true,
          status: data.reason ?? 'lapsed',
          isOffline: false,
          validationDeferredByOfflineMode: false,
          error: null,
        }));
        return { valid: false, reason: data.reason ?? 'invalid' };
      }
      // Token still valid; refresh the local state to mirror server's view and
      // stamp last-known-good so offline grace has a fresh anchor.
      const now = new Date();
      writeLastKnownGood(now);
      const purchasedAt = data.purchased_at
        ? new Date(data.purchased_at)
        : null;
      setState((s) => ({
        ...s,
        tier: data.tier ?? s.tier,
        packs: data.packs ?? [],
        seats: data.seats ?? 1,
        isLoading: false,
        isActivated: true,
        expiresAt: data.expires_at ? new Date(data.expires_at) : null,
        error: null,
        status: data.status ?? 'active',
        type: data.type ?? data.license_type ?? s.type,
        purchasedAt:
          purchasedAt && !Number.isNaN(purchasedAt.getTime())
            ? purchasedAt
            : s.purchasedAt,
        perpetual: data.perpetual ?? s.perpetual,
        isOffline: false,
        lastKnownGoodAt: now,
        validationDeferredByOfflineMode: false,
      }));
      return { valid: true };
    } catch (err) {
      if (err instanceof OfflineModeBlockedError) {
        // This is an intentional privacy choice, not a failed check and never
        // a server verdict. Keep the token and let entitlement grace decide.
        setState((s) => ({
          ...s,
          isOffline: true,
          isLoading: false,
          validationDeferredByOfflineMode: true,
          error: null,
        }));
        return { valid: false, reason: 'offline_mode' };
      }
      // Network error during validation — the license server is unreachable.
      // Mark offline so the entitlement layer honors last-known-good within the
      // grace window. NEVER lock the user out on a network failure.
      console.warn('License re-validation failed (network):', err);
      setState((s) => ({
        ...s,
        isOffline: true,
        isLoading: false,
        validationDeferredByOfflineMode: false,
      }));
      return { valid: false, reason: 'network' };
    }
  }, []);

  /**
   * Periodically re-validate (once a week).
   * On launch, also fire a refresh immediately to catch any revocations.
   */
  useEffect(() => {
    if (!state.isActivated) return;
    // Skip server validation entirely when the QA bypass is active so the
    // fake license isn't rejected and immediately cleared.
    if (readFakeLicense()) return;
    const clearWeeklyValidation = () => {
      if (weeklyValidationTimer.current !== null) {
        clearInterval(weeklyValidationTimer.current);
        weeklyValidationTimer.current = null;
      }
    };
    const startValidationIfAllowed = async () => {
      // Browser/dev builds have no native Offline Mode switch. The desktop
      // policy remains fail-closed if its status cannot be read.
      if (isTauri()) {
        try {
          if ((await getNetworkPolicyStatus()).offlineMode) {
            setState((s) => ({
              ...s,
              isOffline: true,
              validationDeferredByOfflineMode: true,
            }));
            return;
          }
        } catch {
          setState((s) => ({
            ...s,
            isOffline: true,
            validationDeferredByOfflineMode: true,
          }));
          return;
        }
      }
      void refresh();
      weeklyValidationTimer.current = setInterval(
        () => {
          void refresh();
        },
        7 * 24 * 60 * 60 * 1000
      );
    };
    void startValidationIfAllowed();
    const unsubscribe = subscribeToOfflineModeChanges((status) => {
      if (!status.offlineMode) return;
      clearWeeklyValidation();
      setState((s) => ({
        ...s,
        isOffline: true,
        validationDeferredByOfflineMode: true,
      }));
    });
    return () => {
      clearWeeklyValidation();
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    ...state,
    activate,
    deactivate,
    refresh,
  };
}

/**
 * Tier-gating helper. Returns true if the current tier has access to the
 * specified feature.
 *
 * New pricing model: every paid tier (personal / professional / practice)
 * gets the FULL app — editor, all providers, audio, research,
 * multi-model comparison, and commercial use. The only paid differentiators
 * are which profession PACK you get (see `hasPack`) and seat count, neither
 * of which is a per-feature flag. So every feature simply reduces to
 * `tier !== 'free'`. (Trial users have tier 'free' but get full access via
 * the separate `useTrial` gate, which is checked at the call site.)
 */
export function tierHasFeature(
  tier: LicenseTier,
  feature:
    | 'multi-provider'
    | 'all-templates'
    | 'unlimited-workspaces'
    | 'audio'
    | 'research-citations'
    | 'multi-model-comparison'
    | 'commercial-use'
): boolean {
  switch (feature) {
    case 'multi-provider':
    case 'all-templates':
    case 'unlimited-workspaces':
    case 'audio':
    case 'research-citations':
    case 'multi-model-comparison':
    case 'commercial-use':
      return tier !== 'free';
    default:
      return false;
  }
}

/**
 * Profession-pack entitlement check. Practice unlocks every pack; the other
 * tiers only have the packs explicitly granted on the license.
 */
export function hasPack(
  state: { tier: LicenseTier; packs: ProfessionPack[] },
  pack: ProfessionPack
): boolean {
  return state.tier === 'practice' || state.packs.includes(pack);
}
