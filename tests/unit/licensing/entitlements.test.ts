/**
 * Exhaustive tests for the entitlement decision layer — the single most
 * important safety gate before Lantern 3.0 ships.
 *
 * The non-negotiable invariant under test: DATA ACCESS IS ALWAYS TRUE. No
 * input combination may ever yield a state where the user cannot open, edit, or
 * EXPORT their own files. We assert that explicitly, and we also fuzz a large
 * cartesian product of inputs to prove there is no path that turns it off.
 *
 * We also test every required scenario from the launch-safety spec:
 *   - a pre-3.0 Personal / Lifetime buyer gets FULL grandfathered access after
 *     "upgrading" (NOT locked out)
 *   - an active subscription gets its tier
 *   - a LAPSED subscription keeps full data access + export but AI off
 *   - trial active -> full; trial expired -> degraded-but-data-accessible
 *   - license server unreachable -> last-known-good honored within grace
 *   - a brand-new user with no license -> trial
 */

import { describe, it, expect } from 'vitest';
import {
  decideEntitlement,
  isGrandfatheredLicense,
  normalizeStatus,
  toLicenseRecord,
  entitlementMessage,
  LANTERN_3_0_LAUNCH,
  OFFLINE_GRACE_DAYS,
  type LicenseRecord,
  type OfflineGraceState,
  type TrialContext,
  type Entitlement,
  type EntitledTier,
} from '@/platform/licensing/entitlements';

// A stable "now" well after the 3.0 launch for most cases.
const NOW = new Date('2026-09-01T12:00:00.000Z');
const ONLINE: OfflineGraceState = { isOffline: false, lastKnownGoodAt: null };
const NO_TRIAL: TrialContext = { isTrial: false, isExpired: false };

const day = (n: number) => n * 24 * 60 * 60 * 1000;

/** The guarantee, asserted on every result we ever build in this suite. */
function expectDataAlwaysAccessible(e: Entitlement) {
  expect(e.dataAccessAlwaysTrue).toBe(true);
}

