# Projelli Marketing Strategy: Master Plan

_Last reviewed: 2026-04-27_
_Owner: Claude (CEO mode), ratified by Jameson Daines (board)_
_Re-review: monthly during the first 6 months, then quarterly_

This document is the strategic spine of every other marketing decision. The companion docs (01-seo-engine, 02-launch-fuel, 03-partnership-spikes, 04-retention-and-wom, 05-personal-brand-binding, 06-measurement-cadence, 07-anti-patterns) each implement one chunk of what's defined here. Read this first.

---

## 1. Definition of winning

**Projelli's success metric for the next 12 months is one number: $10,000 in monthly gross revenue by month 12, sustained for 60 consecutive days.**

This is not the only number we care about. But it is the only number that the strategy is optimized for. Every channel, content piece, partnership, and pricing choice gets evaluated against the question: does this move us closer to $10K MRR, sustainable inside Jameson's 5-10 hours per week?

What this implies, ranked:
1. Revenue per Jameson-hour is the real KPI
2. Compounding channels beat one-shot channels
3. Conversion rate beats top-of-funnel volume
4. Lifetime ($99) sales beat Pro ($49) sales beat free signups
5. Retention beats acquisition once buyers exist
6. Word-of-mouth beats paid acquisition until paid acquisition is proven
7. Sustainable cadence beats burst cadence

Things we are explicitly not optimizing for in year one:
- Vanity metrics (PH upvotes, X followers, GitHub stars in isolation)
- Category leadership PR (we are not chasing TechCrunch coverage)
- Enterprise pipeline (no sales motion, no SOC 2, no contracts)
- Cloud sync, mobile, collaboration features (these are out of scope, see business plan)

---

## 2. The ICP we sell to

**The buyer:** A solo founder or building-in-public indie hacker, 25-45, technical or technically literate, currently shipping or about to ship a software product. Spends $20-50/month on their tooling stack (Cursor, ChatGPT Plus, a domain, maybe Notion). Has at least one of these traits:

- Privacy-leaning (concerned about putting business plans into Notion or ChatGPT memory)
- Cost-leaning (annoyed by stacking subscriptions, wants BYOK)
- Local-tool-leaning (already uses Obsidian, Sublime, Things, or similar)
- AI-native (uses Claude/Cursor daily, has API keys, comfortable with `.env`)

**Not the buyer (and we do not market to these segments in year one):**
- Enterprise teams (no compliance story, no SSO, no admin)
- Non-technical solopreneurs who want one-click everything
- Hobbyists with no monetization goal (these were the wrong target in the early marketing rewrite, and we corrected it on 2026-04-08)
- Students writing essays
- Therapists, journalists, lawyers (different vertical, would dilute positioning)

**Where they are:**
- Hacker News (especially Show HN, weekly)
- IndieHackers.com
- Reddit: r/SideProject, r/Entrepreneur, r/SaaS, r/macapps
- X/Twitter indie-hacker subgraph (Pieter Levels, Marc Lou, Tony Dinh adjacents)
- Newsletter subscribers: BetaList, Hacker Newsletter, Console.dev, MakerNews
- Searching Google and AI assistants for: "Notion AI alternative", "local-first AI tool", "Obsidian with AI", "ChatGPT plus Notion", "AI workspace BYOK", "AI workspace privacy"
- AlternativeTo, SaaSHub, Producthunt category browsing

This is a small total addressable market. That's fine. At $49 average sale price and 1% close rate on qualified visitors, $10K/month requires ~204 sales per month, which requires ~20,400 qualified visitors per month. That is reachable through SEO + launch fuel + partnerships without paid spend.

---

## 3. Positioning and message hierarchy

The single most consequential mistake in marketing a substantive product is letting the message proliferate into a feature list. We will not let this happen.

### The one-liner (canonical)

> **Obsidian for the AI era, built for founders, sold once.**

This is the version on `~/projelli/CLAUDE.md` and we keep it. It does three jobs in eight words:
- "Obsidian for the AI era" anchors to a known good thing (Obsidian) and signals local-first by association
- "built for founders" filters the audience cleanly (founders nod, everyone else moves on)
- "sold once" surfaces the pricing differentiator without saying "no subscription"

Use this everywhere brevity matters: hero subhead, X bio, Show HN title, AlternativeTo description, podcast intros, GitHub repo description.

### The 30-second story

> Most AI tools either lock your conversations inside someone else's database, charge you twice (once for the app, once for inference), or aren't built for the actual work indie founders do. Projelli is local-first: every chat with Claude, GPT, or Gemini becomes a real Markdown file in a real folder on your machine. You bring your own API key. There's no subscription, no cloud account, no telemetry. It comes with 15 founder-specific workflow templates (pitch deck, customer interview guide, financial projections, weekly review). Pay once, own forever.

This is the elevator pitch. Use this for: blog post intros, podcast guest spots, the press kit founder bio, the Show HN body, the email subscriber welcome.

### The five message pillars (used in vs-pages, blog posts, ads, screenshots)

