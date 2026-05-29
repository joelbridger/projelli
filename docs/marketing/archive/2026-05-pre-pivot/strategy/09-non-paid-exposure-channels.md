# 09: Non-Paid Exposure Channels (the full menu)

_Written: 2026-04-29 by Claude (CEO mode), in response to Jameson's question: "what's the best non-paid way to get this idea out there?"_
_Re-review: quarterly. Update as channels prove out or fall off._

The strategy doc covers the headline engines (SEO, hard launch, build-in-public, podcasts, integrations). This doc enumerates the FULL menu of non-paid distribution channels available to Projelli, grouped by effort, timing, and ROI tier. It also addresses the implicit question: where do tech reviews fit (and where do they not)?

---

## 1. The two-tier reality of "tech coverage"

Most founders mean different things when they say "I want tech coverage":

### Tier A: PR coverage (broad consumer tech press)

**Examples:** TechCrunch, The Verge, Wired, Forbes, Engadget, MakeUseOf, ZDNet, TechRadar.

**The honest math:**
- Broad consumer audiences (millions) but very low intent
- Coverage typically converts at 0.01-0.05% to a paid indie tool
- 10K visitors × 0.05% × $49 = $245
- The PR effort to land one such piece is usually 20-40 hours (pitches, follow-ups, custom interviews, samples)
- ROI is negative for an indie tool with $49 LTV

**Status:** Anti-pattern. The strategy doc lists "no category-leadership PR push" as one of the eight non-goals. This is correct.

### Tier B: Review-style coverage (high-intent, narrow audiences)

**Examples:** AlternativeTo, SaaSHub, GetApp, There's An AI For That, Console.dev, Local-First Newsletter, MakerNews, BetaList, AI Tool Report, Future Tools, Subscribe to These, indie YouTube tool reviewers, productivity Substacks.

**The honest math:**
- Smaller audiences (1K-100K each) but very high intent (people actively shopping for tools)
- Coverage typically converts at 0.5-3% (10x-50x better than Tier A)
- 1K visitors × 1% × $49 = $490
- The pitch effort is 30-60 minutes per outlet
- ROI is positive and compounds (their archives stay searchable)

**Status:** This IS the strategy. Newsletter outreach (Phase 3 Day 4) + directory submissions (Phase 3 Day 4) + earned reviews via beta tester relationships (ongoing) all play here.

**The takeaway:** when you find yourself reading reviews of tools you're considering buying, you are NOT reading TechCrunch — you're reading the Tier B sources above. Those are the ones we pitch. The Tier A press is for VC-backed companies trying to reach broad consumers; we're not playing that game.

---

## 2. The full menu, organized by ROI tier

### Tier 1: highest ROI (do these first / always)

| Channel | Effort | Decay | When to do |
|---|---|---|---|
| **SEO content** (30-40 cornerstone pages over 12 months) | 4-8 hr per page, ~120-200 hr total over 12 months | None (compounds for years) | Continuous, primary engine |
| **AI search optimization** (write content that ChatGPT/Claude/Perplexity will cite when asked about local-first AI tools) | Same as SEO; embedded in SEO writing | None | Continuous |
| **Hard launch beats** (PH/HN/IH/Reddit/Newsletter) | 50-80 hr total in launch week | 7-30 days per spike, but produces backlinks → fuels Engine 1 | Phase 3 (one-time per major version) |
| **Cold newsletter pitches** (the Tier B review outlets) | 30-60 min per outlet × 8-15 outlets = 4-15 hr | Weeks per placement, often longer for archives | Launch week (Day 4) + monthly relationship-building |
| **Build-in-public on @projelliproject** | 10-15 min per post × 3-5/week | 1-3 days per post; aggregate compounds via follower growth | Continuous, daily marketing voice |

### Tier 2: high ROI (do these as bandwidth allows)

| Channel | Effort | Decay | When to do |
|---|---|---|---|
| **GitHub awesome-list PRs** (awesome-tauri, awesome-local-first, awesome-generative-ai, awesome-ai-tools, awesome-self-hosted, awesome-markdown-editors, etc.) | 30 min per PR × 5-10 lists = 3-5 hr | None (persistent listings, indexed by Google) | Pre-launch (one-time burst), then 1-2/quarter |
| **GitHub repo topics + topical badges** | 5 min one-time | None | Pre-launch |
| **Reddit comment cred-building** (5+ helpful comments per launch subreddit BEFORE posting) | 30 min/day × 5 subreddits × 3-4 weeks pre-launch | Some, but builds posting permission for launch week | Pre-launch only |
| **YouTube creator outreach** (productivity / AI tool review channels, send free Lifetime, ask for honest review) | 30-45 min per pitch × 10-15 creators = 5-10 hr | Long tail (videos stay searchable for years) | Phase 2 (after beta cohort produces social proof) |
| **Substack writer outreach** (writers covering productivity / AI / indie tools) | 30 min per pitch × 5-10 writers = 3-5 hr | Article-based, can compound if writer references later | Phase 2-4 |
| **Earned podcast appearances** (IndieHackers, Software Social, Bootstrapped Web) | 1-2 hr per appearance + prep | High retention, audience gets full Jameson context | Phase 4-5 (need clear story arc + revenue data) |
| **Google Alerts for opportunity-listening** (set alerts for "Notion AI alternative", "local-first AI workspace", etc.) | 5 min setup | Daily ongoing email | Pre-launch (one-time setup) |
| **Tauri / local-first / indie hacker community presence** (Discord, GitHub Discussions, occasional show-and-tell) | 30 min per appearance | Medium (community memory) | Phase 1+ continuous |