describe('the data-ownership guarantee (DATA ACCESS IS ALWAYS TRUE)', () => {
  it('every documented branch returns dataAccessAlwaysTrue === true', () => {
    const records: LicenseRecord[] = [
      { tier: 'free' },
      { tier: 'personal', perpetual: true },
      { tier: 'practice', type: 'lifetime' },
      { tier: 'professional', type: 'subscription', status: 'active', expiresAt: new Date(NOW.getTime() + day(30)) },
      { tier: 'professional', type: 'subscription', status: 'expired', expiresAt: new Date(NOW.getTime() - day(1)) },
      { tier: 'personal', type: 'subscription', status: 'cancelled' },
      { tier: 'practice', type: 'subscription', status: 'revoked' },
    ];
    const offlines: OfflineGraceState[] = [
      ONLINE,
      { isOffline: true, lastKnownGoodAt: new Date(NOW.getTime() - day(5)) },
      { isOffline: true, lastKnownGoodAt: new Date(NOW.getTime() - day(120)) },
      { isOffline: true, lastKnownGoodAt: null },
    ];
    const trials: TrialContext[] = [
      NO_TRIAL,
      { isTrial: true, isExpired: false },
      { isTrial: true, isExpired: true },
      { isTrial: true, isExpired: false, grantsTier: 'professional' },
    ];

    for (const r of records) {
      for (const o of offlines) {
        for (const tr of trials) {
          const e = decideEntitlement(r, NOW, o, tr);
          expectDataAlwaysAccessible(e);
        }
      }
    }
  });

  it('FUZZ: no combination of inputs ever yields data inaccessible', () => {
    // A broad cartesian product over every meaningful field value. The point is
    // to prove the invariant holds across thousands of distinct shapes, not to
    // be exhaustive over every Date — so the date dimensions are kept small.
    const tiers: EntitledTier[] = ['free', 'personal', 'professional', 'practice'];
    const statuses = [undefined, 'active', 'expired', 'cancelled', 'canceled', 'lapsed', 'revoked', 'perpetual', 'org_suspended', 'past_due', 'garbage-reason', ''];
    const types = [undefined, 'subscription', 'trial', 'personal-onetime', 'professional-onetime', 'practice-onetime', 'lifetime', 'mystery'];
    const perpetuals = [undefined, true, false];
    const expiries = [null, new Date(NOW.getTime() - day(400)), new Date(NOW.getTime() + day(400))];
    const purchases = [null, new Date('2024-01-01T00:00:00Z'), new Date(NOW.getTime() + day(10))];
    const offlines: OfflineGraceState[] = [
      ONLINE,
      { isOffline: true, lastKnownGoodAt: null },
      { isOffline: true, lastKnownGoodAt: new Date(NOW.getTime() - day(10)) },
      { isOffline: true, lastKnownGoodAt: new Date(NOW.getTime() - day(200)) },
    ];
    const trials: TrialContext[] = [
      NO_TRIAL,
      { isTrial: true, isExpired: false },
      { isTrial: true, isExpired: true },
    ];

    let count = 0;
    let everInaccessible = false;
    const tiersSeen = new Set<string>();
    for (const tier of tiers) {
      for (const status of statuses) {
        for (const type of types) {
          for (const perpetual of perpetuals) {
            for (const expiresAt of expiries) {
              for (const purchasedAt of purchases) {
                for (const offline of offlines) {
                  for (const trial of trials) {
                    const e = decideEntitlement(
                      { tier, status, type, perpetual, expiresAt, purchasedAt },
                      NOW,
                      offline,
                      trial,
                    );
                    // The one thing that must NEVER be false. We accumulate
                    // rather than asserting per-iteration so a single huge loop
                    // stays fast (one assertion instead of hundreds of thousands).
                    if (e.dataAccessAlwaysTrue !== true) everInaccessible = true;
                    tiersSeen.add(e.entitledTier);
                    count++;
                  }
                }
              }
            }
          }
        }
      }
    }
    // Across the entire space, data is NEVER inaccessible.
    expect(everInaccessible).toBe(false);
    // Every entitledTier we ever produced is a valid value.
    for (const t of tiersSeen) {
      expect(['free', 'personal', 'professional', 'practice']).toContain(t);
    }
    // Sanity: we actually exercised a large space.
    expect(count).toBeGreaterThan(5000);
  }, 20000);
});

describe('grandfathering: pre-3.0 buyers are never bricked by 3.0', () => {
  it('an old one-time PERSONAL license -> full grandfathered access, indefinitely', () => {
    const e = decideEntitlement({ tier: 'personal', type: 'personal-onetime' }, NOW, ONLINE, NO_TRIAL);
    expect(e.isGrandfathered).toBe(true);
    expect(e.state).toBe('grandfathered');
    expect(e.entitledTier).toBe('personal');
    expect(e.aiEnabled).toBe(true);
    expect(e.updatesEnabled).toBe(true);
    expectDataAlwaysAccessible(e);
  });

  it('an old LIFETIME license -> full grandfathered access at its tier', () => {
    const e = decideEntitlement({ tier: 'practice', type: 'lifetime' }, NOW, ONLINE, NO_TRIAL);
    expect(e.isGrandfathered).toBe(true);
    expect(e.entitledTier).toBe('practice');
    expect(e.aiEnabled).toBe(true);
    expectDataAlwaysAccessible(e);
  });

  it('a perpetual flag alone grandfathers, even with no type and an expired date', () => {
    const e = decideEntitlement(
      { tier: 'professional', perpetual: true, expiresAt: new Date(NOW.getTime() - day(1000)) },
      NOW,
      ONLINE,
      NO_TRIAL,
    );
    expect(e.isGrandfathered).toBe(true);
    expect(e.aiEnabled).toBe(true);
    expect(e.updatesEnabled).toBe(true);
  });

  it('a purchase date before the 3.0 launch grandfathers (bought-before-3.0 detection)', () => {
    const e = decideEntitlement(
      { tier: 'professional', purchasedAt: new Date('2025-06-01T00:00:00Z') },
      NOW,
      ONLINE,
      NO_TRIAL,
    );
    expect(e.isGrandfathered).toBe(true);
    expect(e.entitledTier).toBe('professional');
    expect(e.aiEnabled).toBe(true);
  });

  it('a status of "perpetual" grandfathers', () => {
    const e = decideEntitlement({ tier: 'personal', status: 'perpetual' }, NOW, ONLINE, NO_TRIAL);
    expect(e.isGrandfathered).toBe(true);
    expect(e.aiEnabled).toBe(true);
  });

  it('grandfathered buyers are NOT locked out even when the server is unreachable', () => {
    const e = decideEntitlement(
      { tier: 'practice', perpetual: true },
      NOW,
      { isOffline: true, lastKnownGoodAt: null },
      NO_TRIAL,
    );
    expect(e.isGrandfathered).toBe(true);
    expect(e.aiEnabled).toBe(true);
    expectDataAlwaysAccessible(e);
  });

  it('a genuine 3.0 subscription is NOT treated as grandfathered', () => {
    expect(
      isGrandfatheredLicense({ tier: 'personal', type: 'subscription', purchasedAt: new Date('2024-01-01Z') }, NOW),
    ).toBe(false);
    // Even a 3.0 trial purchased "before" the cutoff is never grandfathered.
    expect(isGrandfatheredLicense({ tier: 'personal', type: 'trial' }, NOW)).toBe(false);
  });

  it('a free / unactivated record is never grandfathered', () => {
    expect(isGrandfatheredLicense({ tier: 'free', perpetual: true }, NOW)).toBe(false);
  });

  it('a future purchase date does NOT grandfather (guards against bogus dates)', () => {
    expect(
      isGrandfatheredLicense({ tier: 'personal', purchasedAt: new Date(NOW.getTime() + day(30)) }, NOW),
    ).toBe(false);
  });
});

