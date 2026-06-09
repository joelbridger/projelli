/**
 * firmEntitlement — turn a firm SEAT state into an {@link Entitlement}.
 *
 * The firm tier is a LICENSED STATE distinct from the legacy license-key path
 * in `entitlements.ts`: instead of a license JWT, the credential is an
 * Ed25519-signed seat token validated against the org's `seat_limit` server
 * side and verifiable offline. This module is the pure decision layer for that
 * path, mirroring the same guarantees:
 *
 *   - An ACTIVE seat (server said valid, OR offline but a valid, unexpired,
 *     offline-verified token within grace) grants FULL features at the seat's
 *     tier (a `practice`-plan org IS the Firm tier).
 *   - A REVOKED / invalid seat degrades features (AI + updates off) but, like
 *     everywhere else in Keepance, NEVER locks the user's own data.
 *   - `dataAccessAlwaysTrue` is `true` in every branch (typed as literal true).
 *
 * Solo/local mode never produces a firm seat, so it never reaches this module.
 */

import type { EntitledTier, Entitlement, EntitlementState } from '@/modules/licensing/entitlements';
import { OFFLINE_GRACE_DAYS } from '@/modules/licensing/entitlements';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The result of the most recent online seat check (or its absence). */
export interface FirmSeatState {
  /** Whether the user has activated a firm seat on this machine at all. */
  activated: boolean;
  /** The plan the seat carries (from the seat token / validate response). */
  tier: EntitledTier;
  /** Profession packs carried by the seat. */
  packs: string[];
  /** Org seat_limit (display only). */
  seats: number;
  /**
   * Server's last verdict, if we have one:
   *   - 'valid'   the seat validated successfully online.
   *   - 'revoked' the server rejected it (revoked / deprovisioned / suspended).
   *   - 'unknown' we have never reached the server (rely on offline check).
   */
  serverVerdict: 'valid' | 'revoked' | 'unknown';
  /** Result of the OFFLINE Ed25519 + expiry check of the stored seat token. */
  offlineValid: boolean;
  /** ISO/Date of the last successful online validate (last-known-good). */
  lastValidatedAt?: string | Date | null;
}

function toDate(v: string | Date | null | undefined): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fullAccess(
  tier: EntitledTier,
  state: EntitlementState,
  reason: string,
  packs: string[],
  seats: number,
): Entitlement {
  return {
    entitledTier: tier,
    aiEnabled: true,
    updatesEnabled: true,
    dataAccessAlwaysTrue: true,
    isGrandfathered: false,
    state,
    reason,
    packs,
    seats,
  };
}

function degraded(
  state: EntitlementState,
  reason: string,
  packs: string[],
  seats: number,
): Entitlement {
  return {
    entitledTier: 'free',
    aiEnabled: false,
    updatesEnabled: false,
    dataAccessAlwaysTrue: true,
    isGrandfathered: false,
    state,
    reason,
    packs,
    seats,
  };
}

/**
 * Decide the firm-seat entitlement. Pure; `now` injectable for tests.
 *
 * Precedence (first match wins), all keeping data accessible:
 *   1. Not activated                  -> unlicensed (no firm features).
 *   2. Server says valid              -> FULL at tier.
 *   3. Server says revoked            -> DEGRADE (AI/updates off), data intact.
 *   4. Server unknown (offline), seat token offline-verified + within grace
 *                                     -> FULL at tier (offline-grace).
 *   5. Offline beyond grace / no usable offline token -> DEGRADE, data intact.
 */
export function decideFirmEntitlement(
  seat: FirmSeatState,
  now: Date = new Date(),
): Entitlement {
  const packs = seat.packs;
  const seats = seat.seats;

  if (!seat.activated) {
    return degraded('unlicensed', 'firm-not-activated', packs, seats);
  }

  if (seat.serverVerdict === 'valid') {
    return fullAccess(seat.tier, 'subscription-active', 'firm-seat-active', packs, seats);
  }

  if (seat.serverVerdict === 'revoked') {
    return degraded('subscription-lapsed', 'firm-seat-revoked', packs, seats);
  }

  // serverVerdict === 'unknown' — offline. Lean on the offline-verified token
  // within the grace window so a flight / outage never bricks a paying firm.
  if (seat.offlineValid) {
    const lastGood = toDate(seat.lastValidatedAt);
    const withinGrace =
      lastGood != null && now.getTime() - lastGood.getTime() <= OFFLINE_GRACE_DAYS * MS_PER_DAY;
    if (withinGrace || lastGood == null) {
      // If we've never validated but hold a cryptographically valid, unexpired
      // seat token (e.g. activated then immediately offline), honor it: the
      // token's own 30-day `exp` is the bound, and the offline check enforced it.
      return fullAccess(seat.tier, 'offline-grace', 'firm-seat-offline-grace', packs, seats);
    }
    return degraded('subscription-lapsed', 'firm-seat-offline-grace-expired', packs, seats);
  }

  return degraded('subscription-lapsed', 'firm-seat-offline-unverified', packs, seats);
}
