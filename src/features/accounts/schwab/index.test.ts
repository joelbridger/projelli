import { describe, expect, it } from 'vitest';
import * as schwab from './index';

describe('Schwab public doorway', () => {
  it('exports only the review surface and redacted receipt lookup', () => {
    expect(Object.keys(schwab).sort()).toEqual([
      'SchwabPrefillReview',
      'findSchwabReceipt',
    ]);
  });
});