### Tier 3: medium ROI (situational, don't over-invest)

| Channel | Effort | Notes |
|---|---|---|
| **Wikipedia mentions** (add Projelli to relevant lists like "Comparison of note-taking software") | 1-2 hr (Wikipedia editorial process is strict) | Persistent + high SEO authority. Risk: edits reverted by Wikipedia editors who view single-tool additions as promotional. |
| **Open source contributions** (PRs to upstream Tauri, CodeMirror, MCP repos with author bio mentioning Projelli) | Per-PR effort varies | Earns dev community goodwill. Don't over-engineer for marketing — contribute genuinely or skip. |
| **Speaking at meetups / online events** (Local-First Conf, Tauri community calls, indie hacker meetups) | 4-8 hr per talk + prep | High signal but high commitment. Future state. |
| **Affiliate program** (let buyers earn $5-10 per referral) | Setup ~4 hr in LemonSqueezy | Gated on Q3+ when there are ENOUGH buyers to seed the program. Don't launch with 0 affiliates. |
| **Guest blog posts on IndieHackers / Bootstrapped Founder** | 1 day per post | Byline + backlinks + targeted audience. Earned, not paid. |
| **Twitter/X opportunistic replies** (when someone publicly asks "looking for Notion AI alternative", thoughtful reply with disclosure) | 5-10 min per reply | Low effort, high-trust attribution. Don't spam. |
| **Reddit comment strategy in adjacent subreddits** (NOT promo posts; substantive comments on tool-recommendation threads) | 5-10 min per comment | Same logic. Cap 2-3 promo comments per subreddit per week (anti-pattern #19). |

### Tier 4: avoid (anti-pattern documented)

| Channel | Why we avoid |
|---|---|
| **Paid ads** (Google, Twitter, Meta, Reddit) | Anti-pattern #8. Wrong shape for $49 one-time pricing. |
| **Influencer marketing** (paid YouTube placements) | Anti-pattern #7. Conversion 0.1-0.5%, audiences are dabblers. |
| **Mass cold DMs** | Anti-pattern #6. Detected as spam, shadow-banned. |
| **Lifetime deal sites** (AppSumo, StackSocial) | Devalues the brand. Race-to-the-bottom on pricing. Ruins retention metrics. |
| **Press releases via PR distribution services** (PR Newswire, PRWeb) | Cost without targeting. Generally noise. |
| **Influencer "rounds"** (paying multiple influencers in one launch sweep) | Same problems as single influencer, multiplied. |
| **Engagement-bait posts on @projelliproject** | Anti-pattern #14. Trains followers to be performative, not buyers. |

---

## 3. The "Tech Reviews" question specifically

Jameson's actual question: "should we eventually aim to have it reviewed by tech sites?"

**Yes, but specifically Tier B (review-style outlets), not Tier A (PR outlets).** Concretely:

### High-fit review outlets to pitch in Phase 3-4

These are already in the launch playbook (`channels/NEWSLETTER_OUTREACH.md` + `channels/DIRECTORY_SUBMISSIONS.md`) but worth listing here as the canonical "tech reviews" for Projelli:

**Indie tool aggregators** (web-form submissions, free):
- AlternativeTo (everyone shops here)
- SaaSHub
- There's An AI For That
- Future Tools
- AI Tool Report (directory listing)
- Console.dev tools list
- ToolFinder
- Subscribe to These (newsletter + directory)

**Newsletter-style reviews** (cold pitch via email):
- BetaList (also has paid premium tier)
- MakerNews (Sergio Mattei)
- Local-First Newsletter
- Console.dev (Jack Hanford)
- The Ravel (Tauri community)
- Ben's Bites (AI tools)
- Rundown AI
- Hacker Newsletter
- Tools for Founders
- FounderToFounder

**YouTube creators** (Phase 2 outreach, send free Lifetime + earnest review request):
- Productivity / AI tool channels (varying from 5K to 200K subscribers)
- Tiago Forte adjacent (knowledge management space)
- "Build in public" indie YouTubers
- Local-first / privacy-focused tech channels

**Substack writers / indie blog writers** (Phase 2-4 outreach):
- Writers in the productivity / indie tools / AI space
- Discoverable by reading recent newsletter issues + finding bylines
- Many are individual operators looking for pitch material; high response rate

### Outlets we don't pitch (for honesty)

- TechCrunch / The Verge / Wired / Forbes / Engadget — too broad for an indie tool
- Hacker News (Show HN is different — that's a self-submission, already in launch plan)
- AppStorm-style review aggregators (largely defunct or low-traffic)

---

## 4. What's already in the campaign vs what's net-new

### Already in the launch blast campaign:
- Cold newsletter outreach (Day 4 of launch week, 8-15 outlets)
- Directory submissions (AlternativeTo, SaaSHub, etc.)
- @projelliproject build-in-public
- @jamesondaines amplification posts (1-2/month)
- PH / Show HN / IH / Reddit hard launch
- Email sequence to signups
- Blog posts (3 drafted; SEO foundation)

### Net-new additions identified in this doc:
- **GitHub awesome-list PRs** — actioned 2026-04-29 (PRs opened to awesome-tauri, awesome-generative-ai, awesome-local-first; topics added to projelli/projelli)
- **Google Alerts opportunity-listening** — Jameson action (~5 min, browser only)
- **Reddit comment cred-building** — Jameson action (30 min/day across 5 subreddits, starts 3-4 weeks before launch)
- **YouTube creator outreach** — Phase 2 (after beta cohort), needs ~10-15 channel research + outreach pitches
- **Substack writer outreach** — Phase 2-4, needs ongoing list-building
- **Wikipedia mentions** — Phase 5+ (post-launch), risk of revert
- **Open source contributions** — ongoing if natural; don't manufacture
- **Earned podcast appearances** — Phase 4+, gated on story arc
- **Affiliate program** — Q3+ when buyer pool is large enough
- **Twitter opportunistic replies + Reddit comment strategy** — ongoing low-effort

---

## 5. Capacity reality check

The Tier 1 + Tier 2 list above is large. **Don't try to do all of it simultaneously.** The 5-10 hr/week budget caps real work.

Recommended weekly cadence (per `strategy/00-master-strategy.md` § 6):

| Phase | SEO writing | Launch ops / community | Personal brand amp | Customer support | Strategic review |
|---|---|---|---|---|---|
| **Q1 (months 1-3)** | 3-5 hr | 2-3 hr | 0-0.5 hr | 0.5 hr | 1 hr |
| **Q2-Q4 (months 4-12)** | 1-2 hr | 0-1 hr | 0.5-1 hr | 0.5-1 hr | 0.5 hr |

The SEO writing line is the highest-leverage one because it compounds. Everything else is in service of fueling it (launch beats, partnerships, build-in-public) or harvesting from it (community, support, strategic review).

**The single biggest mistake** would be spending Tier 1 budget on Tier 3 channels because they feel novel. Don't.

---

## 6. Ongoing exposure work, monthly cadence

Once Phase 3 (hard launch) is complete, the ongoing exposure menu narrows to:

### Monthly (recurring)
- 1 SEO cornerstone page published (Engine 1 maintenance)
- 1-2 Jameson real-name amplification posts (selective hybrid)
- 8-15 @projelliproject brand-X posts (3-5 / week)
- 1 newsletter relationship-touch (response to a publication, share of their content, light follow-up to launch-week pitches)

### Quarterly
- 1 GitHub awesome-list PR pass (any new lists that have emerged)
- 1 Substack / Twitter writer outreach pass (5-10 new writers added to relationship pipeline)
- 1 directory listing refresh / update (AlternativeTo, SaaSHub)
- 1 podcast-pitch round (3-5 podcasts, gated on story arc)
- 1 integration mini-launch (e.g., new MCP-compatible client lands → Projelli ships compatibility)

### Annually
- Year-in-review post (build-in-public marketplace gold)
- Annual Founder's Launch tier replay or equivalent (creates predictable Engine 2 spike)

---

## 7. References

- `~/projelli/docs/marketing/strategy/00-master-strategy.md` — the strategic spine
- `~/projelli/docs/marketing/strategy/02-launch-fuel.md` — the launch sequence (Engine 2 in detail)
- `~/projelli/docs/marketing/strategy/03-partnership-spikes.md` — partnership spikes (newsletter sponsorships gated on M3, integrations, podcasts, affiliate)
- `~/projelli/docs/marketing/strategy/07-anti-patterns.md` — what we DON'T do and why
- `~/projelli/docs/marketing/strategy/08-market-sizing-and-growth-paths.md` — TAM analysis + wide-market scenario
- `~/projelli/docs/marketing/channels/NEWSLETTER_OUTREACH.md` — the 15-outlet shortlist
- `~/projelli/docs/marketing/channels/DIRECTORY_SUBMISSIONS.md` — directory list
