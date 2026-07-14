import { describe, expect, it } from 'vitest';
import { expiredFlagMessage, getExpiredFlags } from './expiry';
import { flagRegistry, type FlagDescriptor } from './registry';

describe('feature-flag expiry', () => {
  it('lists only flags whose expiry day has passed', () => {
    const flags: readonly FlagDescriptor[] = [
      {
        id: 'expired',
        description: 'test',
        ownerLane: 'P0-T',
        createdAt: '2026-01-01',
        expiresAt: '2026-01-02',
        defaultEnabled: false,
      },
      {
        id: 'current',
        description: 'test',
        ownerLane: 'P0-T',
        createdAt: '2026-01-01',
        expiresAt: '2026-01-03',
        defaultEnabled: false,
      },
    ];
    expect(
      getExpiredFlags(flags, new Date('2026-01-03T12:00:00.000Z')).map(
        (flag) => flag.id
      )
    ).toEqual(['expired']);
  });

  it('has no expired flags in the real registry — extend deliberately or remove', () => {
    const expired = getExpiredFlags(flagRegistry);
    expect(expired, expiredFlagMessage(expired)).toEqual([]);
  });
});
