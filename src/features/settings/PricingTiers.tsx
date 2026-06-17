/**
 * PricingTiers - the in-app pricing display.
 *
 * Renders the three Keepance 3.0 tiers (Solo / Professional / Firm) straight
 * from the canonical config in `src/config/pricing.ts`, so the in-app prices
 * can never drift from the website or the docs. Shows per-tier features, the
 * BYOK transparency line, and the hard data-ownership guarantee.
 *
 * Light theme by design (light surfaces, dark text, navy accent). Sits inside
 * Settings, in the not-activated/trial state under the "Get a license" CTA.
 */

import {
  PRICING_TIERS,
  BYOK_FRAMING,
  DATA_OWNERSHIP_GUARANTEE,
  FOUNDING_RATE,
  TRIAL,
  type PricingTier,
} from '@/config/pricing';

function TierCard({ tier }: { tier: PricingTier }) {
  return (
    <div
      data-testid={`pricing-tier-${tier.code}`}
      data-tier-name={tier.displayName}
      className={
        'rounded-lg border p-4 flex flex-col transition-opacity ' +
        (tier.featured
          ? 'border-primary/60 bg-primary/5 ring-1 ring-primary/20'
          : tier.dimmed
            ? 'border-border bg-card opacity-80'
            : 'border-border bg-card')
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold tracking-tight">{tier.displayName}</span>
        {tier.featured && (
          <span
            data-testid={`pricing-badge-${tier.code}`}
            className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-primary/15 text-primary"
          >
            {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string -- product pricing copy, English-canonical */}
            Start here
          </span>
        )}
        {!tier.featured && !tier.dimmed && (
          <span
            data-testid={`pricing-badge-${tier.code}`}
            className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium text-muted-foreground border border-border"
          >
            {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string -- product pricing copy, English-canonical */}
            More features
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-0.5">{tier.audience}</p>

      <div className="mt-3">
        <span className="text-2xl font-bold tracking-tight">${tier.annualPerMonth}</span>
        <span className="text-sm text-muted-foreground">
          {tier.minSeats > 1 ? '/seat/mo' : '/mo'}
        </span>
      </div>
      <p className="text-xs text-muted-foreground mt-0.5">
        {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string -- product pricing copy, English-canonical */}
        ${tier.annualPerYear.toLocaleString('en-US')}/yr, billed annually
        {tier.minSeats > 1 ? ` · min ${String(tier.minSeats)} seats` : ''}
        {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string -- product pricing copy, English-canonical */}
        {' · '}or ${tier.monthlyPerMonth}/mo month-to-month
      </p>

      <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground flex-1">
        {tier.features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <span aria-hidden className="text-primary mt-0.5 flex-shrink-0">
              &rarr;
            </span>
            <span>{f}</span>
          </li>
        ))}
      </ul>

      {/* Firm tier: honest sublabel about roadmap status */}
      {tier.dimmed && (
        <p
          data-testid="pricing-firm-sublabel"
          className="mt-3 text-xs text-muted-foreground border-t pt-2"
        >
          {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string -- product pricing copy, English-canonical */}
          For growing firms; SSO and co-editing included, SOC 2 and DPA on the roadmap.
        </p>
      )}
    </div>
  );
}

export function PricingTiers() {
  return (
    <div data-testid="pricing-tiers" className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {PRICING_TIERS.map((tier) => (
          <TierCard key={tier.code} tier={tier} />
        ))}
      </div>

      <p className="text-xs text-muted-foreground" data-testid="pricing-founding-rate">
        <span className="font-medium text-foreground">{FOUNDING_RATE.label}:</span>{' '}
        {FOUNDING_RATE.blurb} {TRIAL.blurb}
      </p>

      {/* BYOK transparency: the second-bill objection turned into a selling point. */}
      <div
        className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground"
        data-testid="pricing-byok"
      >
        {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string -- product pricing copy, English-canonical */}
        <span className="font-medium text-foreground">You bring your own AI key.</span>{' '}
        {BYOK_FRAMING.short}
      </div>

      {/* The hard data-ownership guarantee: subscription, not lock-in. */}
      <div
        className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground"
        data-testid="pricing-data-ownership"
      >
        <span className="font-medium text-foreground">{DATA_OWNERSHIP_GUARANTEE.heading}</span>{' '}
        {DATA_OWNERSHIP_GUARANTEE.body}
      </div>
    </div>
  );
}
