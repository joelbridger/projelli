# 06: Measurement and Cadence

_Last reviewed: 2026-04-27_
_Status: Plan. Reviews start the week the launch goes live._

The strategy in `00-master-strategy.md` only works if we look at the right numbers on the right cadence and act on them. This doc defines what we measure, when we look at it, what counts as "winning by month X", and the triggers that cause us to redirect or abort a tactic.

The purpose of measurement is not reporting. It's decision-making. Every metric here exists because it changes a decision. Anything that doesn't change a decision is removed from this doc.

---

## 1. The metrics hierarchy

Four tiers of metrics, ranked by how directly they answer "are we winning."

### Tier 1: Outcome metrics (the only ones that ultimately matter)

| Metric | Year-1 target | Where measured |
|---|---|---|
| **Monthly gross revenue** | $10K by month 12, sustained 60 days | LemonSqueezy dashboard |
| **Cumulative gross revenue** | $40-$60K by month 12 | LemonSqueezy |
| **Total paying customers** | 600-1,200 by month 12 | LemonSqueezy |
| **Refund rate** | <8% | LemonSqueezy |

These are reviewed monthly. They are the ones we're optimizing for.

### Tier 2: Lagging metrics (tell us if Tier 1 will be hit)

| Metric | Year-1 target | Where measured |
|---|---|---|
| **Free → Pro conversion** | 3-7% within 90 days | LS + email cohort |
| **Pro → Lifetime upgrade** | 15-25% within 12 months | LS dashboard |
| **Email signup → buy conversion** | 2-5% within 60 days | Brevo + LS UTM |
| **Repeat-channel-attribution conversion** | Tracked per channel | Plausible + UTM logs |
| **Testimonial response rate** | 8-15% of buyers | Manual log |
| **NPS (asked at day 30)** | 40+ | Day-30 email survey |

Reviewed monthly. If Tier 2 numbers slip, Tier 1 will follow within 2-3 months.

### Tier 3: Leading metrics (tell us if Tier 2 will be hit)

| Metric | Year-1 target | Where measured |
|---|---|---|
| **Monthly unique visitors to projelli.com** | 20K+ by month 12 | Plausible |
| **Pages indexed in Google** | 30-40 | Google Search Console |
| **Top-3 ranking queries** | 8-12 | GSC |
| **Top-10 ranking queries** | 25-40 | GSC |
| **Email list size** | 2,000-5,000 by month 12 | Brevo |
| **AI search citations** | 4-6 of priority queries | Manual quarterly check |
| **Backlinks (referring domains)** | 100+ by month 12 | Free tools (Ahrefs Backlink Checker free, OpenLinkProfiler) |
| **Brand searches per month** | 1,000+ by month 12 | GSC + Plausible |

Reviewed monthly for a delta, quarterly for trend.

### Tier 4: Vanity metrics (we look at these but they don't drive decisions)

- PH upvotes, HN points, X followers, GitHub stars, IH karma
- These are sanity checks, not decision-makers. We never optimize content for them.

---

## 2. Weekly review (15 minutes, every Sunday)

The lightest cadence. Just enough to stay on top of what's happening without becoming the work.

### What we look at

1. **Revenue** (LS dashboard): this week vs last week
2. **Email signups** (Brevo): this week vs last week
3. **Plausible top pages**: any unusual traffic spike?
4. **Refunds**: any new this week? Reasons?
5. **Open support emails**: any unanswered > 24 hours? Reply.
6. **Open community threads**: any new HN, PH, Reddit, IH activity? Reply.

### What we decide

- Anything in the weekly review that's anomalous (revenue dipped 30%, refund spike, support email backlog) becomes a task in `~/projelli/BACKLOG.md` for the week ahead.
- The weekly review doesn't change the strategy. It just keeps the operations clean.

Stored at: `~/projelli/sign-ups/weekly-review-YYYY-MM-DD.md` (one file per week, gitignored).

---

## 3. Monthly review (60 minutes, first Monday of each month)

The heavier cadence. This is where strategy gets adjusted.

### Agenda (in order)

#### Part 1: Numbers (15 min)
- All Tier 1 outcome metrics for the month
- All Tier 2 lagging metrics for the month
- All Tier 3 leading metrics for the month
- Year-to-date trajectory vs $10K-by-month-12 plan

#### Part 2: What worked (10 min)
- Top 3 traffic sources this month
- Top 3 content pieces by visitor count
- Top 3 content pieces by buyer-conversion-attributed
- Any single channel producing >50% of revenue (concentration risk)

#### Part 3: What didn't work (10 min)
- Any tactic running at <0.5x ROI (newsletter, ads, content, partnership)
- Any drafted content unpublished due to bottleneck
- Any goal slipped (SEO content cadence, email cadence, etc.)

#### Part 4: Decisions (15 min)
- For each item in part 3: continue, kill, fix
- Adjust next month's allocation of Jameson's hours
- Update `~/projelli/BACKLOG.md` for the next 4 weeks

#### Part 5: Strategy check (10 min)
- Are we on the path described in `00-master-strategy.md`?
- Any abort/redirect trigger hit (see section 5)?
- Any new market signal worth noting?

