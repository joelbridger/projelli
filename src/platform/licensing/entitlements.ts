/**
 * entitlements.ts — the ONE pure, well-tested decision layer that turns a
 * license record into what the app should actually let the user do.
 *
 * Why this exists
 * ───────────────
 * Lantern 3.0 moves to a per-seat ANNUAL subscription (Solo / Professional /
 * Firm). But existing customers bought under the OLD one-time model (one-time
 * Personal, one-time Lifetime/Practice, and some annual Professional). When
 * those users auto-update to 3.0 they must NOT be locked out, and a lapsed
 * subscription must NEVER hold a lawyer's own files hostage. The product makes a
 * hard promise — "your files are always yours" — and this module is where that
 * promise is mechanically guaranteed.
 *
 * The contract this module enforces, in one breath:
 *   - DATA ACCESS IS ALWAYS TRUE. Every branch returns
 *     `dataAccessAlwaysTrue: true`. Opening, reading, editing, and EXPORTING the
 *     user's own documents, email, and matters is never gated — not by a lapsed
 *     subscription, not by an expired trial, not by an offline license server,
 *     not by anything. There is intentionally no code path that turns it off.
 *   - Grandfathered buyers keep, in good faith, full access to what they paid
 *     for, indefinitely. They are never downgraded or locked out by 3.0.
 *   - Active subscription -> full tier features. Lapsed/expired/cancelled ->
 *     graceful degrade (AI + updates off, data fully accessible), never lockout.
 *   - Trial active -> full features. Trial expired -> degrades like a lapsed
 *     subscription (data stays fully accessible).
 *   - License server unreachable -> honor last-known-good within a generous
 *     grace window. A network failure must never brick a paying user.
 *
 * This file is deliberately pure (no React, no I/O, no `Date.now()` reads except
 * via the `now` argument). `useLicense` and `useTrial` feed it real state; the
 * tests feed it every combination. Keep it that way — the safety guarantee is
 * only as trustworthy as it is testable.
 *
 * Wire compatibility: the license-validator returns `tier` + `expires_at` +
 * a validity/`status` signal (see `backend/src/contract.ts`). The optional
 * `type` / `perpetual` / `purchasedAt` fields below are how we detect a
 * pre-3.0 buyer robustly; any one of them is sufficient, and their ABSENCE is
 * handled conservatively (we never accidentally strip a grandfathered user).
 */

import type { LicenseTier } from '@/platform/hooks/useLicense';
import { brandText } from '@/config/brandText';
import { BRAND } from '@/config/brand';

/**
 * The stable paid tier codes (same wire codes as the license JWT). `free` means
 * unactivated / trial / post-trial — it carries no purchased entitlement.
 */
export type EntitledTier = LicenseTier;

/**
 * Subscription / license status as understood by the entitlement layer.
 *
 * The validator's `/validate` reason strings ("expired", "revoked",
 * "org_suspended", ...) and a future explicit `status` field both normalize
 * into this small set via {@link normalizeStatus}.
 */
export type LicenseStatus =
  /** A paid subscription that is current and in good standing. */
  | 'active'
  /** A subscription whose paid period has ended (not renewed). */
  | 'expired'
  /** Explicitly cancelled by the user (still owns their data). */
  | 'cancelled'
  /** Lapsed for any other reason (e.g. failed renewal, dunning exhausted). */
  | 'lapsed'
  /** A perpetual one-time license — never expires (old Personal / Lifetime). */
  | 'perpetual'
  /** Refunded / revoked by the server. Data still accessible; features off. */
  | 'revoked'
  /** No license at all (brand-new user before/after trial). */
  | 'none';

/**
 * The kind of license the user holds. These map onto the OLD one-time product
 * codes and the NEW subscription codes. The string union is intentionally open
 * to the historical names so a license minted years ago still classifies.
 *
 * Old one-time products (pre-3.0) — all grandfathered to full access:
 *   - 'personal-onetime'  / 'personal'      ($49 one-time Personal)
 *   - 'lifetime'          / 'practice-onetime' / 'practice'  (one-time Lifetime / Practice)
 *   - 'professional-onetime' / 'professional'  (one-time Professional)
 * New 3.0 products:
 *   - 'subscription'      (per-seat annual/monthly Solo/Professional/Firm)
 *   - 'trial'             (30-day no-card)
 */
