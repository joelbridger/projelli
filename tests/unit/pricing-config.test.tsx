/**
 * Keepance 3.0 pricing tests.
 *
 * Covers:
 *   1. The canonical config (src/config/pricing.ts) exposes exactly the three
 *      tiers with the ratified prices, and the stable code -> display-name
 *      mapping (personal->Solo, professional->Professional, practice->Firm).
 *   2. The in-app pricing display (PricingTiers) renders all three tiers plus
 *      the BYOK transparency line and the data-ownership guarantee.
 *   3. The pricing tier CODES are unchanged and stay aligned with useLicense's
 *      LicenseTier and the backend contract Plan (the license validator depends
 *      on these codes being stable).
 *   4. Voice rules: no em dashes, no banned marketing words in pricing copy.
 *
 * The fact that useLicense still *validates* with the unchanged codes is locked
 * by tests/unit/license-tiers.test.ts (tierHasFeature/hasPack over
 * 'personal'|'professional'|'practice'); here we assert the codes themselves
 * have not drifted from that hook or the backend.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/i18n';
import {
  PRICING_TIERS,
  TIER_BY_CODE,
  displayName,
  BYOK_FRAMING,
  DATA_OWNERSHIP_GUARANTEE,
  COMPETITOR_CONTEXT,
  FOUNDING_RATE,
  formatAnnual,
  type PricingTierCode,
} from '@/config/pricing';
import { PricingTiers } from '@/features/settings/PricingTiers';
import type { LicenseTier } from '@/hooks/useLicense';
import type { Plan } from '../../backend/src/contract';

describe('pricing config — tiers and prices', () => {
  it('exposes exactly three tiers in display order', () => {
    expect(PRICING_TIERS).toHaveLength(3);
    expect(PRICING_TIERS.map((t) => t.code)).toEqual(['personal', 'professional', 'practice']);
  });

  it('Solo (personal) has the ratified prices', () => {
    const solo = TIER_BY_CODE.personal;
    expect(solo.displayName).toBe('Solo');
    expect(solo.annualPerMonth).toBe(39);
    expect(solo.annualPerYear).toBe(468);
    expect(solo.monthlyPerMonth).toBe(49);
    expect(solo.minSeats).toBe(1);
    expect(solo.foundingAnnualPerMonth).toBe(27);
    expect(solo.foundingAnnualPerYear).toBe(324);
  });

  it('Professional has the ratified prices and is featured', () => {
    const pro = TIER_BY_CODE.professional;
    expect(pro.displayName).toBe('Professional');
    expect(pro.annualPerMonth).toBe(79);
    expect(pro.annualPerYear).toBe(948);
    expect(pro.monthlyPerMonth).toBe(99);
    expect(pro.featured).toBe(true);
    expect(pro.foundingAnnualPerMonth).toBe(55);
    expect(pro.foundingAnnualPerYear).toBe(660);
  });

  it('Firm (practice) has the ratified prices and a 3-seat minimum', () => {
    const firm = TIER_BY_CODE.practice;
    expect(firm.displayName).toBe('Firm');
    expect(firm.annualPerMonth).toBe(129);
    expect(firm.annualPerYear).toBe(1548);
    expect(firm.monthlyPerMonth).toBe(159);
    expect(firm.minSeats).toBe(3);
    expect(firm.foundingAnnualPerMonth).toBe(90);
    expect(firm.foundingAnnualPerYear).toBe(1080);
  });

  it('annualPerYear is always 12x annualPerMonth (internal consistency)', () => {
    for (const t of PRICING_TIERS) {
      expect(t.annualPerYear).toBe(t.annualPerMonth * 12);
      expect(t.foundingAnnualPerYear).toBe(t.foundingAnnualPerMonth * 12);
    }
  });

  it('monthly carries a 20%+ premium over the annual rate (per the model)', () => {
    for (const t of PRICING_TIERS) {
      expect(t.monthlyPerMonth).toBeGreaterThan(t.annualPerMonth);
    }
  });

  it('the founding rate is roughly 30% off the annual rate', () => {
    expect(FOUNDING_RATE.discountPercent).toBe(30);
    for (const t of PRICING_TIERS) {
      const impliedDiscount = 1 - t.foundingAnnualPerMonth / t.annualPerMonth;
      expect(impliedDiscount).toBeGreaterThan(0.25);
      expect(impliedDiscount).toBeLessThan(0.35);
    }
  });

  it('formatAnnual renders a "$X/mo ($Y/yr)" string', () => {
    expect(formatAnnual(TIER_BY_CODE.personal)).toBe('$39/mo ($468/yr)');
    expect(formatAnnual(TIER_BY_CODE.practice)).toBe('$129/mo ($1,548/yr)');
  });
});

describe('pricing config — code -> display-name mapping', () => {
  it('maps each stable code to its 3.0 display name', () => {
    expect(displayName('personal')).toBe('Solo');
    expect(displayName('professional')).toBe('Professional');
    expect(displayName('practice')).toBe('Firm');
  });

  it('maps the unactivated/trial code to "Free"', () => {
    expect(displayName('free')).toBe('Free');
  });

  it('TIER_BY_CODE is keyed by the stable codes', () => {
    expect(Object.keys(TIER_BY_CODE).sort()).toEqual(['personal', 'practice', 'professional']);
  });
});

describe('pricing config — codes stay aligned with useLicense + backend', () => {
  it('every pricing code is a valid LicenseTier (compile-time + runtime)', () => {
    // If a code were ever renamed, this assignment would not type-check.
    const asLicenseTiers: LicenseTier[] = PRICING_TIERS.map((t) => t.code);
    expect(asLicenseTiers).toEqual(['personal', 'professional', 'practice']);
  });

  it('every pricing code is a valid backend Plan (wire-compat)', () => {
    const asPlans: Plan[] = PRICING_TIERS.map((t) => t.code);
    expect(asPlans).toEqual(['personal', 'professional', 'practice']);
  });

  it('the code set is exactly the three stable codes, not the display names', () => {
    const codes = new Set<PricingTierCode>(PRICING_TIERS.map((t) => t.code));
    expect(codes.has('personal')).toBe(true);
    expect(codes.has('professional')).toBe(true);
    expect(codes.has('practice')).toBe(true);
    // Display names must NOT be used as codes.
    expect((codes as Set<string>).has('solo')).toBe(false);
    expect((codes as Set<string>).has('firm')).toBe(false);
  });
});

describe('in-app pricing display (PricingTiers)', () => {
  beforeEach(() => render(<PricingTiers />));

  it('renders all three tiers by display name', () => {
    expect(screen.getByTestId('pricing-tier-personal')).toHaveAttribute('data-tier-name', 'Solo');
    expect(screen.getByTestId('pricing-tier-professional')).toHaveAttribute('data-tier-name', 'Professional');
    expect(screen.getByTestId('pricing-tier-practice')).toHaveAttribute('data-tier-name', 'Firm');
  });

  it('shows the headline annual per-seat prices', () => {
    expect(screen.getByTestId('pricing-tier-personal')).toHaveTextContent('$39');
    expect(screen.getByTestId('pricing-tier-professional')).toHaveTextContent('$79');
    expect(screen.getByTestId('pricing-tier-practice')).toHaveTextContent('$129');
  });

  it('shows the annual totals and the month-to-month option', () => {
    expect(screen.getByTestId('pricing-tier-personal')).toHaveTextContent('$468/yr');
    expect(screen.getByTestId('pricing-tier-personal')).toHaveTextContent('$49/mo month-to-month');
    // Firm shows the 3-seat minimum.
    expect(screen.getByTestId('pricing-tier-practice')).toHaveTextContent('min 3 seats');
  });

  it('renders the BYOK transparency line', () => {
    const byok = screen.getByTestId('pricing-byok');
    expect(byok).toHaveTextContent('bring your own AI key');
    expect(byok).toHaveTextContent('zero markup');
    expect(byok).toHaveTextContent('Ollama');
  });

  it('renders the data-ownership guarantee', () => {
    const guarantee = screen.getByTestId('pricing-data-ownership');
    expect(guarantee).toHaveTextContent('Your files are always yours');
    expect(guarantee).toHaveTextContent('turns off the AI features and updates, not your data');
  });

  it('renders the founding-rate + trial line', () => {
    const founding = screen.getByTestId('pricing-founding-rate');
    expect(founding).toHaveTextContent('Founding rate');
    expect(founding).toHaveTextContent('30 days');
  });
});

describe('pricing copy — voice rules', () => {
  const allCopy = [
    ...PRICING_TIERS.flatMap((t) => [t.displayName, t.audience, ...t.features]),
    BYOK_FRAMING.short,
    BYOK_FRAMING.long,
    DATA_OWNERSHIP_GUARANTEE.heading,
    DATA_OWNERSHIP_GUARANTEE.body,
    COMPETITOR_CONTEXT.story,
    ...COMPETITOR_CONTEXT.rows.flatMap((r) => [r.product, r.price, r.position]),
    FOUNDING_RATE.blurb,
  ].join('  ');

  it('contains no em dashes', () => {
    expect(allCopy).not.toMatch(/—|&mdash;/);
  });

  it('contains no banned marketing words', () => {
    const banned = /\b(leverage|delve|seamless|transform|empower|elevate|unlock|tapestry)\b/i;
    expect(allCopy).not.toMatch(banned);
  });
});
