import { describe, expect, it } from 'vitest';
import { decideEntitlement } from './entitlements';
import { decideFirmEntitlement } from '@/platform/firm/firmEntitlement';
import { licenseOfflineGraceState } from '@/platform/hooks/useEntitlement';

const NOW = new Date('2026-07-11T12:00:00.000Z');
const LAST_GOOD = new Date('2026-07-10T12:00:00.000Z');

describe('Offline Mode licensing release-blocker matrix', () => {
  it('keeps a paid solo subscription and all local data available from its last confirmed status', () => {
    const entitlement = decideEntitlement(
      {
        tier: 'personal',
        type: 'subscription',
        expiresAt: '2026-08-01T00:00:00.000Z',
      },
      NOW,
      { isOffline: true, lastKnownGoodAt: LAST_GOOD }
    );
    expect(entitlement.dataAccessAlwaysTrue).toBe(true);
    expect(entitlement.aiEnabled).toBe(true);
  });

  it('keeps a grandfathered solo license fully available offline', () => {
    const entitlement = decideEntitlement(
      {
        tier: 'professional',
        type: 'professional-onetime',
        expiresAt: '2020-01-01T00:00:00.000Z',
      },
      NOW,
      { isOffline: true, lastKnownGoodAt: null }
    );
    expect(entitlement.dataAccessAlwaysTrue).toBe(true);
    expect(entitlement.isGrandfathered).toBe(true);
    expect(entitlement.aiEnabled).toBe(true);
  });

  it('keeps a paid firm seat and its local data available from a verified cached token', () => {
    const entitlement = decideFirmEntitlement(
      {
        activated: true,
        tier: 'practice',
        packs: ['legal'],
        seats: 3,
        serverVerdict: 'unknown',
        offlineValid: true,
        lastValidatedAt: LAST_GOOD,
      },
      NOW
    );
    expect(entitlement.dataAccessAlwaysTrue).toBe(true);
    expect(entitlement.state).toBe('offline-grace');
    expect(entitlement.aiEnabled).toBe(true);
  });

  it('uses the existing 60-day grace semantics for an expired solo token without losing data', () => {
    const entitlement = decideEntitlement(
      {
        tier: 'personal',
        type: 'subscription',
        expiresAt: '2026-07-01T00:00:00.000Z',
      },
      NOW,
      { isOffline: true, lastKnownGoodAt: LAST_GOOD }
    );
    expect(entitlement.dataAccessAlwaysTrue).toBe(true);
    expect(entitlement.state).toBe('offline-grace');
  });

  it('never lets Offline Mode override a server revocation seen before it was enabled', () => {
    const offline = licenseOfflineGraceState(true, LAST_GOOD, 'revoked');
    const entitlement = decideEntitlement(
      { tier: 'personal', type: 'subscription', status: 'revoked' },
      NOW,
      offline
    );
    expect(offline.isOffline).toBe(false);
    expect(entitlement.dataAccessAlwaysTrue).toBe(true);
    expect(entitlement.aiEnabled).toBe(false);
    expect(entitlement.reason).toBe('subscription-revoked');
  });

  it('keeps local data available with no token, while leaving paid features off', () => {
    const entitlement = decideEntitlement({ tier: 'free' }, NOW, {
      isOffline: true,
      lastKnownGoodAt: null,
    });
    expect(entitlement.dataAccessAlwaysTrue).toBe(true);
    expect(entitlement.state).toBe('unlicensed');
    expect(entitlement.aiEnabled).toBe(false);
  });
});
