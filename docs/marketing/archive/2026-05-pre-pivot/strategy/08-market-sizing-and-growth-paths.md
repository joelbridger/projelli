# 08: Market Sizing + Growth Paths

_Written: 2026-04-29 by Claude (CEO mode), in response to Jameson's question: "is there enough indie founder market to actually make $5-10K/month consistently?"_
_Re-review: monthly through month 6, then quarterly. The numbers below are estimates with stated confidence intervals. Update as actual data comes in._

This document does two things:

1. Honest evaluation of whether the indie founder ICP can sustain $5-10K MRR (the strategy goal)
2. Modeling of a "wide market" scenario (Jameson's hypothetical: "anyone semi-digitally savvy with projects in their lives")

The goal is to give the board a real probabilistic answer, not optimism or doom.

---

## 1. The TAM question for indie founders

### Pool sizes (estimated, mid-2026)

| Pool | Size estimate | Source / reasoning |
|---|---|---|
| Global English-speaking solopreneurs in software / tech-adjacent | ~500K-1M | IndieHackers 250K registered + Pieter Levels ecosystem ~50K + Tauri/dev community ~100K + adjacents |
| Already paying $20-50/month for productivity SaaS | ~200K-400K | Subset of above who have demonstrated willingness to pay for tools |
| Actively shopping for an AI workspace right now | ~50K-100K | Subset who have hit the friction point that makes them search for "Notion AI alternative" or "AI notes app" |
| Privacy-leaning / local-first interested subset | ~10K-30K | The smaller bucket who specifically reject cloud-only options |
| **Active monthly addressable (Engine 1 reachable via SEO + AI search)** | **~50K-100K** | The realistic monthly pool we can show up in front of, ~10-50% growth/year as AI category matures |

**Confidence:** medium. These numbers are extrapolated from public IndieHackers stats, GitHub topic tags, NomadList membership, and indie-tool launch signal data. Margin of error: probably ±50% on any single number, smaller in aggregate.

### Math for $10K MRR

Projelli's pricing means each customer is worth $49 (Pro), $99 (Lifetime), or $29 (Founder's). One-time, not recurring. So MRR is NEW SALES per month, not retained subscriptions.

| Avg sale price | New buyers needed for $10K/mo | New buyers/year |
|---|---|---|
| $49 (Pro-heavy mix) | ~204 | ~2,448 |
| $74 (50/50 Pro/Lifetime mix) | ~135 | ~1,620 |
| $99 (Lifetime-heavy mix) | ~101 | ~1,212 |

**Realistic mid-case: ~150/month, ~1,800/year.**

### Capture rate against TAM

If the active monthly addressable is 50,000-100,000 visitors:

- 150/month buyers ÷ 50,000 visitors = **0.3% close rate**
- 150/month buyers ÷ 100,000 visitors = **0.15% close rate**

Indie tool benchmarks:

| Tool category | Typical visit-to-paid rate |
|---|---|
| Free trial → paid conversion | 1-5% |
| Direct visitor-to-paid (no trial gate) | 0.3-1.5% |
| Paid ad funnel | 0.05-0.5% |

**Verdict:** 0.15-0.3% is at or below the median for indie SaaS. Achievable, not requiring outlier execution.

### Comparables that have hit similar revenue

These are public-data indie tools in adjacent categories that hit $5-10K+ MRR with similar TAM constraints:

| Tool | Category | Pricing | Reported revenue range | Notes |
|---|---|---|---|---|
| Logseq | Local-first notes | Free OSS + Pro $5/mo | $30-100K MRR (2024) | Smaller TAM than Projelli's |
| Reflect.app | Cloud AI notes | $10-15/mo | $50K MRR (2022 peak) | Similar features, different data model |
| Heptabase | Visual notes | $99-180/yr | $30-100K MRR per founder reports | Indie founder bootstrapped |
| Things 3 | Task manager | $50 one-time | Multi-million $/yr | One-time pricing comparable |
| Bear | Notes | $30/yr | Multi-million $/yr | Mac-focused |
| Obsidian | Knowledge base | Free + $50 commercial + $96/yr sync | Multi-million $/yr | Largest local-first comparable |
| Notesnook | Encrypted notes | $50/yr | Reported $300-500K ARR | Privacy-first niche |