describe('active subscription -> full tier features', () => {
  it('an active Solo subscription gets Solo features', () => {
    const e = decideEntitlement(
      { tier: 'personal', type: 'subscription', status: 'active', expiresAt: new Date(NOW.getTime() + day(200)) },
      NOW,
      ONLINE,
      NO_TRIAL,
    );
    expect(e.state).toBe('subscription-active');
    expect(e.entitledTier).toBe('personal');
    expect(e.aiEnabled).toBe(true);
    expect(e.updatesEnabled).toBe(true);
    expect(e.isGrandfathered).toBe(false);
  });

  it('an active Firm subscription gets Firm features and passes through seats/packs', () => {
    const e = decideEntitlement(
      { tier: 'practice', type: 'subscription', status: 'active', expiresAt: new Date(NOW.getTime() + day(200)), seats: 12, packs: ['legal', 'tax'] },
      NOW,
      ONLINE,
      NO_TRIAL,
    );
    expect(e.entitledTier).toBe('practice');
    expect(e.aiEnabled).toBe(true);
    expect(e.seats).toBe(12);
    expect(e.packs).toEqual(['legal', 'tax']);
  });

  it('a legacy payload with no status but a future expiry is treated as active', () => {
    const e = decideEntitlement(
      { tier: 'professional', expiresAt: new Date(NOW.getTime() + day(10)) },
      NOW,
      ONLINE,
      NO_TRIAL,
    );
    expect(e.aiEnabled).toBe(true);
    expect(e.entitledTier).toBe('professional');
  });
});

