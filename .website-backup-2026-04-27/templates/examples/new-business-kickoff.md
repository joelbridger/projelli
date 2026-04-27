# Acme Budget, Business Kickoff

## Vision

Freelancers in the US don't have a CFO. They have a Google Sheet, a guilty pile of unopened emails from their accountant, and a quarterly panic when taxes come due. Acme Budget is a personal finance app that thinks like a freelancer's brain: variable income, irregular invoicing, a permanent fear of the tax bill, and no time to categorize 800 transactions a month.

One year from now, Acme Budget will be the tool 10,000 US freelancers open every Sunday night to reconcile the week, set aside their quarterly tax estimate, and see exactly how long their current runway is.

## Problem

Existing personal finance apps were built for W-2 earners with predictable paychecks. [YNAB](https://www.ynab.com/), [Copilot](https://copilot.money/), and [Monarch](https://www.monarchmoney.com/) handle categorization fine, but none of them do the three things freelancers actually need:

1. Automatically set aside a running quarterly tax estimate as income hits the account.
2. Show a true "runway in weeks" number that factors in pending invoices and expected expenses.
3. Warn when spending is eating into next quarter's tax reserve.

The pain is acute. I interviewed 11 freelancers in March 2026. Every one of them had missed a quarterly tax payment in the last 24 months. Eight had taken on debt to cover a tax bill they'd mentally spent.

## Target customer

US-based solo freelancers earning $60K to $180K per year, 1-3 years into freelancing, with at least two concurrent clients and variable monthly invoicing. Designers, writers, developers, consultants. Not early-stage side hustlers. Not agencies with W-2 employees.

## Unique value

Acme Budget auto-allocates every dollar of freelance income into three buckets the moment it hits the connected account: tax reserve, emergency float, and spendable. The percentages are set once and adjust quarterly based on the user's actual effective tax rate from the previous year. No other freelance-focused tool does this auto-allocation.

## Revenue model

$12/month or $108/year, one tier, no freemium. Benchmarked against [Copilot](https://copilot.money/) at $13/month and [YNAB](https://www.ynab.com/) at $14.99/month. No free tier because the core loop (linking a bank via [Plaid](https://plaid.com/) and maintaining it) has real per-user cost.

## First 90 days

Week 1-4: finish Plaid integration + tax-bucket UI. Week 5-8: beta with 40 freelancers from a waitlist I'm building through Twitter and the [Freelancer's Union](https://www.freelancersunion.org/). Week 9-12: public launch via Product Hunt, Indie Hackers, and a Hacker News Show post. Target: 200 paid subscribers by day 90.

## Risks

Bank connection reliability. Plaid outages and rate limits bit YNAB hard in 2024. Mitigation: a manual CSV import path from day one, and status-page honesty when Plaid misbehaves.