/** The license-type values we explicitly recognize. */
export type KnownLicenseType =
  | 'personal-onetime'
  | 'professional-onetime'
  | 'practice-onetime'
  | 'lifetime'
  | 'subscription'
  | 'trial';
/**
 * A known license type OR any other string (legacy / future codes). The
 * `(string & {})` keeps editor autocomplete for the known values while still
 * accepting arbitrary strings without collapsing the whole union to `string`.
 */
export type LicenseType = KnownLicenseType | (string & {});

/**
 * The license record the entitlement decision is computed from. This is the
 * superset of what the validator returns today plus the fields we need to
 * detect a pre-3.0 buyer. Every field except `tier` is optional so the function
 * is robust to partial / legacy payloads.
 */
export interface LicenseRecord {
  /** Wire/license code. `free` => no purchased entitlement. */
  tier: EntitledTier;
  /** Subscription/license status. Raw validator reasons are also accepted. */
  status?: LicenseStatus | (string & {}) | undefined;
  /** What kind of license this is (old one-time vs 3.0 subscription/trial). */
  type?: LicenseType | undefined;
  /** ISO string or Date. For subscriptions: when the paid period ends. */
  expiresAt?: string | Date | null | undefined;
  /** ISO string or Date of original purchase. Used for the 3.0 cutoff check. */
  purchasedAt?: string | Date | null | undefined;
  /**
   * Explicit perpetual flag. When true, this is a one-time/lifetime license
   * that NEVER expires — the strongest grandfather signal.
   */
  perpetual?: boolean | undefined;
  /** Profession packs carried on the license (passed through unchanged). */
  packs?: string[] | undefined;
  /** Seats on the license (passed through unchanged). */
  seats?: number | undefined;
}

/** Whether the license server could be reached and, if not, the last-good time. */
export interface OfflineGraceState {
  /** True when the most recent attempt to reach the validator failed. */
  isOffline: boolean;
  /**
   * ISO string or Date of the last time the server CONFIRMED this license as
   * valid (last-known-good). Used to decide whether we are still inside the
   * offline grace window. If absent, we still never lock data — we just can't
   * extend AI/updates indefinitely on a license we've never confirmed.
   */
  lastKnownGoodAt?: string | Date | null;
}

/**
 * A coarse, user-facing classification of the resulting entitlement. Drives
 * which message/CTA the UI shows. Never used to gate data access.
 */
export type EntitlementState =
  /** Active paid subscription in good standing. */
  | 'subscription-active'
  /** Pre-3.0 one-time/lifetime/annual buyer, full access, indefinitely. */
  | 'grandfathered'
  /** Subscription lapsed/expired/cancelled — degraded, data intact. */
  | 'subscription-lapsed'
  /** 30-day trial in progress — full features. */
  | 'trial-active'
  /** Trial ended — degraded, data intact. */
  | 'trial-expired'
  /** Server unreachable; honoring last-known-good within grace. */
  | 'offline-grace'
  /** No license, no active trial — degraded, data intact. */
  | 'unlicensed';

/**
 * The decision. `dataAccessAlwaysTrue` is `true` in EVERY branch — it is typed
 * as the literal `true` so a branch that tried to return `false` would not
 * compile.
 */
export interface Entitlement {
  /** The tier whose FEATURES are unlocked right now. `free` => no paid features. */
  entitledTier: EntitledTier;
  /** Whether AI features (redline, cited recall, the associate) are enabled. */
  aiEnabled: boolean;
  /** Whether app updates are enabled. */
  updatesEnabled: boolean;
  /**
   * THE GUARANTEE. Always true. Opening, reading, editing, and EXPORTING the
   * user's own documents, email, and matters is never gated by licensing.
   */
  dataAccessAlwaysTrue: true;
  /** True when this is a grandfathered pre-3.0 buyer. */
  isGrandfathered: boolean;
  /** Coarse classification for choosing the right UI message/CTA. */
  state: EntitlementState;
  /** A short, non-alarming machine reason for the decision (also drives copy). */
  reason: string;
  /**
   * The packs carried by the entitlement (passed through). Practice/Firm and
   * grandfathered Practice/Lifetime imply all packs; that resolution lives in
   * the existing `hasPack` helper, not here.
   */
  packs: string[];
  /** Seats carried by the entitlement (passed through; defaults to 1). */
  seats: number;
}