describe('lapsed subscription -> graceful degrade, NEVER a lockout', () => {
  it('an EXPIRED subscription keeps full data + export but turns AI off', () => {
    const e = decideEntitlement(
      { tier: 'professional', type: 'subscription', status: 'expired', expiresAt: new Date(NOW.getTime() - day(1)) },
      NOW,
      ONLINE,
      NO_TRIAL,
    );
    expect(e.state).toBe('subscription-lapsed');
    // THE assertions: data stays, AI off, updates off, no lockout.
    expect(e.dataAccessAlwaysTrue).toBe(true);
    expect(e.aiEnabled).toBe(false);
    expect(e.updatesEnabled).toBe(false);
    expect(e.entitledTier).toBe('free');
    expect(e.reason).toBe('subscription-expired');
  });

  it('a CANCELLED subscription degrades but keeps data', () => {
    const e = decideEntitlement({ tier: 'personal', type: 'subscription', status: 'cancelled' }, NOW, ONLINE, NO_TRIAL);
    expect(e.state).toBe('subscription-lapsed');
    expect(e.aiEnabled).toBe(false);
    expect(e.dataAccessAlwaysTrue).toBe(true);
    expect(e.reason).toBe('subscription-cancelled');
  });

  it('a REVOKED (refunded) subscription degrades but keeps data', () => {
    const e = decideEntitlement({ tier: 'practice', type: 'subscription', status: 'revoked' }, NOW, ONLINE, NO_TRIAL);
    expect(e.aiEnabled).toBe(false);
    expect(e.dataAccessAlwaysTrue).toBe(true);
    expect(e.reason).toBe('subscription-revoked');
  });

  it('expiry-by-date alone (status active but past expires_at) degrades', () => {
    const e = decideEntitlement(
      { tier: 'personal', type: 'subscription', status: 'active', expiresAt: new Date(NOW.getTime() - day(2)) },
      NOW,
      ONLINE,
      NO_TRIAL,
    );
    expect(e.aiEnabled).toBe(false);
    expect(e.dataAccessAlwaysTrue).toBe(true);
  });

  it('an unknown garbage status degrades safely (AI off, data on)', () => {
    const e = decideEntitlement({ tier: 'personal', type: 'subscription', status: 'who-knows' }, NOW, ONLINE, NO_TRIAL);
    expect(e.aiEnabled).toBe(false);
    expect(e.dataAccessAlwaysTrue).toBe(true);
  });
});

describe('trial', () => {
  it('a brand-new user with NO license -> trial active -> full Solo features', () => {
    const e = decideEntitlement({ tier: 'free' }, NOW, ONLINE, { isTrial: true, isExpired: false });
    expect(e.state).toBe('trial-active');
    expect(e.entitledTier).toBe('personal');
    expect(e.aiEnabled).toBe(true);
    expect(e.updatesEnabled).toBe(true);
    expect(e.dataAccessAlwaysTrue).toBe(true);
  });

  it('a trial can be configured to grant Professional', () => {
    const e = decideEntitlement({ tier: 'free' }, NOW, ONLINE, { isTrial: true, isExpired: false, grantsTier: 'professional' });
    expect(e.entitledTier).toBe('professional');
    expect(e.aiEnabled).toBe(true);
  });

  it('an EXPIRED trial degrades but keeps data fully accessible', () => {
    const e = decideEntitlement({ tier: 'free' }, NOW, ONLINE, { isTrial: true, isExpired: true });
    expect(e.state).toBe('trial-expired');
    expect(e.aiEnabled).toBe(false);
    expect(e.updatesEnabled).toBe(false);
    expect(e.dataAccessAlwaysTrue).toBe(true);
    expect(e.entitledTier).toBe('free');
  });

  it('a brand-new user with no license and no trial context -> unlicensed, data still on', () => {
    const e = decideEntitlement({ tier: 'free' }, NOW, ONLINE, NO_TRIAL);
    expect(e.state).toBe('unlicensed');
    expect(e.aiEnabled).toBe(false);
    expect(e.dataAccessAlwaysTrue).toBe(true);
  });
});

