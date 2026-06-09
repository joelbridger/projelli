/**
 * firmEntitlement — an active firm seat grants the Firm tier; a revoked seat
 * degrades features but NEVER locks data; offline relies on the offline-verified
 * seat token within grace. The data-ownership invariant holds in every branch.
 */

import { describe, it, expect } from 'vitest';
import {
  decideFirmEntitlement,
  type FirmSeatState,
} from '@/modules/firm/firmEntitlement';
import { OFFLINE_GRACE_DAYS } from '@/modules/licensing/entitlements';

const NOW = new Date('2026-09-01T12:00:00.000Z');
const day = (n: number) => n * 24 * 60 * 60 * 1000;

const base: FirmSeatState = {
  activated: true,
  tier: 'practice',
  packs: ['legal'],
  seats: 5,
  serverVerdict: 'valid',
  offlineValid: true,
  lastValidatedAt: NOW.toISOString(),
};

describe('decideFirmEntitlement', () => {
  it('an active (server-validated) seat grants the Firm tier with AI + updates on', () => {
    const e = decideFirmEntitlement(base, NOW);
    expect(e.entitledTier).toBe('practice');
    expect(e.aiEnabled).toBe(true);
    expect(e.updatesEnabled).toBe(true);
    expect(e.state).toBe('subscription-active');
    expect(e.dataAccessAlwaysTrue).toBe(true);
  });

  it('not activated -> no firm features, data still on', () => {
    const e = decideFirmEntitlement({ ...base, activated: false }, NOW);
    expect(e.entitledTier).toBe('free');
    expect(e.aiEnabled).toBe(false);
    expect(e.state).toBe('unlicensed');
    expect(e.dataAccessAlwaysTrue).toBe(true);
  });

  it('a REVOKED seat degrades features but keeps data accessible', () => {
    const e = decideFirmEntitlement({ ...base, serverVerdict: 'revoked' }, NOW);
    expect(e.aiEnabled).toBe(false);
    expect(e.updatesEnabled).toBe(false);
    expect(e.entitledTier).toBe('free');
    expect(e.state).toBe('subscription-lapsed');
    expect(e.reason).toBe('firm-seat-revoked');
    expect(e.dataAccessAlwaysTrue).toBe(true);
  });

  it('offline + offline-verified token within grace -> full access (offline-grace)', () => {
    const e = decideFirmEntitlement(
      {
        ...base,
        serverVerdict: 'unknown',
        offlineValid: true,
        lastValidatedAt: new Date(NOW.getTime() - day(OFFLINE_GRACE_DAYS - 1)).toISOString(),
      },
      NOW,
    );
    expect(e.aiEnabled).toBe(true);
    expect(e.state).toBe('offline-grace');
    expect(e.dataAccessAlwaysTrue).toBe(true);
  });

  it('offline + offline-verified token but grace blown -> degrade, data on', () => {
    const e = decideFirmEntitlement(
      {
        ...base,
        serverVerdict: 'unknown',
        offlineValid: true,
        lastValidatedAt: new Date(NOW.getTime() - day(OFFLINE_GRACE_DAYS + 5)).toISOString(),
      },
      NOW,
    );
    expect(e.aiEnabled).toBe(false);
    expect(e.state).toBe('subscription-lapsed');
    expect(e.dataAccessAlwaysTrue).toBe(true);
  });

  it('offline + never validated but holds a valid unexpired token -> honored', () => {
    // Activated then immediately offline: no lastValidatedAt, but the token's
    // own exp (checked by offlineValid) bounds it.
    const e = decideFirmEntitlement(
      { ...base, serverVerdict: 'unknown', offlineValid: true, lastValidatedAt: null },
      NOW,
    );
    expect(e.aiEnabled).toBe(true);
    expect(e.state).toBe('offline-grace');
  });

  it('offline + the offline token is INVALID (expired/tampered) -> degrade, data on', () => {
    const e = decideFirmEntitlement(
      { ...base, serverVerdict: 'unknown', offlineValid: false, lastValidatedAt: null },
      NOW,
    );
    expect(e.aiEnabled).toBe(false);
    expect(e.state).toBe('subscription-lapsed');
    expect(e.dataAccessAlwaysTrue).toBe(true);
  });

  it('INVARIANT: data access is always true across the verdict/offline matrix', () => {
    const verdicts: FirmSeatState['serverVerdict'][] = ['valid', 'revoked', 'unknown'];
    for (const activated of [true, false]) {
      for (const serverVerdict of verdicts) {
        for (const offlineValid of [true, false]) {
          const e = decideFirmEntitlement(
            { ...base, activated, serverVerdict, offlineValid },
            NOW,
          );
          expect(e.dataAccessAlwaysTrue).toBe(true);
        }
      }
    }
  });
});
