/**
 * useLicense — license activation, validation, and tier-gating hook for Keepance.
 *
 * Talks to the licenses.keepance.com Bun service. The desktop app stores the
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
 *   2. App POSTs to licenses.keepance.com/activate with { license_key, machine_id }
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

import { useCallback, useEffect, useState } from 'react';
import { sendEvent } from '@/utils/telemetry';

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
}

const STORAGE_KEY = 'keepance_license_token';
const MACHINE_ID_KEY = 'keepance_machine_id';
const LICENSE_API_BASE = 'https://licenses.keepance.com';
const APP_VERSION = '2.1.0';

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
function decodeJwtPayload(token: string): { tier?: LicenseTier; packs?: ProfessionPack[]; seats?: number; exp?: number; sub?: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const part = parts[1];
    if (!part) return null;
    const padded = part.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(padded + '==='.slice((padded.length + 3) % 4));
    return JSON.parse(decoded);
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
function readFakeLicense(): { tier: LicenseTier; packs: ProfessionPack[] } | null {
  if (typeof window === 'undefined') return null;
  const m = window.location.search.match(/[?&]fakeLicense=(personal|professional|practice)\b/);
  if (!m) return null;
  const packsMatch = window.location.search.match(/[?&]fakePacks=([a-z,]+)/);
  const packs = packsMatch
    ? (packsMatch[1]!
        .split(',')
        .filter((p): p is ProfessionPack => p === 'legal' || p === 'tax' || p === 'consulting'))
    : [];
  return { tier: m[1] as LicenseTier, packs };
}

export function useLicense() {
  const [state, setState] = useState<LicenseState>(() => {
    const fake = readFakeLicense();
    if (fake) {
      return { tier: fake.tier, packs: fake.packs, seats: 1, isLoading: false, isActivated: true, expiresAt: null, error: null };
    }
    const token = localStorage.getItem(STORAGE_KEY);
    if (!token) {
      return { tier: 'free', packs: [], seats: 1, isLoading: false, isActivated: false, expiresAt: null, error: null };
    }
    const payload = decodeJwtPayload(token);
    if (!payload || !payload.exp) {
      return { tier: 'free', packs: [], seats: 1, isLoading: false, isActivated: false, expiresAt: null, error: null };
    }
    const expiresAt = new Date(payload.exp * 1000);
    if (expiresAt < new Date()) {
      // Token expired — clear it and fall back to free tier
      localStorage.removeItem(STORAGE_KEY);
      return { tier: 'free', packs: [], seats: 1, isLoading: false, isActivated: false, expiresAt: null, error: 'Token expired. Please re-activate.' };
    }
    return {
      tier: payload.tier ?? 'free',
      packs: payload.packs ?? [],
      seats: payload.seats ?? 1,
      isLoading: false,
      isActivated: true,
      expiresAt,
      error: null,
    };
  });

  /**
   * Activate a license key by sending it to the license validator.
   */
  const activate = useCallback(async (licenseKey: string): Promise<{ success: boolean; error?: string }> => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const res = await fetch(`${LICENSE_API_BASE}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          license_key: licenseKey.trim(),
          machine_id: getMachineId(),
          app_version: APP_VERSION,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const errorMsg = data.detail ?? data.error ?? 'Activation failed';
        setState((s) => ({ ...s, isLoading: false, error: errorMsg }));
        return { success: false, error: errorMsg };
      }
      localStorage.setItem(STORAGE_KEY, data.token);
      setState({
        tier: data.tier as LicenseTier,
        packs: (data.packs ?? []) as ProfessionPack[],
        seats: data.seats ?? 1,
        isLoading: false,
        isActivated: true,
        expiresAt: new Date(data.expires_at),
        error: null,
      });
      // Anonymous funnel: someone successfully activated. Sent only if
      // the user opted into telemetry.
      void sendEvent('license_activated', { license_tier: data.tier as string });
      return { success: true };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setState((s) => ({ ...s, isLoading: false, error: `Network error: ${errorMsg}` }));
      return { success: false, error: errorMsg };
    }
  }, []);

  /**
   * Deactivate the current license (clears local token, reverts to free tier).
   */
  const deactivate = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setState({ tier: 'free', packs: [], seats: 1, isLoading: false, isActivated: false, expiresAt: null, error: null });
    void sendEvent('license_deactivated');
  }, []);

  /**
   * Re-validate the current token against the server. Used periodically to
   * catch revocations (e.g., refunds).
   */
  const refresh = useCallback(async (): Promise<{ valid: boolean; reason?: string }> => {
    const token = localStorage.getItem(STORAGE_KEY);
    if (!token) return { valid: false, reason: 'no_token' };
    try {
      const res = await fetch(`${LICENSE_API_BASE}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!data.valid) {
        // Token rejected by server — likely revoked
        localStorage.removeItem(STORAGE_KEY);
        setState({ tier: 'free', packs: [], seats: 1, isLoading: false, isActivated: false, expiresAt: null, error: `License invalid: ${data.reason}` });
        return { valid: false, reason: data.reason };
      }
      // Token still valid; refresh the local state to mirror server's view
      setState({
        tier: data.tier as LicenseTier,
        packs: (data.packs ?? []) as ProfessionPack[],
        seats: data.seats ?? 1,
        isLoading: false,
        isActivated: true,
        expiresAt: data.expires_at ? new Date(data.expires_at) : null,
        error: null,
      });
      return { valid: true };
    } catch (err) {
      // Network error during validation — keep current state, don't lock the user out
      console.warn('License re-validation failed (network):', err);
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
    refresh(); // initial check
    const interval = setInterval(() => {
      refresh();
    }, 7 * 24 * 60 * 60 * 1000); // 1 week
    return () => clearInterval(interval);
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
 * gets the FULL app — editor, all providers, whiteboard, audio, research,
 * multi-model comparison, and commercial use. The only paid differentiators
 * are which profession PACK you get (see `hasPack`) and seat count, neither
 * of which is a per-feature flag. So every feature simply reduces to
 * `tier !== 'free'`. (Trial users have tier 'free' but get full access via
 * the separate `useTrial` gate, which is checked at the call site.)
 */
export function tierHasFeature(tier: LicenseTier, feature: 'multi-provider' | 'all-templates' | 'unlimited-workspaces' | 'whiteboard' | 'audio' | 'research-citations' | 'multi-model-comparison' | 'commercial-use'): boolean {
  switch (feature) {
    case 'multi-provider':
    case 'all-templates':
    case 'unlimited-workspaces':
    case 'whiteboard':
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
export function hasPack(state: { tier: LicenseTier; packs: ProfessionPack[] }, pack: ProfessionPack): boolean {
  return state.tier === 'practice' || state.packs.includes(pack);
}