describe('offline grace: a network failure never bricks a paying user', () => {
  it('server unreachable + last-known-good WITHIN grace -> honor full access', () => {
    const e = decideEntitlement(
      { tier: 'professional', type: 'subscription', status: 'active', expiresAt: new Date(NOW.getTime() + day(100)) },
      NOW,
      { isOffline: true, lastKnownGoodAt: new Date(NOW.getTime() - day(5)) },
      NO_TRIAL,
    );
    // Online it would be active; offline within grace it must STILL be full.
    expect(e.aiEnabled).toBe(true);
    expect(e.updatesEnabled).toBe(true);
    expect(e.entitledTier).toBe('professional');
    expectDataAlwaysAccessible(e);
  });

  it('offline honors last-known-good even when the JWT expiry has just passed', () => {
    // Classic case: subscription is fine on the server, but the short-lived
    // offline token expired and we cannot reach the server to refresh it.
    const e = decideEntitlement(
      { tier: 'personal', type: 'subscription', status: 'active', expiresAt: new Date(NOW.getTime() - day(1)) },
      NOW,
      { isOffline: true, lastKnownGoodAt: new Date(NOW.getTime() - day(3)) },
      NO_TRIAL,
    );
    expect(e.state).toBe('offline-grace');
    expect(e.aiEnabled).toBe(true);
    expectDataAlwaysAccessible(e);
  });

  it('offline + locally-lapsed + last-known-good OUTSIDE grace -> degrade (data-accessible, never locked)', () => {
    // The locally-known state must itself be not-good (expired by date) to reach
    // the offline branch; an active-and-unexpired subscription stays full
    // regardless of connectivity, which is correct and safe.
    const e = decideEntitlement(
      { tier: 'professional', type: 'subscription', status: 'expired', expiresAt: new Date(NOW.getTime() - day(1)) },
      NOW,
      { isOffline: true, lastKnownGoodAt: new Date(NOW.getTime() - day(OFFLINE_GRACE_DAYS + 5)) },
      NO_TRIAL,
    );
    expect(e.aiEnabled).toBe(false);
    expect(e.dataAccessAlwaysTrue).toBe(true);
  });

  it('offline + locally-lapsed + NO last-known-good ever -> degrade gracefully, data still on', () => {
    const e = decideEntitlement(
      { tier: 'personal', type: 'subscription', status: 'expired', expiresAt: new Date(NOW.getTime() - day(1)) },
      NOW,
      { isOffline: true, lastKnownGoodAt: null },
      NO_TRIAL,
    );
    expect(e.aiEnabled).toBe(false);
    expect(e.dataAccessAlwaysTrue).toBe(true);
    expect(e.reason).toBe('offline-no-last-known-good');
  });

  it('exactly at the grace boundary is still honored', () => {
    const e = decideEntitlement(
      { tier: 'personal', type: 'subscription', status: 'active', expiresAt: new Date(NOW.getTime() - day(1)) },
      NOW,
      { isOffline: true, lastKnownGoodAt: new Date(NOW.getTime() - day(OFFLINE_GRACE_DAYS)) },
      NO_TRIAL,
    );
    expect(e.aiEnabled).toBe(true);
  });

  it('grandfathered users do not even need last-known-good while offline', () => {
    const e = decideEntitlement(
      { tier: 'practice', type: 'lifetime' },
      NOW,
      { isOffline: true, lastKnownGoodAt: null },
      NO_TRIAL,
    );
    expect(e.isGrandfathered).toBe(true);
    expect(e.aiEnabled).toBe(true);
  });
});

describe('precedence ordering', () => {
  it('grandfathering beats a lapsed status (a perpetual license never lapses)', () => {
    const e = decideEntitlement(
      { tier: 'professional', perpetual: true, status: 'expired', expiresAt: new Date(NOW.getTime() - day(10)) },
      NOW,
      ONLINE,
      NO_TRIAL,
    );
    expect(e.isGrandfathered).toBe(true);
    expect(e.aiEnabled).toBe(true);
  });

  it('an active paid subscription is unaffected by trial-expired context', () => {
    const e = decideEntitlement(
      { tier: 'personal', type: 'subscription', status: 'active', expiresAt: new Date(NOW.getTime() + day(30)) },
      NOW,
      ONLINE,
      { isTrial: true, isExpired: true },
    );
    expect(e.aiEnabled).toBe(true);
    expect(e.state).toBe('subscription-active');
  });
});

describe('normalizeStatus', () => {
  it('maps active/valid -> active', () => {
    expect(normalizeStatus('active')).toBe('active');
    expect(normalizeStatus('valid')).toBe('active');
    expect(normalizeStatus('ACTIVE')).toBe('active');
  });
  it('maps the lapsed family', () => {
    expect(normalizeStatus('expired')).toBe('expired');
    expect(normalizeStatus('cancelled')).toBe('cancelled');
    expect(normalizeStatus('canceled')).toBe('cancelled');
    expect(normalizeStatus('revoked')).toBe('revoked');
    expect(normalizeStatus('org_suspended')).toBe('lapsed');
    expect(normalizeStatus('past_due')).toBe('lapsed');
  });
  it('maps perpetual and none', () => {
    expect(normalizeStatus('perpetual')).toBe('perpetual');
    expect(normalizeStatus('none')).toBe('none');
  });
  it('treats unknown non-empty reasons as lapsed (conservative, never locks data)', () => {
    expect(normalizeStatus('weird-new-reason')).toBe('lapsed');
  });
  it('returns undefined for empty/nullish', () => {
    expect(normalizeStatus('')).toBeUndefined();
    expect(normalizeStatus(undefined)).toBeUndefined();
    expect(normalizeStatus(null)).toBeUndefined();
  });
});