/**
 * The Lantern 3.0 boundary. Any license whose purchase predates this instant
 * was bought under the old one-time model and is grandfathered. Set to the 3.0
 * launch date. Anything purchased AT or AFTER this is a 3.0 subscription/trial.
 *
 * NOTE: this is a conservative cutoff used only as ONE of several grandfather
 * signals. A perpetual flag or an old one-time `type` grandfathers regardless
 * of date, so a missing/empty `purchasedAt` never accidentally strips anyone.
 */
export const LANTERN_3_0_LAUNCH = new Date('2026-07-01T00:00:00.000Z');

/**
 * How long we honor a last-known-good entitlement when the license server is
 * unreachable. The app is local-first and must keep working offline; a network
 * blip (or a long flight, or a server outage on our side) must never brick a
 * paying user. 60 days is deliberately generous.
 */
export const OFFLINE_GRACE_DAYS = 60;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The old one-time product `type` values that always grandfather to full access. */
const ONETIME_TYPES: ReadonlySet<string> = new Set([
  'personal-onetime',
  'professional-onetime',
  'practice-onetime',
  'lifetime',
]);

/** Statuses that mean "paid period is over" — degrade, do NOT lock data. */
const LAPSED_STATUSES: ReadonlySet<string> = new Set([
  'expired',
  'cancelled',
  'canceled', // tolerate the US spelling from any upstream
  'lapsed',
  'revoked',
  'org_suspended',
  'user_deprovisioned',
  'past_due',
  'unpaid',
]);