### Output artifacts

- A monthly review doc at `~/projelli/docs/marketing/reviews/YYYY-MM-review.md` with:
  - Headline numbers
  - 3 bullet points of what worked
  - 3 bullet points of what didn't
  - 3-5 decisions made
  - One paragraph of "what we're betting on next month"

This doc gets committed to the repo (sanitized, no buyer-personal info). Future Claude sessions read it to stay current.

### Who runs it

Claude prepares the numbers and a draft analysis. Jameson reviews, makes the calls, signs off. 60 minutes is the budget; it should not exceed 90.

---

## 4. Quarterly retrospective (2 hours, end of each quarter)

The deepest cadence. Once every 3 months we step back and look at the full picture.

### Agenda

#### Numbers retrospective (30 min)
- Quarter-over-quarter on every Tier 1 and Tier 2 metric
- Which channels grew, which plateaued, which collapsed
- Cumulative revenue trajectory vs plan

#### Content retrospective (20 min)
- Of the pages we shipped, which are ranking? Which aren't?
- Refresh priority list for the upcoming quarter
- New page priority list

#### Buyer retrospective (20 min)
- Read the testimonials and refund reasons from the quarter
- What stories are buyers telling? Update vs-pages and use-case pages around the strongest stories
- Update the day-30 email survey questions if any are no longer informative

#### Channel retrospective (20 min)
- Newsletter sponsorships: which were profitable?
- Integrations: any in-flight? Any to add?
- Podcast circuit: any pitches outstanding? Any landed?
- Personal brand: how many real-name Projelli posts went out (target: 3-6 per quarter)?

#### Strategy revisit (30 min)
- Is `00-master-strategy.md` still right?
- Any of the 7 explicit non-goals still right?
- Any of the 5 message pillars not earning their keep?
- Update `00-master-strategy.md` if anything changed materially

### Output artifact

A quarterly review doc at `~/projelli/docs/marketing/reviews/YYYY-QN-retrospective.md`. Committed to repo. Around 1,500 words. Includes:
- Headline narrative for the quarter
- Most important decision made
- Most important thing learned
- One thing we'd do differently
- Plan for the upcoming quarter

---

## 5. Abort and redirect triggers

These are the explicit conditions under which we change course. Not soft suggestions, hard rules.

### Trigger 1: Revenue 50% under plan at month 3

Plan: $1,000-$2,000 cumulative by end of month 3.
Trigger: less than $500-$1,000 cumulative at end of month 3.