describe('toLicenseRecord adapter', () => {
  it('maps the useLicense state shape into a LicenseRecord with safe defaults', () => {
    const r = toLicenseRecord({ tier: 'personal' });
    expect(r.tier).toBe('personal');
    expect(r.seats).toBe(1);
    expect(r.packs).toEqual([]);
    expect(r.expiresAt).toBeNull();
  });

  it('passes through the grandfather signals', () => {
    const purchased = new Date('2025-01-01Z');
    const r = toLicenseRecord({ tier: 'practice', perpetual: true, purchasedAt: purchased, type: 'lifetime', status: 'perpetual' });
    expect(r.perpetual).toBe(true);
    expect(r.purchasedAt).toBe(purchased);
    expect(r.type).toBe('lifetime');
    expect(r.status).toBe('perpetual');
  });
});

describe('entitlementMessage copy', () => {
  it('lapsed message reassures that nothing is held hostage and mentions export', () => {
    const e = decideEntitlement({ tier: 'personal', type: 'subscription', status: 'expired', expiresAt: new Date(NOW.getTime() - day(1)) }, NOW, ONLINE, NO_TRIAL);
    const msg = entitlementMessage(e);
    expect(msg.body.toLowerCase()).toContain('export');
    expect(msg.body.toLowerCase()).toContain('held hostage');
  });

  it('grandfathered message promises no clawback', () => {
    const e = decideEntitlement({ tier: 'practice', type: 'lifetime' }, NOW, ONLINE, NO_TRIAL);
    const msg = entitlementMessage(e);
    expect(msg.body.toLowerCase()).toContain('claw');
  });

  it('no user-facing message contains an em dash (house style)', () => {
    const states: Entitlement[] = [
      decideEntitlement({ tier: 'personal', type: 'subscription', status: 'active', expiresAt: new Date(NOW.getTime() + day(30)) }, NOW, ONLINE, NO_TRIAL),
      decideEntitlement({ tier: 'practice', type: 'lifetime' }, NOW, ONLINE, NO_TRIAL),
      decideEntitlement({ tier: 'personal', type: 'subscription', status: 'expired', expiresAt: new Date(NOW.getTime() - day(1)) }, NOW, ONLINE, NO_TRIAL),
      decideEntitlement({ tier: 'free' }, NOW, ONLINE, { isTrial: true, isExpired: false }),
      decideEntitlement({ tier: 'free' }, NOW, ONLINE, { isTrial: true, isExpired: true }),
      decideEntitlement({ tier: 'free' }, NOW, ONLINE, NO_TRIAL),
      decideEntitlement({ tier: 'personal', type: 'subscription', status: 'active' }, NOW, { isOffline: true, lastKnownGoodAt: new Date(NOW.getTime() - day(2)) }, NO_TRIAL),
    ];
    for (const e of states) {
      const msg = entitlementMessage(e);
      expect(msg.headline).not.toContain('—');
      expect(msg.body).not.toContain('—');
    }
  });
});

describe('the 3.0 launch cutoff constant', () => {
  it('is a real date and licenses purchased before it are old-model', () => {
    expect(LANTERN_3_0_LAUNCH instanceof Date).toBe(true);
    expect(Number.isNaN(LANTERN_3_0_LAUNCH.getTime())).toBe(false);
    const before = new Date(LANTERN_3_0_LAUNCH.getTime() - day(1));
    expect(isGrandfatheredLicense({ tier: 'personal', purchasedAt: before }, new Date(LANTERN_3_0_LAUNCH.getTime() + day(1)))).toBe(true);
  });
});