/** Coerce an ISO string | Date | null/undefined into a Date or null. */
function toDate(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Normalize a raw status / validator-reason string into a {@link LicenseStatus}.
 * Unknown non-empty strings are treated as `lapsed` (conservative: features
 * off, data still on). Empty/undefined is left to the caller's context.
 */
export function normalizeStatus(raw: string | undefined | null): LicenseStatus | undefined {
  if (raw == null || raw === '') return undefined;
  const s = raw.toLowerCase();
  if (s === 'active' || s === 'valid') return 'active';
  if (s === 'perpetual') return 'perpetual';
  if (s === 'none') return 'none';
  if (s === 'expired') return 'expired';
  if (s === 'cancelled' || s === 'canceled') return 'cancelled';
  if (s === 'revoked') return 'revoked';
  if (LAPSED_STATUSES.has(s)) return 'lapsed';
  // Any other non-empty reason: be safe, degrade (never lock data).
  return 'lapsed';
}

/**
 * Robust detection of a pre-3.0 buyer who must be grandfathered to full access.
 *
 * Grandfathered when ANY of these hold (any one is sufficient):
 *   1. `perpetual === true`              — explicit lifetime/one-time flag.
 *   2. `status` normalizes to 'perpetual'.
 *   3. `type` is one of the old one-time product codes.
 *   4. The license was PURCHASED before the 3.0 launch (`purchasedAt < cutoff`)
 *      AND it is not itself a 3.0 subscription/trial.
 *
 * A `free`/unactivated record is never "grandfathered" (there's nothing paid to
 * grandfather). A 3.0 `subscription` or `trial` type is never grandfathered.
 */
export function isGrandfatheredLicense(
  license: LicenseRecord,
  now: Date = new Date(),
): boolean {
  if (license.tier === 'free') return false;
  // A genuine 3.0 subscription or trial is the new model, never grandfathered.
  if (license.type === 'subscription' || license.type === 'trial') return false;

  if (license.perpetual === true) return true;
  if (normalizeStatus(license.status) === 'perpetual') return true;
  if (license.type && ONETIME_TYPES.has(license.type)) return true;

  // Purchase-date signal: bought strictly before the 3.0 boundary. We compare
  // against `now` only to avoid treating a clearly-bogus future date as old.
  const purchased = toDate(license.purchasedAt);
  if (purchased && purchased.getTime() < LANTERN_3_0_LAUNCH.getTime() && purchased.getTime() <= now.getTime()) {
    return true;
  }
  return false;
}

/** A fully-degraded-but-data-safe entitlement (AI off, updates off, data on). */
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

/** A full-access entitlement at a given tier (AI on, updates on, data on). */
function fullAccess(
  tier: EntitledTier,
  state: EntitlementState,
  reason: string,
  packs: string[],
  seats: number,
  isGrandfathered: boolean,
): Entitlement {
  return {
    entitledTier: tier,
    aiEnabled: true,
    updatesEnabled: true,
    dataAccessAlwaysTrue: true,
    isGrandfathered,
    state,
    reason,
    packs,
    seats,
  };
}

/**
 * Context for the trial branch. The 30-day no-card trial is tracked separately
 * (see `useTrial`), so the entitlement layer is told whether a trial exists and
 * whether it has expired rather than recomputing it.
 */
export interface TrialContext {
  /** True when the user is (or was) in the 30-day trial. */
  isTrial: boolean;
  /** True once the trial period has elapsed. */
  isExpired: boolean;
  /** Which tier the trial grants while active. Defaults to Solo ('personal'). */
  grantsTier?: EntitledTier;
}

/**
 * THE decision function. Pure. Given a license record, the current time, the
 * offline-grace state, and the trial context, return exactly what the user is
 * entitled to.
 *
 * Order of precedence (first match wins), all of which keep data accessible:
 *   1. Grandfathered pre-3.0 buyer            -> FULL access, indefinitely.
 *   2. Active subscription (in good standing) -> FULL access at its tier.
 *   3. License server unreachable + last-known-good within grace
 *                                             -> honor last-good (FULL), offline.
 *   4. Lapsed / expired / cancelled / revoked subscription
 *                                             -> DEGRADE (AI+updates off), data on.
 *   5. No paid license, trial active          -> FULL access at the trial tier.
 *   6. No paid license, trial expired         -> DEGRADE, data on.
 *   7. Nothing at all                         -> DEGRADE/unlicensed, data on.
 *
 * INVARIANT: every return value has `dataAccessAlwaysTrue: true`.
 */
export function decideEntitlement(
  license: LicenseRecord,
  now: Date,
  offline: OfflineGraceState,
  trial: TrialContext = { isTrial: false, isExpired: false },
): Entitlement {
  const packs = license.packs ?? [];
  const seats = license.seats ?? 1;
  const hasPaidLicense = license.tier !== 'free';

  // 1. Grandfathered pre-3.0 buyer — full access to what they paid for, forever.
  if (hasPaidLicense && isGrandfatheredLicense(license, now)) {
    return fullAccess(
      license.tier,
      'grandfathered',
      'grandfathered-pre-3.0-purchase',
      packs,
      seats,
      true,
    );
  }

  if (hasPaidLicense) {
    const status = normalizeStatus(license.status);
    const expiresAt = toDate(license.expiresAt);
    const isExpiredByDate = expiresAt != null && expiresAt.getTime() <= now.getTime();
    // A subscription is "good" when the server says active (or says nothing,
    // i.e. legacy payload) AND its expiry, if present, is still in the future.
    const statusIsLapsed = status != null && status !== 'active' && status !== 'perpetual';
    const subscriptionGood = !statusIsLapsed && !isExpiredByDate;

    // 2. Active subscription in good standing -> full features at its tier.
    if (subscriptionGood) {
      return fullAccess(
        license.tier,
        'subscription-active',
        'subscription-active',
        packs,
        seats,
        false,
      );
    }

    // 3. Server unreachable: honor last-known-good within the grace window.
    //    A network failure must never brick a paying user. We only extend a
    //    license we have previously confirmed good (lastKnownGoodAt present and
    //    inside the window). Data is accessible regardless; this is purely
    //    about keeping AI + updates ON during an outage.
    if (offline.isOffline) {
      const lastGood = toDate(offline.lastKnownGoodAt);
      const withinGrace =
        lastGood != null &&
        now.getTime() - lastGood.getTime() <= OFFLINE_GRACE_DAYS * MS_PER_DAY;
      if (withinGrace) {
        return fullAccess(
          license.tier,
          'offline-grace',
          'offline-last-known-good',
          packs,
          seats,
          false,
        );
      }
      // Offline but no usable last-known-good (never confirmed, or grace blown):
      // we still NEVER lock data — degrade gracefully and let the next online
      // validation restore full access.
      return degraded('subscription-lapsed', 'offline-no-last-known-good', packs, seats);
    }

    // 4. Lapsed / expired / cancelled / revoked subscription:
    //    graceful degrade. Data, email, matters, and EXPORT stay fully usable;
    //    only AI features and updates turn off, with an easy resubscribe path.
    const reason = status === 'revoked'
      ? 'subscription-revoked'
      : status === 'cancelled'
        ? 'subscription-cancelled'
        : 'subscription-expired';
    return degraded('subscription-lapsed', reason, packs, seats);
  }

  // No paid license below this point. Trial governs full access.

  // 5. Trial active -> full features at the trial's tier (Solo by default).
  if (trial.isTrial && !trial.isExpired) {
    return fullAccess(
      trial.grantsTier ?? 'personal',
      'trial-active',
      'trial-active',
      packs,
      seats,
      false,
    );
  }

  // 6. Trial expired -> degrade exactly like a lapsed subscription. Data stays.
  if (trial.isTrial && trial.isExpired) {
    return degraded('trial-expired', 'trial-expired', packs, seats);
  }

  // 7. No license, no trial context -> unlicensed, but data is still fully
  //    accessible (the data-ownership guarantee has no exceptions).
  return degraded('unlicensed', 'no-license', packs, seats);
}

/**
 * Build a {@link LicenseRecord} from the shape `useLicense` already holds. Keeps
 * the hook -> entitlement boundary in one place. `tier` 'free' with
 * `isActivated:false` means "no paid license" (trial governs).
 */
export function toLicenseRecord(state: {
  tier: EntitledTier;
  packs?: string[];
  seats?: number;
  expiresAt?: Date | null;
  status?: string | null;
  type?: string | null;
  purchasedAt?: Date | null;
  perpetual?: boolean | null;
}): LicenseRecord {
  return {
    tier: state.tier,
    packs: state.packs ?? [],
    seats: state.seats ?? 1,
    expiresAt: state.expiresAt ?? null,
    status: state.status ?? undefined,
    type: state.type ?? undefined,
    purchasedAt: state.purchasedAt ?? null,
    perpetual: state.perpetual ?? undefined,
  };
}

/**
 * Short, non-alarming, user-facing message for a degraded/active state. The
 * tone is deliberately calm and reassuring: nothing is held hostage, ever.
 * No em dashes (house style).
 */
export function entitlementMessage(e: Entitlement): { headline: string; body: string } {
  switch (e.state) {
    case 'subscription-active':
      return {
        headline: 'Your subscription is active.',
        body: 'All features are on. Your files always stay yours.',
      };
    case 'grandfathered':
      return {
        headline: 'You keep everything you paid for.',
        body: brandText(`Your original license stays fully active. ${BRAND.name} 3.0 never claws back what you already own.`),
      };
    case 'offline-grace':
      return {
        headline: 'Working offline.',
        body: 'We could not reach the license server, so we are using your last confirmed status. Everything keeps working. Your files are always available.',
      };
    case 'subscription-lapsed':
      return {
        headline: 'Your subscription has lapsed.',
        body: 'You can still open, edit, and export every document, email, and client you have. The AI features and updates are paused until you resubscribe. Nothing is ever held hostage.',
      };
    case 'trial-active':
      return {
        headline: 'Your free trial is active.',
        body: 'All features are on for the length of your trial. Your files always stay yours.',
      };
    case 'trial-expired':
      return {
        headline: 'Your free trial has ended.',
        body: 'You can still open, edit, and export everything you made. The AI features pause until you subscribe. Your files stay readable either way.',
      };
    case 'unlicensed':
    default:
      return {
        headline: 'No active license.',
        body: 'You can still open, edit, and export your files. Start a trial or subscribe to turn on the AI features. Your files are always yours.',
      };
  }
}
