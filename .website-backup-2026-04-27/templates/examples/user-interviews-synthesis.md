# Acme Budget, User Interview Synthesis (10 transcripts)

## Themes

### 1. Every freelancer has a "tax account" that gets raided

**Frequency: 10 of 10 interviews**

Every person I talked to had a separate savings account where they intended to hold tax money. Every person had raided it at least once in the past 12 months. Three people had raided it within the last month.

Quotes:

- *"I know what I'm supposed to do. I just see $4K sitting there when the rent check bounces and I move it."*, Freelance developer, $112K/year
- *"My tax savings account is for emergencies. Every month becomes an emergency."*, Copywriter, $78K/year
- *"I moved $8,200 out of my tax account in October to cover a slow quarter. I still haven't put it back."*, Designer, $94K/year

### 2. Nobody knows their effective hourly rate

**Frequency: 10 of 10 interviews**

Zero of ten could tell me their blended hourly rate across active clients. Three said they'd calculated it once, years ago. Everyone said they wanted to know but didn't know how to compute it without a spreadsheet they weren't willing to build.

Quotes:

- *"I have three clients. I know what I charge each of them. I have no idea what I actually make per hour worked."*, Developer, $140K/year
- *"My cheapest client is probably costing me money when you count meetings, but I can't prove it."*, Designer, $84K/year

### 3. Bank balance checking is compulsive

**Frequency: 9 of 10 interviews**

Nine people reported checking their bank balance 4-6 times per day. The tenth said "maybe twice, but I also panic-check my accounting app three times a day," so it's really 10 of 10.

Quote: *"I check my balance before I buy lunch. Every time. I don't know what I'm looking for."*, Writer, $68K/year

## Contradictions

| Statement A | Statement B | Sources |
|---|---|---|
| "I want more automation, just do it for me." | "I don't want software moving my money." | 7 interviews, 3 interviews |
| "I'd pay $20/month for the right tool." | "I'm careful about recurring charges, I canceled 3 SaaS last month." | Same 4 people said both |
| "I trust Plaid, I use Venmo." | "I don't want to give an app my bank login." | 6 interviews (different people) |

The contradictions tell me: freelancers want automation of the *decision*, not of the *money movement*. Acme Budget already leans this way (we never move money, we just track the bucket allocation). This is a messaging opportunity more than a product opportunity.

## Jobs-to-be-done

| Job | Current solution | Friction |
|---|---|---|
| Know if I can afford to take a day off this month | Check bank app, do math in my head, feel uncertain | No forward-looking number exists |
| Avoid a surprise tax bill in April | "Tax savings" account that gets raided | No enforcement mechanism |
| See if a new client would be profitable | Eyeball it, say yes | No per-client P&L |
| File Schedule C without a weekend of receipts | Pay accountant, hope | Receipts scattered across 4 tools |
| Know when to slow down or push harder on work | Balance-check compulsion | No runway number |

## Killer quotes

1. *"I'm not bad with money. I'm bad at pretending my income is regular."*
2. *"The tool I want tells me one number on Sunday: am I okay this week or not."*
3. *"Every freelancer I know has the same exact tax account. Every single one of us raids it."*
4. *"I'd rather have an app that's strict with me than one that's polite."*
5. *"My accountant is the only adult in my financial life. That's a bad system."*

## Priority-ranked features

| Priority | Feature | Frequency | Urgency |
|---|---|---|---|
| 1 | Auto tax-bucket allocation on income events | 10/10 | Red, ships v1.0 |
| 2 | Runway view in weeks | 9/10 | Red, ships v1.0 |
| 3 | Sunday review email, one number at top | 8/10 | Red, ships v1.0 |
| 4 | Profit-by-client view | 10/10 wanted, 3/10 pain-level | Amber, v1.1 |
| 5 | Quarterly tax reminder 14 days out | 7/10 | Red, ships v1.0 |
| 6 | State-tax handling beyond CA / NY | 6/10 | Amber, v1.0 for 7 states, v1.1 for all 50 |
| 7 | CSV export for accountant | 10/10 | Red, ships v1.0 |
| 8 | Receipt scanning | 4/10 | Gray, defer indefinitely, Keeper does it better |
| 9 | Invoicing | 2/10 | Gray, never |

## Decision implications

1. **Ship v1.0 as scoped.** The seven "red" features are exactly what v1.0 covers. No scope change.
2. **Profit-by-client is the first v1.1 bet.** Every interview raised it, even if only 3 of 10 called it urgent.
3. **Messaging: "we never move your money."** Lead with this on the landing page to defuse the trust objection.
4. **Cut receipt scanning forever.** Keeper does it better and [the interview data](/blog/picking-the-15-founder-templates) says my users won't miss it.
