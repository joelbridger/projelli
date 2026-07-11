/**
 * useEntitlement — the single React hook the app uses to ask "what may this
 * user do right now?". It composes the license state (`useLicense`) and the
 * trial state (`useTrial`) and runs them through the PURE `decideEntitlement`
 * decision in `@/platform/licensing`.
 *
 * Why a thin wrapper: all the real logic lives in the pure, exhaustively-tested
 * `decideEntitlement` function. This hook just gathers reactive inputs and
 * keeps the React boundary tiny. Any surface that gates a feature (AI send,
 * redline, cited recall, the associate, updates) should read from here.
 *
 * THE GUARANTEE: the returned entitlement always has
 * `dataAccessAlwaysTrue: true`. Opening, reading, editing, and EXPORTING the
 * user's own documents, email, and matters is never gated by licensing. Lapsed
 * subscriptions, expired trials, and an unreachable license server only ever
 * turn off AI features and updates — never data.
 */

import { useMemo } from 'react';
import { useLicense } from './useLicense';
import { useTrial } from './useTrial';
import {
  decideEntitlement,
  normalizeStatus,
  toLicenseRecord,
  type Entitlement,
  type TrialContext,
} from '@/platform/licensing';

/**
 * Build the entitlement layer's offline input without ever letting an explicit
 * server revocation masquerade as a temporary lack of network access.
 */
export function licenseOfflineGraceState(
  isOffline: boolean,
  lastKnownGoodAt: Date | null,
  status?: string
) {
  return {
    isOffline: isOffline && normalizeStatus(status) !== 'revoked',
    lastKnownGoodAt,
  };
}

/**
 * Reactive entitlement for the current user. Recomputed whenever the license
 * or trial state changes.
 *
 * The trial grants Solo ('personal') features while active; that matches the
 * pricing copy ("Try it free for 30 days"). If you ever want trials to grant
 * Professional, change `grantsTier` here (and the pure function picks it up).
 */
export function useEntitlement(): Entitlement {
  const license = useLicense();
  const trial = useTrial();

  return useMemo(() => {
    const record = toLicenseRecord({
      tier: license.tier,
      packs: license.packs,
      seats: license.seats,
      expiresAt: license.expiresAt,
      status: license.status ?? null,
      type: license.type ?? null,
      purchasedAt: license.purchasedAt,
      perpetual: license.perpetual ?? null,
    });

    const trialContext: TrialContext = {
      // A trial only governs when there is NO paid license. `useLicense`'s
      // `isActivated` reflects "has a license token", paid or lapsed; the pure
      // function treats `tier:'free'` as "no paid license" and lets the trial
      // decide, which is exactly what we want for a brand-new user.
      isTrial: !license.isActivated,
      isExpired: trial.isExpired,
      grantsTier: 'personal',
    };

    return decideEntitlement(
      record,
      new Date(),
      licenseOfflineGraceState(
        license.isOffline,
        license.lastKnownGoodAt,
        license.status
      ),
      trialContext
    );
  }, [
    license.tier,
    license.packs,
    license.seats,
    license.expiresAt,
    license.status,
    license.type,
    license.purchasedAt,
    license.perpetual,
    license.isActivated,
    license.isOffline,
    license.lastKnownGoodAt,
    trial.isExpired,
  ]);
}
