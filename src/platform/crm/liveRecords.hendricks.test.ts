import { describe, expect, it } from 'vitest';
import { HENDRICKS_HOUSEHOLD_KEY } from '@/platform/samples/hendricksReviewCapability';

describe('Hendricks local CRM target', () => {
  it('is pinned to the built-in household', () => {
    expect(HENDRICKS_HOUSEHOLD_KEY).toBe('sample-hendricks-household');
  });
});
