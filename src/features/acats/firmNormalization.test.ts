import { describe, expect, it } from 'vitest';
import {
  normalizeDeliveringFirmName,
  DELIVERING_FIRM_NORMALIZATION_TABLE,
} from './firmNormalization';

describe('ACATS delivering firm normalization', () => {
  it('maps known delivering-firm aliases to stable canonical keys', () => {
    expect(normalizeDeliveringFirmName('Wells Fargo Advisors')).toMatchObject({
      canonicalKey: 'wells-fargo-advisors',
      displayName: 'Wells Fargo Advisors',
    });
    expect(normalizeDeliveringFirmName('WF Clearing Services LLC')).toMatchObject({
      canonicalKey: 'wells-fargo-advisors',
    });
    expect(normalizeDeliveringFirmName('Fidelity Brokerage Services LLC')).toMatchObject({
      canonicalKey: 'fidelity',
    });
    expect(normalizeDeliveringFirmName('Vanguard Brokerage Services')).toMatchObject({
      canonicalKey: 'vanguard',
    });
    expect(normalizeDeliveringFirmName('Morgan Stanley Smith Barney')).toMatchObject({
      canonicalKey: 'morgan-stanley',
    });
    expect(normalizeDeliveringFirmName('NetXInvestor / Pershing LLC')).toMatchObject({
      canonicalKey: 'pershing',
    });
    expect(normalizeDeliveringFirmName('Merrill Lynch Wealth Management')).toMatchObject({
      canonicalKey: 'merrill',
    });
  });

  it('keeps unknown firms explicit instead of pretending to know them', () => {
    expect(normalizeDeliveringFirmName('Tiny Local Custodian')).toEqual({
      canonicalKey: 'unknown',
      displayName: 'Tiny Local Custodian',
      aliases: [],
    });
  });

  it('ships with the first firms named in the plan', () => {
    const keys = DELIVERING_FIRM_NORMALIZATION_TABLE.map((firm) => firm.canonicalKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        'wells-fargo-advisors',
        'fidelity',
        'vanguard',
        'morgan-stanley',
        'pershing',
        'merrill',
      ]),
    );
  });
});
