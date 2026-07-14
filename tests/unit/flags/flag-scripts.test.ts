import { describe, expect, it } from 'vitest';
import { checkFlagCap } from '../../../scripts/check-flag-cap.mjs';
import {
  ageInDays,
  formatInventory,
} from '../../../scripts/flag-inventory.mjs';

describe('feature flag scripts', () => {
  it('allows at most fifteen active registry entries', () => {
    expect(checkFlagCap(Array.from({ length: 15 }))).toMatchObject({
      ok: true,
    });
    expect(checkFlagCap(Array.from({ length: 16 }))).toMatchObject({
      ok: false,
      message: expect.stringContaining('16/15'),
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
});
