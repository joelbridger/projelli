/**
 * pricing.ts - the ONE canonical source of truth for Keepance 3.0 pricing.
 *
 * Every surface that shows a price, a tier name, a feature list, the BYOK
 * framing, the data-ownership guarantee, or the competitor context reads from
 * THIS module. The UX research flagged surface-to-surface price inconsistency
 * as a trust killer, so there is exactly one place to change a number.
 *
 * Source of truth for the numbers + copy: the ratified recommendation in
 * `docs/strategy/2026-06-09-keepance-3.0-pricing.md`. If that doc and this file
 * ever disagree, the doc wins and this file is wrong - fix it here.
 *
 * ── Tier-code reconciliation (READ THIS) ───────────────────────────────────
 * The internal tier CODES are intentionally STABLE as `personal | professional
 * | practice`. The backend client contract (`backend/src/contract.ts`), the
 * license-validator service, and `src/hooks/useLicense.ts` all speak those
 * codes on the wire. We do NOT refactor them - a license minted today must keep
 * validating.
 *
 * Keepance 3.0 gives those same three codes new DISPLAY names + new prices:
 *     code 'personal'      -> display "Solo"
 *     code 'professional'  -> display "Professional"
 *     code 'practice'      -> display "Firm"
 *
 * So: wire code stays `practice`, the human sees "Firm". Use `displayName(code)`
 * (or `TIER_BY_CODE[code].displayName`) everywhere a tier is shown to a user.
 */

/** The stable wire/license codes. Never rename these (backend + JWT depend on them). */
export type PricingTierCode = 'personal' | 'professional' | 'practice';

export type BillingCadence = 'annual' | 'monthly';

export interface PricingTier {
  /** Stable wire/license code. Do not change. */
  code: PricingTierCode;
  /** 3.0 human-facing name. */
  displayName: string;
  /** Who the tier is for (one line, from the pricing doc). */
  audience: string;
  /** Headline price: annual, billed yearly, per seat, in whole USD/month. */
  annualPerMonth: number;
  /** The annual total per seat, in whole USD (annualPerMonth * 12). */
  annualPerYear: number;
  /** Month-to-month price per seat, in whole USD/month (the ~25-30% premium). */
  monthlyPerMonth: number;
  /** Founding-cohort price (annual, per seat, per month), locked for life. */
  foundingAnnualPerMonth: number;
  /** Founding annual total per seat. */
  foundingAnnualPerYear: number;
  /** Minimum seats required to buy this tier (Firm has a 3-seat floor). */
  minSeats: number;
  /** Whether this tier is the visually highlighted / recommended one. */
  featured: boolean;
  /** Short "what this tier adds" feature lines, in display order. */
  features: string[];
}

/**
 * The three tiers, in display order. Numbers are exactly the ratified figures:
 *   Solo          $39/mo annual ($468/yr); $49/mo monthly
 *   Professional  $79/mo annual ($948/yr); $99/mo monthly
 *   Firm          $129/seat/mo annual ($1,548/seat/yr); $159/mo monthly, min 3 seats
 *
 * Founding rate is ~30% off the annual rate, locked for the life of the
 * subscription (Solo $27/mo, Professional $55/mo, Firm $90/seat/mo).
 */
export const PRICING_TIERS: readonly PricingTier[] = [
  {
    code: 'personal',
    displayName: 'Solo',
    audience: 'A single attorney',
    annualPerMonth: 39,
    annualPerYear: 468,
    monthlyPerMonth: 49,
    foundingAnnualPerMonth: 27,
    foundingAnnualPerYear: 324,
    minSeats: 1,
    featured: false,
    features: [
      'The complete confidential workspace',
      'The Word-native editor',
      'AI redlining with tracked changes',
      'Confidential matter-scoped cited recall across email and documents',
      'Privilege controls',
      'Local model or your own AI key',
      'The trust layer',
    ],
  },
  {
    code: 'professional',
    displayName: 'Professional',
    audience: 'The serious solo or small-firm litigator',
    annualPerMonth: 79,
    annualPerYear: 948,
    monthlyPerMonth: 99,
    foundingAnnualPerMonth: 55,
    foundingAnnualPerYear: 660,
    minSeats: 1,
    featured: true,
    features: [
      'Everything in Solo',
      'The litigation associate: deposition contradiction-finder, timelines, discovery triage, privilege-log drafter',
      'Version history',
      'All practice packs',
      'Priority support',
    ],
  },
  {
    code: 'practice',
    displayName: 'Firm',
    audience: 'Firms of roughly 5 to 50 attorneys',
    annualPerMonth: 129,
    annualPerYear: 1548,
    monthlyPerMonth: 159,
    foundingAnnualPerMonth: 90,
    foundingAnnualPerYear: 1080,
    minSeats: 3,
    featured: false,
    features: [
      'Everything in Professional',
      'Shared matters and collaboration',
      'Admin console with ethical walls and seat management',
      'The assured zero-retention option',
      'The assurance package: DPA, trust center, SOC 2 readiness',
    ],
  },
] as const;

