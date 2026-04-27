# Acme Budget, MVP Scope

## The rule

If a feature doesn't directly reduce the chance that Alex (our ICP freelancer) is surprised by a tax bill, it's cut from v1.0.

## What ships in v1.0

### In scope

1. **Bank connection via [Plaid](https://plaid.com/)** (Chase, Bank of America, Wells Fargo, Ally, Capital One, Mercury, Relay to start). Manual CSV import as fallback for banks not on Plaid day-one.
2. **Auto-bucket allocation** when income hits. Three buckets: Tax Reserve (user-set %, suggested 28%), Emergency Float (user-set %, suggested 10%), Spendable (remainder).
3. **The runway view.** One number: "If you invoice nothing new starting today, you have X weeks of coverage at your average monthly burn."
4. **Sunday review email.** Every Sunday at 7 PM local time, one email with 4 numbers: income this week, tax set-aside this week, runway, and one anomaly if any.
5. **Quarterly tax reminder.** 14 days before the April, June, September, and January deadlines. One email, one in-app banner.
6. **Transaction categorization** (just the 12 freelance-relevant categories, not the 60+ Mint ships). Auto-learned from the first 30 days.
7. **CSV export** for the accountant.

### Out of scope for v1.0

1. Invoicing. Freelancers already use [Harvest](https://www.getharvest.com/), [Bonsai](https://www.hellobonsai.com/), or [Stripe Invoicing](https://stripe.com/invoicing). I'm not winning this battle.
2. Receipt scanning. Adds 3 weeks of work and [Keeper](https://www.keepertax.com/) does it better.
3. A mobile app. The desktop web app is the whole product for year one.
4. Investments or retirement accounts.
5. Business entity support (S-corp, LLC tax optimization). v2 maybe.
6. Multi-user / spouse access.
7. Any AI chat surface. The product is opinionated allocation, not a copilot.

## What ships in v1.1 (first 90 days post-launch)

Based on what the first 200 users actually ask for:

- State-tax handling beyond the 7 largest-freelancer states in v1
- A second savings-goal bucket (often requested: house down payment, self-employed 401k)
- Profit-by-client view (the "am I underpricing this client?" question)

Everything else gets a polite "v2."

## What's in the cut list forever

- Net worth tracking
- Credit score monitoring
- Investment recommendations
- Crypto support
- Anything that requires the word "budget" in a UI label (Alex's interview feedback was clear: the word "budget" made them feel like a teenager getting a lecture)

## The done-by dates

| Date | Milestone |
|---|---|
| Week 4 | Plaid + auto-bucket working for my own accounts |
| Week 6 | Sunday email cron + quarterly tax reminders |
| Week 8 | 10 private beta users using it for real |
| Week 10 | CSV export, runway view polished |
| Week 11 | Pricing page, [LemonSqueezy](https://www.lemonsqueezy.com/) checkout live |
| Week 12 | Public launch on Product Hunt |

## The "if this breaks, we hold" list

If any of these are not working the Friday before launch, the launch moves:

1. Auto-bucket allocation idempotency across Plaid webhook retries
2. 2FA / SMS recovery flow
3. CSV export rounding consistency with IRS Schedule C line items

Everything else can be hot-patched in the first 72 hours after launch.
