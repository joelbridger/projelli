import { describe, expect, it } from 'vitest';
import { checkFlagCap, ACTIVE_FLAG_CAP } from '../../../scripts/check-flag-cap.mjs';
import {
  ageInDays,
  formatInventory,
} from '../../../scripts/flag-inventory.mjs';
import { readFlagRegistry } from '../../../scripts/flag-registry.mjs';
import { flagRegistry } from '../../../src/platform/flags/registry';

describe('feature flag scripts', () => {
  it('allows at most ACTIVE_FLAG_CAP active registry entries', () => {
    expect(checkFlagCap(Array.from({ length: ACTIVE_FLAG_CAP }))).toMatchObject({
      ok: true,
    });
    expect(checkFlagCap(Array.from({ length: ACTIVE_FLAG_CAP + 1 }))).toMatchObject({
      ok: false,
      message: expect.stringContaining(`${ACTIVE_FLAG_CAP + 1}/${ACTIVE_FLAG_CAP}`),
    });
  });

  it('prints the cleanup inventory columns and ages', () => {
    const flags = [
      {
        id: 'dark-feature',
        ownerLane: 'P0-T',
        createdAt: '2026-07-01',
        expiresAt: '2026-08-01',
      },
    ];
    expect(ageInDays('2026-07-01', new Date('2026-07-14T12:00:00.000Z'))).toBe(
      13
    );
    expect(
      formatInventory(flags, new Date('2026-07-14T12:00:00.000Z'))
    ).toContain('ID            OWNER  AGE  EXPIRY');
    expect(
      formatInventory(flags, new Date('2026-07-14T12:00:00.000Z'))
    ).toContain('dark-feature  P0-T   13d');
  });

  it('parses the real atomic registry into the canonical flag descriptors', () => {
    expect(readFlagRegistry()).toEqual(flagRegistry);
  });
});