| # | Pillar | One-line claim | Where it shows up most |
|---|---|---|---|
| 1 | **Local-first** | Your data stays on your machine. No cloud, no telemetry, no accounts. | vs Notion AI, vs ChatGPT, privacy-leaning posts |
| 2 | **BYOK** | You bring your own Claude / OpenAI / Gemini key. We never see your data and you pay providers directly. | vs Notion AI ($20+/mo), vs Cursor's bundled inference |
| 3 | **Chat-as-files** | Every AI conversation produces a real Markdown file you can open, edit, version, and back up. | vs ChatGPT (lost in app), vs Notion (locked in DB) |
| 4 | **Founder-specific** | 15 workflow templates for the work founders actually do. Not generic notes. | vs Obsidian, vs Bear, vs blank-page tools |
| 5 | **Sold once** | $49 Pro or $99 Lifetime. No subscription. The Founder's tier is $29 lifetime for the first 100 buyers. | vs everything in the category |

Each pillar has its own dedicated landing page or blog post anchor. We do not mix pillars in headlines. One pillar at a time, depending on which competitor or query the visitor came in on.

### What we never lead with

- Feature lists ("15 templates, 3 providers, voice, MCP, document suite"): these go in the press kit and feature reference, not in marketing headlines
- "AI for everyone" / "Anyone can use it": Projelli has setup friction and we do not pretend otherwise; the ICP is people who don't mind the friction
- "Built in 8 weeks" / "One indie founder against the giants": this is fine in launch posts but not in evergreen marketing; the buyer is buying a tool, not a story
- "Powered by Claude / OpenAI / Gemini": we are not those companies' marketers
- Any feature that requires explanation longer than one sentence

---

## 4. The two-engine model

This is the core insight of the strategy. Projelli's marketing is two engines running in parallel, each doing a different job.

### Engine 1: The compounding engine (SEO + AI search)

**What it does:** Captures intent-based search traffic that already exists. People are typing "Notion AI alternative" and "local-first AI workspace" into Google and asking ChatGPT/Claude/Perplexity the same questions. We need to be the answer.

**Why it's the primary engine for $10K/mo:** SEO compounds. Work done in month 1 is still earning in month 18. AI search citations (where ChatGPT/Claude/Perplexity recommend Projelli when asked) are the new SEO and we want to be early. Both channels scale revenue without scaling Jameson's hours.

**What it costs:** Up-front time (15-20 cornerstone pages plus 8-10 vs-pages over the first 12 weeks), then 2-4 hours per month of refresh. Zero dollars.

**Lag:** 4-6 months before it produces meaningful traffic. Months 2-5 will feel slow. This is unavoidable and we will not panic.

**Detailed plan:** `01-seo-engine.md`

### Engine 2: The spike booster (launch beats and partnerships)

**What it does:** Creates short, intense traffic spikes that fuel Engine 1 (backlinks, brand searches, reviews, signups) and harvest revenue at the moment of attention.

**Spikes available, in chronological order:**
1. **Hard launch week** (Product Hunt + Show HN + IndieHackers + Reddit, sequenced over 5 days). Already drafted in `docs/marketing/channels/`.
2. **Each major release** (v1.7, v1.8, v2.0). Smaller spike per release, repeats the channel rotation but at lower intensity.
3. **Newsletter sponsorships** (Console.dev, Hacker Newsletter, BetaList Pro). Gated on M3 revenue per the milestone framework. First sponsorship target: month 4-5.
4. **Integration launches** (Raycast extension, Obsidian importer, MCP directory listing). Each is its own mini-launch with its own audience.
5. **Podcast circuit** (Indie Hackers podcast, Software Social, Bootstrapped Web). Gated on having a clear story arc and 3+ months of revenue data.
6. **Annual re-launches** (PH "ship of the year" listing, AlternativeTo "tool of the month" submissions, Year-in-review post).

**Why spikes are second, not first:** Spikes are one-shot. The PH bump dies in 7 days. The Show HN bump dies in 48 hours. Without Engine 1 in place, the spike traffic visits, doesn't convert, and leaves no trace. With Engine 1 in place, the spike traffic visits, some buys, the rest gets indexed by search engines as "people are talking about Projelli" social signal, and the SEO engine compounds faster.

**Detailed plans:** `02-launch-fuel.md` (launch week), `03-partnership-spikes.md` (the others)

### How the two engines interact

```
Spike (PH launch)      →   Backlinks, brand searches, reviews
                       →   Engine 1 (SEO) sees authority signals
                       →   SEO ranks faster
                       →   More inbound traffic month 2 onward

Engine 1 (SEO)         →   Constant trickle of qualified visitors
                       →   Some convert directly
                       →   Some join email list, get Spike content later
                       →   Spike events get higher conversion rates

Both engines together  →   Compounding revenue with diminishing time cost
```

The mistake every indie founder makes is running only Engine 2 (launch, then panic, then re-launch, then panic). Projelli runs both, with Engine 1 as the spine.

---

## 5. The 12-month rhythm

