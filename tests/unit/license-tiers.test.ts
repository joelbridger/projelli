// License tier + profession-pack entitlement tests for the new pricing model.
//
// New model: 'free' (unactivated / post-trial) unlocks nothing; every paid
// tier ('personal' | 'professional' | 'practice') gets the FULL app, so
// `tierHasFeature` collapses to `tier !== 'free'` for every feature. The only
// paid differentiators are profession packs (checked by `hasPack`) and seats.

import { describe, it, expect } from 'vitest';
import { tierHasFeature, hasPack } from '@/hooks/useLicense';
import type { LicenseTier } from '@/hooks/useLicense';

const FEATURES = [
  'multi-provider',
  'all-templates',
  'unlimited-workspaces',
  'audio',
  'research-citations',
  'multi-model-comparison',
  'commercial-use',
] as const;

const PAID_TIERS: LicenseTier[] = ['personal', 'professional', 'practice'];

describe('tierHasFeature', () => {
  it('free tier has no features', () => {
    for (const feature of FEATURES) {
      expect(tierHasFeature('free', feature)).toBe(false);
    }
  });

  for (const tier of PAID_TIERS) {
    it(`${tier} tier has every feature (including commercial-use)`, () => {
      for (const feature of FEATURES) {
        expect(tierHasFeature(tier, feature)).toBe(true);
      }
      // Explicit: commercial use is the whole product now.
      expect(tierHasFeature(tier, 'commercial-use')).toBe(true);
    });
  }
});

describe('hasPack', () => {
  it('practice unlocks every pack regardless of explicit packs', () => {
    expect(hasPack({ tier: 'practice', packs: [] }, 'legal')).toBe(true);
    expect(hasPack({ tier: 'practice', packs: [] }, 'tax')).toBe(true);
    expect(hasPack({ tier: 'practice', packs: [] }, 'consulting')).toBe(true);
  });

  it('professional grants only its explicitly-listed pack', () => {
    expect(hasPack({ tier: 'professional', packs: ['legal'] }, 'legal')).toBe(true);
    expect(hasPack({ tier: 'professional', packs: ['legal'] }, 'tax')).toBe(false);
  });

  it('personal grants no pack', () => {
    expect(hasPack({ tier: 'personal', packs: [] }, 'legal')).toBe(false);
  });
});