**The pattern:** indie tools that hit $5-10K MRR in similar categories all share three traits:
1. A sharp differentiator (local-first, encryption, visual, AI-native, etc.)
2. A clear ICP they don't apologize for
3. Distribution that doesn't require huge ad spend

Projelli has all three. The TAM math works. The probability of success depends on execution.

---

## 2. Honest probability assessment

These numbers are subjective estimates based on the data above + general indie-launch base rates. Recalibrate at month 3 and month 6 with actual data.

| Outcome by month 12 | Probability | What it requires |
|---|---|---|
| **$10K MRR sustained 60 days** (strategy goal) | **30-40%** | Hard launch hits target + SEO compounds + 1-2 viral moments + integrations land |
| **$5K MRR sustained 30 days** (strategy floor) | **50-60%** | Hard launch hits target + SEO partially compounds + steady organic |
| **$1-2K MRR sustained 30 days** (the "side project that earns" outcome) | **75-85%** | Hard launch produces 30+ buyers + ongoing distribution work |
| **<$500/mo at month 12 (functional failure)** | **15-25%** | Multiple things go wrong: weak launch + SEO doesn't compound + no viral moments |

**Read these honestly.** The strategy goal is achievable but not the modal outcome. The most likely outcome is somewhere between the floor and the goal — call it $3-5K MRR by month 12. That's still a significant outcome (~$36-60K annual revenue from a side project with ~5-10 hr/week budget and a high-margin product).

### What would push the probability up

Things we control:
- Beta cohort of 5+ producing strong launch-day comments (~+5pp)
- PH hunter confirmed (vs self-hunt) (~+5pp on launch)
- One newsletter with 50K+ subscribers picks Projelli for a feature (~+10pp)
- v1.7.x post-launch updates produce a real "build in public" arc (~+5pp ongoing)
- SEO content compounds as projected (~+10pp by month 6)

Things we don't control:
- A viral tweet from a high-trust founder (~+15pp if it lands)
- A category-shifting event (Notion AI raises prices, OpenAI gets a privacy scandal, etc.) (~+10pp situationally)
- A high-traffic blog (Tom MacWright, Andrej Karpathy adjacents) writes about local-first AI (~+5-10pp)

### What would push the probability down

Things we control (anti-patterns):
- Pivoting strategy after one bad week (~-15pp; biggest self-inflicted risk)
- Launching with broken installer / bad website ship (~-15pp)
- Skipping beta cohort, weak launch comments (~-10pp)
- Adding subscription tier or cloud sync (~-10pp; signal dilution)

Things we don't control:
- A funded competitor launches an obvious clone in our window (~-10pp)
- Apple notarization breaks during launch week (~-5pp)
- Wheel Health time pressure spikes (Jameson <5 hr/wk for 4+ weeks) (~-15pp)

---

## 3. The wide-market scenario

Jameson's question: what if we made Projelli widely available — anyone semi-digitally savvy with projects in their lives, not just indie founders?

### TAM at wider scope

| Pool | Size estimate | Notes |
|---|---|---|
| Global English-speaking knowledge workers using AI regularly | ~50M-100M | OpenAI claims 500M+ monthly ChatGPT users; ~10-20% in English-speaking markets active enough to pay |
| Paying for ChatGPT Plus / Claude Pro / Gemini Advanced ($20/mo) | ~10-20M | Estimated based on OpenAI public revenue numbers |
| "Has personal projects, uses AI for them, semi-tech-savvy" | ~5-15M | Consultants, freelancers, students, side-project people, knowledge workers with personal initiatives |
| **Realistically reachable via mass-market channels** | **~1-5M/month visitor pool** | If we showed up for "ChatGPT alternative", "AI notes app", "AI assistant for projects" search terms |

**That's 50-100x the indie founder TAM.**

### Math at wider scope

But conversion drops drastically when the audience widens:

| Audience | Visitor-to-paid rate |
|---|---|
| Indie founder ICP (current) | 0.15-0.3% (estimated) |
| Wide prosumer market | 0.01-0.1% (typical for broad B2C tool) |