| Quarter | Months | What we're doing | What we're building toward |
|---|---|---|---|
| **Q1** | 1-3 | Hard launch + SEO foundation | First 30-50 buyers, first $1-3K revenue, first 15 cornerstone pages live |
| **Q2** | 4-6 | SEO compounding + first paid spike | $3-5K/mo, first newsletter sponsorship, 8-10 vs-pages live, 15+ inbound links |
| **Q3** | 7-9 | Integrations + retention engine | $5-8K/mo, Raycast/Obsidian extensions live, referral mechanic shipped, 100+ Lifetime buyers |
| **Q4** | 10-12 | Steady-state + price/audience review | $8-10K/mo sustained, year-end review, 2027 plan |

Detailed monthly plan in `06-measurement-cadence.md`.

---

## 6. Hours allocation (Jameson's 5-10 hr/week)

This is the budget we're operating inside. Mis-allocation is the single biggest risk.

| Activity | Q1 (hr/wk) | Q2-Q4 (hr/wk) | Notes |
|---|---|---|---|
| **SEO content writing** | 3-5 | 1-2 | Front-loaded, then maintenance |
| **Launch ops + community replies** | 2-3 | 0-1 | Concentrated in launch week, then minimal |
| **Personal brand amplification** | 0-0.5 | 0.5-1 | 1-2 posts/month max under the selective hybrid |
| **Customer support** | 0.5 | 0.5-1 | Scales with buyer count |
| **Product feature development** | (separate budget) | (separate budget) | Engineering time is its own track |
| **Strategic review + measurement** | 1 | 0.5 | Monthly review + quarterly retrospective |

If a week's actual time exceeds 10 hours for two weeks running, we cut the lowest-converting activity. Sustained over-spending is the failure mode that ends side projects.

---

## 7. Strategic non-goals (things we will not do)

These are explicit. Each appears in `07-anti-patterns.md` with longer reasoning.

1. **No paid ads in year one.** Google Ads, Twitter Ads, Meta Ads. We don't spend until we know what converts at zero cost first. Newsletter sponsorships (which are paid) are not the same thing and become available at M3.
2. **No founder face on the marketing site.** Per the selective hybrid (`05-personal-brand-binding.md`), the press kit has a founder bio but the homepage and product pages are brand-voiced.
3. **No subscription tier.** Pricing is locked at $0 / $49 / $99 / $29 Founder's. Adding a $9/mo tier would compromise the "sold once" message that is one of our five pillars.
4. **No collaboration features.** No teams, no shared workspaces, no cloud sync. These would compromise local-first.
5. **No AI margin.** No managed-keys tier, no Projelli-branded AI inference. BYOK forever.
6. **No category-leadership PR push.** No TechCrunch, no The Verge, no big-publication coverage. These are vanity wins that do not move the needle for indie tools.
7. **No "Projelli for X" verticalization.** No "Projelli for therapists", "Projelli for writers", "Projelli for designers". The ICP is founders. Stay there.
8. **No public roadmap commitments.** We ship features. We don't promise dates. The roadmap is internal.

---

## 8. The single most important sentence in this plan

> **Projelli's job is to be the answer when an indie founder asks "what's a local-first AI workspace I can actually buy and own."**

If something we are about to do does not move us toward being that answer, faster, we don't do it.

This is the test for every channel, every content piece, every feature decision, every partnership pitch. It's intentionally narrow. The narrowness is the point.

---

## 9. What changes this strategy

This document is reviewed monthly for the first 6 months, quarterly thereafter. The triggers that would cause a substantial revision:

- **Revenue trajectory miss by 50% at month 3.** If we're at $250/month instead of $500, the ICP or pricing assumption is wrong and we re-examine.
- **A single channel produces over 50% of revenue for two months running.** That's a concentration risk and we need to either double down or diversify deliberately.
- **A clear product flag fails to differentiate** (e.g., voice + Ollama gets zero engagement). We rotate it out of the headline message and let it stay in the feature list.
- **A competitor launches an obvious clone** (local-first AI workspace from a known brand). We sharpen positioning toward whatever they don't have.
- **Jameson's job situation changes** (Wheel layoff, role change, time available shifts). The hours budget recalibrates and the strategy re-runs.

---

## 10. References (read these next)

- `01-seo-engine.md`: the compounding engine, week-by-week
- `02-launch-fuel.md`: launch week reframed as engine fuel
- `03-partnership-spikes.md`: newsletter, integration, podcast plays
- `04-retention-and-wom.md`: buyer-to-advocate conversion
- `05-personal-brand-binding.md`: the selective hybrid playbook
- `06-measurement-cadence.md`: KPIs, weekly/monthly review, abort triggers
- `07-anti-patterns.md`: what not to do, siren songs to ignore

Adjacent docs in the project:
- `~/projelli/PROJELLI_BUSINESS_PLAN.md`: pricing, product strategy, 16 CEO decisions
- `~/projelli/docs/marketing/playbook/MARKETING_PLAYBOOK.md`: channel-level execution playbook (preceded this strategy doc)
- `~/projelli/docs/reference/COMPETITIVE_LANDSCAPE.md`: per-competitor positioning paragraphs
- `~/projelli/docs/strategy/market-assessment-2026-04/`: full market assessment, 9 docs, 40K words
- `~/financial/08-recommendations/minimum-viable-launch.md`: milestone-gated infrastructure framework
