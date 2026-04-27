# Acme Budget, Financial Model

## The one-page summary

- **ARR target, year 1:** $120,000
- **Paid users at year-end:** 1,100
- **Gross margin:** 78%
- **Contribution margin per user per year:** $85
- **Personal runway required:** 14 months
- **Breakeven month (if I want to match current salary of $92K):** month 18 at ~2,800 paid users
- **Fundraising plan:** none year one, $800K pre-seed option in year two

## The monthly revenue ramp

Baseline assumption: 22% trial-to-paid conversion (Plaid-powered B2C benchmark), 3.4% monthly churn (aggressive for B2C finance at this price point).

| Month | Trial starts | New paid | Churn | Net paid | MRR | Notes |
|---|---|---|---|---|---|---|
| 1 | 120 | 26 | 0 | 26 | $312 | Beta converts |
| 2 | 180 | 40 | 1 | 65 | $780 | First SEO hits |
| 3 | 260 | 57 | 2 | 120 | $1,440 | Product Hunt |
| 4 | 220 | 48 | 4 | 164 | $1,968 | SEO compounding |
| 5 | 300 | 66 | 6 | 224 | $2,688 | Accountant partners |
| 6 | 360 | 79 | 8 | 295 | $3,540 | End Q2 |
| 9 | 480 | 106 | 18 | 580 | $6,960 | |
| 12 | 600 | 132 | 33 | 1,100 | $13,200 | $158K ARR |

## Cost structure

Fixed monthly costs:

- [Plaid](https://plaid.com/) production: $500 base + $0.60/active user
- [Vercel](https://vercel.com/) hosting: $20/mo for year one
- [Supabase](https://supabase.com/) Pro: $25/mo
- [Buttondown](https://buttondown.com/) newsletter: $9/mo
- [Stripe](https://stripe.com/) processing: 2.9% + $0.30 per transaction
- [Postmark](https://postmarkapp.com/) transactional email: $15/mo for first 10K emails
- Domain, DNS, misc: $20/mo

**Fixed overhead excluding Plaid per-user:** ~$589/month, or ~$7,068/year.

Variable cost per paid user per year:

- Plaid per-user: $7.20
- Stripe fees on $108 annual: $3.43
- Email volume: negligible
- Support time: priced out at 4 minutes/user/year @ $50/hr = $3.33

**Total variable cost per paid user per year: ~$14.** Revenue per user per year (blended monthly + annual mix): $99. Contribution margin: ~$85 per paid user per year.

## Breakeven scenarios

Maya needs $7,700/month to cover personal expenses. To hit $92K/year net after taxes, Acme Budget needs to be throwing off ~$11,500/month gross (accounting for self-employment tax).

- **To match salary:** ~2,800 paid users at blended $4.10 monthly contribution = month 18 at current growth rate.
- **To cover bare expenses only:** ~1,600 paid users = month 13.
- **To go full-time with zero safety margin:** ~1,200 paid users = month 11.

## Personal runway

Maya is leaving [Ramp](https://ramp.com/) with $82,000 in savings. At $4,800/month personal burn (SF rent + health insurance + food), that's 17 months of runway. I'm targeting 14 months to hit breakeven with a 3-month safety buffer.

## Sensitivity table

Two variables matter most: trial-to-paid conversion and monthly churn. At 18% conversion + 4% churn, ARR at month 12 drops to $94K. At 26% + 2.5% churn, it rises to $180K. The model is sensitive.

| | 18% conv | 22% conv | 26% conv |
|---|---|---|---|
| 4.5% churn | $84K | $102K | $120K |
| 3.4% churn | $98K | **$120K** | $142K |
| 2.5% churn | $115K | $140K | $165K |

## What's not in this model

- Any paid acquisition channel
- Enterprise or team plans
- International expansion
- An iOS app (adds cost without a clear ARR multiplier in year one)
- Raising capital (treated as optional)

## The one decision this model forces

If Acme Budget is below $5K MRR at month 6, I have to either change something big or go back to full-time work. The model does not support a slow-burn year two on savings alone.