/** Lookup a tier by its stable wire/license code. Derived from PRICING_TIERS. */
export const TIER_BY_CODE: Record<PricingTierCode, PricingTier> = PRICING_TIERS.reduce(
  (acc, tier) => {
    acc[tier.code] = tier;
    return acc;
  },
  {} as Record<PricingTierCode, PricingTier>,
);

/**
 * Map a license/wire code to its 3.0 display name. The hook's tier can also be
 * 'free' (unactivated / trial / post-trial); that maps to "Free".
 */
export function displayName(code: PricingTierCode | 'free'): string {
  if (code === 'free') return 'Free';
  return TIER_BY_CODE[code].displayName;
}

/** Founding-cohort policy, lifted from the pricing doc. */
export const FOUNDING_RATE = {
  /** Roughly 30% off the annual rate. */
  discountPercent: 30,
  /**
   * The first cohort (e.g. first 100 Solo/Professional seats and first 10
   * firms) locks the discount for the LIFE of the subscription.
   */
  blurb:
    'The first cohort locks a 30% discount for the life of the subscription. This rewards the early-trust buyers our research found are decisive.',
  /** Short label used on cards. */
  label: 'Founding rate',
} as const;

/** The trial offer, unchanged in 3.0: 30 days, no card. */
export const TRIAL = {
  days: 30,
  blurb: 'Try it free for 30 days. No credit card.',
} as const;

/**
 * BYOK transparency framing. The objection ("and I also pay the AI company
 * separately?") becomes the selling point. Copy is lifted verbatim from the
 * pricing doc, section 3.
 */
export const BYOK_FRAMING = {
  /** One-line version for tight spots (cards, the in-app license panel). */
  short:
    'You bring your own AI key and pay the provider directly, usually $5 to $15 a month for a solo. We take zero markup on AI usage. Prefer that nothing leaves your machine? Run a local model with Ollama and pay nothing for AI.',
  /** Full paragraph for the pricing page. */
  long:
    'You bring your own AI key and pay the provider directly (usually $5 to $15 a month for a solo). We take zero markup on AI usage, and you see exactly what it costs. Prefer that nothing leaves your machine at all? Run a local model with Ollama and pay nothing for AI. Either way, your subscription covers the platform: the Word editor, AI redlining, confidential cited recall, privilege controls, encryption, updates, and support. It does not cover the AI tokens, and we never mark them up.',
} as const;

/**
 * The hard data-ownership guarantee. This is what keeps subscription from
 * meaning lock-in. Copy is lifted verbatim from the pricing doc, section 2.
 */
export const DATA_OWNERSHIP_GUARANTEE = {
  heading: 'Your files are always yours.',
  body:
    'They are real Word and PDF files in your own folders. If you ever cancel, you keep every document, email, and matter you have made. A lapsed subscription turns off the AI features and updates, not your data. Nothing is ever held hostage.',
} as const;

/**
 * Where this sits versus the competition. The single-line "story" is lifted
 * from the pricing doc, section 4. The rows back it up on the pricing page.
 */
export const COMPETITOR_CONTEXT = {
  /** The headline framing line. */
  story:
    'A fraction of CoCounsel, and the only one where your client files never leave your control.',
  /** Supporting rows for a comparison strip (per seat). */
  rows: [
    {
      product: 'Thomson Reuters CoCounsel Core',
      price: '$225/seat/mo (about $4,500/yr)',
      position: 'Keepance Firm is roughly half to one-third the price',
    },
    {
      product: 'Westlaw + CoCounsel',
      price: '$428 to $639/seat/mo',
      position: 'Keepance Firm is one-third to one-fifth the price',
    },
    {
      product: 'Clio / MyCase (practice management)',
      price: '$39 to $149/seat/mo annual',
      position: 'Comparable, but Keepance is the private AI layer beside Clio, not a replacement',
    },
    {
      product: 'Microsoft 365 Copilot',
      price: '$21 to $30/mo add-on (needs base M365)',
      position: 'Keepance Solo is at or above, with legal-specific depth and no required base subscription',
    },
  ],
} as const;

/**
 * Grandfathering policy for the move from the old one-time pricing to 3.0
 * subscription. Stated plainly so the in-app and site copy stay consistent.
 */
export const GRANDFATHER_POLICY = {
  blurb:
    'Bought the old one-time Personal, Professional, or Practice license? You keep exactly what you paid for, in good faith. Keepance 3.0 is a new, repositioned product at new pricing, and we never claw back what you already own.',
} as const;

/** Convenience: format a per-seat annual price like "$39/mo ($468/yr)". */
export function formatAnnual(tier: PricingTier): string {
  return `$${String(tier.annualPerMonth)}/mo ($${tier.annualPerYear.toLocaleString('en-US')}/yr)`;
}