If hit:
- Pause SEO content cadence (do not invest more hours into a strategy that hasn't earned its first signal)
- Spend 2 weeks doing customer-development calls with the buyers we do have
- Re-examine ICP, pricing, and message pillars in `00-master-strategy.md`
- Make at most ONE major change (don't shotgun)
- Resume normal cadence with the change in place

### Trigger 2: Single channel produces >70% of revenue for 2 consecutive months

If a single channel becomes our entire pipeline, that's existential risk. Whether it's PH, HN, SEO, a single newsletter, or anything else.

If hit:
- Quarterly review pulls forward to address it
- Spend the next month explicitly diversifying (additional channels)
- Do not stop doing the working channel; just balance

### Trigger 3: Refund rate >12% for 2 consecutive months

That's twice the target. Indicates either pricing is wrong, the product is failing buyers, or the marketing is misleading.

If hit:
- Read all refund reasons from the period
- Identify the dominant theme
- One product or marketing change in response
- Re-measure for 30 days

### Trigger 4: Zero AI-search citations at month 9

If by month 9, no priority query causes ChatGPT, Claude, or Perplexity to mention Projelli, the AI-citation strategy in `01-seo-engine.md` is failing.

If hit:
- Quarterly review pulls forward
- Read recent literature on AI search optimization (the field will have moved)
- One major change to `/llms.txt`, citation surfaces, or content structure
- Re-measure 60 days later

### Trigger 5: Wheel Health expresses concern

If Wheel Health signals any discomfort with Projelli's public presence, the kill switch in `05-personal-brand-binding.md` activates immediately. No discussion.

### Trigger 6: A buyer or third party threatens legal action

If any cease-and-desist, trademark dispute, or similar surfaces:
- Do not respond directly
- Pause any related content
- Consult per `~/financial/07-legal-and-ip/legal-overview.md`
- Update strategy after legal counsel

### Trigger 7: Jameson's available time drops below 5 hr/wk for 4+ weeks

If life or job pressure squeezes Projelli's hours, the strategy itself is the problem (not the execution). Recalibrate.

If hit:
- Skip a month of new content, prioritize maintenance
- Pause any in-flight partnership pitches
- Skip any quarterly podcast push
- Honor existing buyer support
- Resume full cadence when hours recover

### What we do NOT treat as a trigger

- A single bad week
- Slow SEO traction in months 2-4 (this is expected)
- Any single critical comment on PH/HN/Reddit
- A competitor launching something new (we have a competitive landscape doc; we update it; we don't pivot)
- A bad day's revenue numbers

The abort triggers are intentionally narrow. Most "bad months" are noise. Reacting to noise is more dangerous than ignoring it.

---

## 6. Monthly targets in detail

Concrete checkpoints. Reviewed in the monthly retro.

### Month 1 (launch month)
- Cumulative revenue: $500-$1,500
- Total customers: 15-40
- Email signups: 300-800 (mostly from launch week)
- SEO pages live: 6-9
- Refund rate: <10% (higher than steady-state because launch buyers are less qualified)

### Month 2
- MRR equivalent: $400-$1,000 (steady-state launch buyers)
- Cumulative: $1,000-$2,500
- Email signups: 500-1,200 cumulative
- SEO pages live: 12-16
- Day-30 testimonial responses: 5-10 (from month-1 buyers)

### Month 3
- MRR equivalent: $700-$1,500
- Cumulative: $1,500-$4,000
- Email signups: 800-1,800 cumulative
- SEO pages live: 18-22
- First M3 milestone hit: $5K cumulative (first paid newsletter becomes available)

### Month 4-5
- MRR equivalent: $1,500-$3,500
- Cumulative: $3,000-$10,000
- First newsletter sponsorship test placed (PETIT or IH Weekly)
- First Raycast extension shipped
- SEO pages live: 24-28

### Month 6
- MRR equivalent: $2,500-$5,000
- Cumulative: $7,000-$18,000
- 8-10 vs-pages live
- First major SEO inbound traffic measurable
- Day-30 NPS: 40+

### Month 7-9
- MRR equivalent: $4,000-$7,000
- Cumulative: $20,000-$40,000
- Affiliate program live
- 3-5 podcast appearances landed
- Obsidian importer shipping or shipped
- AI search citations on 2-4 priority queries

### Month 10-12
- MRR equivalent: $7,000-$10,000+
- Cumulative: $40,000-$80,000
- Year-1 review and 2027 plan
- First lapsed-user re-engagement email sent

If we're tracking 50%+ to these targets through month 6, we are winning. If we're at 20% or less by month 6, we hit Trigger 1 and rework.

---

## 7. Where the data lives

Every metric has a single source of truth. Decisions are made from these sources.

| Data | Source | Freshness |
|---|---|---|
| Revenue, customers, refunds | LemonSqueezy dashboard | Real-time |
| Website traffic, conversion goals | Plausible (analytics.jamesondaines.com) | Real-time |
| Search rankings, indexed pages | Google Search Console | 24-48 hr lag |
| Email metrics | Brevo dashboard | Real-time |
| Form-handler signups | `~/projelli/sign-ups/` (gitignored) | Real-time |
| Testimonials | `~/projelli/sign-ups/testimonials.csv` | Manual |
| Newsletter ROI | `~/projelli/sign-ups/newsletter-roi.csv` | Manual |
| Backlinks log | `~/projelli/sign-ups/launch-backlinks.csv` | Manual at events |
| Refund log | `~/projelli/sign-ups/refunds.csv` | Manual |
| AI search citations | `~/projelli/sign-ups/ai-search-citations.csv` | Quarterly check |
| Monthly review docs | `~/projelli/docs/marketing/reviews/` | Monthly |

The `sign-ups/` directory is gitignored because some files have buyer-personal information. We never commit those. The `reviews/` directory is committed (with personal info redacted) so future Claude sessions can read prior context.

---

## 8. Roles in the cadence

| Role | Owner | Time per month |
|---|---|---|
| Pull weekly numbers | Claude | 30 min total |
| Reply to community threads | Brand account (Jameson via batch) | 1-2 hr |
| Reply to support emails | Jameson (Claude can draft) | 1-2 hr |
| Monthly review prep | Claude | 30 min |
| Monthly review meeting | Jameson + Claude | 60 min |
| Quarterly retrospective | Jameson + Claude | 2 hr |
| Update strategy docs as needed | Claude | varies |
| Drafting next month's content | Claude | 4-8 hr (front-loaded Q1) |
| Reviewing drafts | Jameson | 1-2 hr |

Total Jameson time on measurement and review: about 4-5 hours per month. This sits inside the 5-10 hr/week ceiling alongside content review, real-name posts, and buyer support.

---

## 9. The single sentence we test every month

At the start of every monthly review, we ask:

> **Is Projelli closer to being the answer when an indie founder asks "what's a local-first AI workspace I can actually buy and own", than it was last month?**

If yes, we're winning, regardless of the specific revenue number that month.
If no, the strategy needs adjustment, regardless of the specific revenue number that month.

This is the test from `00-master-strategy.md` operationalized. It cuts through noise on slow months and complacency on fast months.

---

## 10. References

- `00-master-strategy.md`: what we're measuring against
- `01-seo-engine.md`: Tier 3 leading metrics live here
- `03-partnership-spikes.md`: newsletter ROI tracking
- `04-retention-and-wom.md`: Tier 2 retention metrics
- `~/projelli/docs/marketing/playbook/MARKETING_PLAYBOOK.md`: channel-level execution
- `~/projelli/sign-ups/`: gitignored data store
