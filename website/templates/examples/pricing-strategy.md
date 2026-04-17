# Acme Budget, Pricing Strategy

## The single-tier decision

Acme Budget ships with one price. No freemium, no free trial that auto-converts, no three-tier dark pattern. Just $12/month or $108/year (25% discount). That's it.

## Why one tier

Freemium punishes the kind of user I want. A freelancer who's been burned by a surprise tax bill doesn't need a "limited free version" to evaluate the product. They need to know if the tax-bucket feature actually works. A 14-day free trial without a card is the right entry, not a feature-crippled free plan that makes the product feel incomplete forever.

Reference: [Kyle Poyar's data on freemium vs free trial conversion](https://kylepoyar.substack.com/) consistently shows that B2C tools with a single clear paid tier outperform multi-tier SaaS on lifetime value when the target user is high-intent.

## The price anchor

Competitor band is $13-15/month. I'm landing at $12 deliberately. Not cheaper to win the bottom, cheaper to make the annual plan feel like an easy upgrade.

| Tool | Monthly | Annual equivalent |
|---|---|---|
| YNAB | $14.99 | $179.88 |
| Copilot | $13.00 | $156.00 |
| Monarch | $14.99 | $179.88 |
| Acme Budget | $12.00 | $108.00 (saves $36) |
| Keeper | $16.00 | $192.00 |

## Revenue math at price

- 200 paid subs at $108/yr (modal plan) = $21,600 ARR
- 1,000 paid subs = $108,000 ARR
- 5,000 paid subs = $540,000 ARR

Gross margin after Plaid ($0.60/user/month), Stripe (2.9% + $0.30), and hosting lands around 78%. Contribution margin per user per year is ~$85.

## The 14-day trial

No credit card required. Users link a bank, see the tax-bucket allocation run for 2 weeks, then get a polite "your trial ends in 3 days, here's what you'd have set aside this month" email. Expected trial-to-paid conversion based on similar bank-linked products: 22-28%.

Reference: [First Round's pricing teardown](https://review.firstround.com/the-price-is-right-essential-tips-for-nailing-your-pricing) argues the strongest conversion moment is tied to the user seeing their own numbers, not to a timer.

## Annual upsell mechanics

After 30 days of active use, the app shows a one-line banner: "You'd save $36/year on annual. Switch." No modal, no popup, no gate. A single button. Based on [Stripe's own growth data on annual-plan conversion](https://stripe.com/resources/more/saas-pricing), a soft annual upsell after first value beats aggressive offers at signup by 3-4x.

## What Acme Budget doesn't charge extra for

- Multiple bank accounts
- Tax-bracket adjustment for state taxes
- CSV exports for the accountant
- Manual transaction entry

Those are all table stakes. Gating them makes the product feel cheap even at $12/mo.

## Refund policy

30-day no-questions-asked, processed through [Stripe](https://stripe.com/). Expected refund rate: under 4% based on YNAB's published numbers.