At the wide-market conversion floor (0.01%):
- 1M monthly visitors × 0.01% = **100 buyers/month**
- 100 × $49 = **$4,900/month** (similar to current narrow plan)

At the wide-market conversion mid (0.05%):
- 1M monthly visitors × 0.05% = **500 buyers/month**
- 500 × $49 = **$24,500/month** (~$300K/year)

At the wide-market conversion ceiling (0.1%):
- 5M monthly visitors × 0.1% = **5,000 buyers/month**
- 5,000 × $49 = **$245,000/month** (~$3M/year)

**The numbers look enormous.** But there's a catch.

### Why the wide-market scenario is harder than it looks

**1. Distribution requires VC-scale spend or VC-scale time.**

To get 1-5M monthly visitors as an indie tool:
- Either: spend $50-200K/month on ads and content (we don't have budget)
- Or: rank #1 on broad keywords like "ChatGPT alternative" (competing with Anthropic, OpenAI clones, Notion, etc. — they have 100x our resources and 5-year head starts)
- Or: a category-defining viral moment (unpredictable, can't strategy-plan)

**Indie tools at our budget cap out at ~50K-200K monthly organic visitors at 12-month mark.** Even Logseq and Obsidian, which have 6-10 years of compounding SEO, are in the 100-500K monthly range.

**2. Product-market fit narrows when audience widens.**

The casual AI user (semi-tech-savvy, paying $20/mo for ChatGPT) actually doesn't want most of what Projelli offers:
- BYOK setup is friction they don't want (they pay $20/mo precisely to NOT manage API keys)
- Local files on disk is a feature for power users, but for casual users it's "where did my chats go?"
- 15 founder workflow templates are irrelevant to most casual users
- The pricing model ($49 one-time) is HIGHER than ChatGPT Plus monthly ($20) and looks expensive even though it's cheaper over time

**The very thing that makes Projelli sharply differentiated for indie founders makes it weakly differentiated for the wide market.**

**3. Competition changes shape.**

- Indie founder market: ~10 direct competitors, none perfect fit, room to win
- Wide market: 200+ "AI notes" / "AI workspace" tools, includes Notion, Microsoft Copilot, Google Gemini integration, Apple Intelligence, ChatGPT itself
- The wide market has been served by giants for 18+ months
- An indie tool entering the wide market with no marketing budget gets lost in noise

**4. The pricing model would need to change.**

To capture wide-market casual users, you'd probably need:
- A $9/mo subscription tier (cancels the "sold once" pillar)
- Or a managed-API tier that handles the billing for them (cancels the BYOK pillar)
- Or both

**That's not a marketing pivot, it's a product pivot, AND it cancels two of the five message pillars** (`strategy/00-master-strategy.md` § 3). It's a different product.

### So can we ever reach the wide market?

Yes — but as a **graduation, not a pivot**. The natural path:

| Phase | Year | Scope | Key move |
|---|---|---|---|
| Phase A | Year 1 | Indie founders, narrow ICP | Current strategy. Build SEO foundation, earn 100-300 paying customers, validate the wedge. |
| Phase B | Year 2 | Indie founders + adjacent ICPs (solo consultants, freelancers, side-project builders) | Expand templates beyond founder-only. Add 1-2 case-study-style blog posts per non-founder use case. Don't change pricing. |
| Phase C | Year 3+ | Prosumer (anyone with serious AI projects) | Consider adding a managed-API tier for non-technical buyers. Newsletter sponsorships at scale. Integration partnerships (Notion-importer, ChatGPT-importer for migrations). Maybe a $9/mo tier (board decision required). |
| Phase D | Year 4+ | Mass market (if applicable) | Strategic partnership / acquisition path / international expansion. Or stay deliberately niche. |

**The pattern (Notion did exactly this):** Notion launched 2016 to "knowledge workers", expanded 2018 to "small teams", expanded 2020 to "all teams + AI features", reached "anyone with a digital project" in 2022-23. The mass-market positioning came after 6 years of compounding from a narrow ICP.

**Cursor did it too:** developers first (2022), then expanded via partnerships and integrations (2023-2024), now a $9B valuation aimed at "all knowledge workers using code-adjacent AI" (2025).

**Same pattern for Projelli, on a longer timeline because we don't have VC fuel.** Year 1-2 is establishment. Year 3+ is expansion (if Year 1-2 worked).

---

## 4. The honest recommendation

**Stay narrow for Year 1.** Three reasons:

1. **It's the only viable path with 5-10 hr/week.** Wide-market distribution requires money or time we don't have. Narrow distribution is reachable in our budget.

2. **The narrow ICP is the platform for the wide market.** Notion, Obsidian, Cursor, Roam — every successful "AI workspace" started narrow and graduated. Skipping the establishment phase is the indie founder version of "we'll build the bridge while flying over it." It usually crashes.

3. **The math works at narrow.** Even with conservative conversion estimates against a 50K-100K monthly TAM, $5K MRR is the median outcome and $10K MRR is the ceiling. That's a real outcome that doesn't require wide-market success.

**Plan to evaluate broadening at month 12.** Concrete decision points:

- Has Engine 1 (SEO) compounded as projected? If yes, the wide-market expansion is supported by a foundation. If no, broadening is premature.
- Are we hearing organic non-founder testimonials from buyers? "I'm a researcher and I love this" is the signal that the wide market wants the product.
- What's the refund rate from non-founder buyers vs founder buyers? Lower refund rate = product-market fit at the wider scope.

**What we will NOT do in Year 1:**

- Add a subscription tier (compromises "sold once" pillar)
- Add cloud sync (compromises local-first pillar)
- Add managed-API mode (compromises BYOK pillar)
- Pivot positioning to "AI for everyone" (compromises 4 of 5 pillars)
- Spend on broad-market ads (anti-pattern #8)

**What we COULD do in Year 1 to leave the door open:**

- Continue the universal product story (Option B) on the homepage — already done
- Allow non-founder testimonials to surface organically if they happen
- Track the source-of-purchase data carefully (founder vs non-founder breakdown)
- Don't add any verticalization (Projelli for therapists / writers / etc.) — keeps positioning intact for Year 2+ broadening

---

## 5. The honest summary

> **Q: Is there enough indie founder market to make $5-10K/month consistently?**
>
> **A: Yes, with execution. Probability: ~30-40% for the $10K target by month 12, ~50-60% for the $5K floor, ~75-85% for $1-2K. The most likely outcome is $3-5K MRR by month 12. The TAM math works; success depends on execution and timing.**

> **Q: Could we ever go wide and capture more market?**
>
> **A: Yes, but as a graduation in Year 2-3, not a pivot in Year 1. The narrow ICP IS the platform for the wide market. Notion, Cursor, Obsidian, Roam — all followed this exact pattern. Trying to skip the establishment phase is what kills indie tools.**

> **Q: What's the floor outcome if everything goes worse than planned?**
>
> **A: ~15-25% probability of <$500/mo at month 12 (functional failure). The downside is bounded because the financial floor (Wheel Health) doesn't depend on Projelli succeeding. Patience is structurally affordable.**

---

## 6. Recalibration triggers

This document gets re-evaluated when one of these fires:

- **Month 3 actual revenue** comes in. Update the probability bands with real data.
- **First 100 buyers complete** (or by month 6, whichever first). Update the ICP fit assessment with actual buyer demographic data.
- **First "non-founder organically loves it" testimonial.** Begin tracking how many of these come in. If >20% of testimonials are non-founder, the wide-market scenario gets re-evaluated earlier.
- **A wide-market competitor pivots out** (e.g., Notion drops AI features, OpenAI raises prices significantly). Re-evaluate timing of broadening.

The strategy stays put unless one of these triggers fires.

---

## References

- `~/projelli/docs/marketing/strategy/00-master-strategy.md` — the strategy these numbers underpin
- `~/projelli/docs/marketing/strategy/06-measurement-cadence.md` — the abort triggers + KPI tiers
- `~/projelli/docs/marketing/strategy/07-anti-patterns.md` — anti-pattern #3 (verticalization) and #12 (going broad when ICP is working)
- `~/projelli/docs/strategy/market-assessment-2026-04/` — the 40K-word market research that informed these numbers
- `~/financial/08-recommendations/minimum-viable-launch.md` — the financial floor that makes patience affordable
