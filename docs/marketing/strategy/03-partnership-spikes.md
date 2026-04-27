# 03: Partnership Spikes (the secondary engine)

_Last reviewed: 2026-04-27_
_Status: Plan. First spike becomes available at M3 revenue (~$5-10K cumulative)._

The SEO engine in `01-seo-engine.md` is the primary engine. This doc covers the second engine: short, high-intensity distribution events that depend on other people's audiences. They are "spikes" because each one's effect decays in 1-4 weeks. They matter because they fuel the SEO engine and harvest revenue at the moment of attention.

The cardinal rule: **spend money on a partnership spike only after the SEO engine has proven it can convert visitors.** A newsletter sponsorship that drives 5,000 visitors to a site that converts at 0.1% costs more than it earns. Same sponsorship to a site that converts at 1.5% pays back four times over. We earn the right to spend by first proving the conversion machine works.

---

## 1. The four spike categories

| Category | Cost per spike | Effort per spike | Earliest available | Decay |
|---|---|---|---|---|
| **Newsletter sponsorships** | $200-$1,500 | 2-4 hr | M3 revenue earned (~month 4) | 7-14 days |
| **Integration launches** | $0 (engineering time) | 8-30 hr | After v1.7 ships (~month 4) | Permanent |
| **Podcast appearances** | $0 | 2-4 hr per show | Q3 (month 7+) | 30-90 days |
| **Affiliate / referral mechanic** | 10-15% commission | 4-8 hr setup | Q3 (month 7+) | Permanent |

Each gets its own section below.

---

## 2. Newsletter sponsorships

**The case for newsletters:** Indie tool buyers read indie newsletters. The right placement in the right newsletter can produce 100-300 qualified signups in 24 hours and 3-12 paying buyers in the same window. At $500 spend and $49 average sale price, that's break-even at 11 buyers. Realistic outcomes: 4-15 buyers per placement.

**The case against:** It's paid. We don't pay for anything in year one until M3 revenue earns the right per the milestone framework. And the conversion numbers above assume the landing page is dialed-in, which it won't be at the start.

### When the first newsletter sponsorship becomes available

After Projelli has earned $5,000-$10,000 cumulative gross revenue (Milestone M3 from `~/financial/08-recommendations/minimum-viable-launch.md`). Realistic timing: month 4-5 if launch hits its conservative numbers.

Before that point, we focus on **earned** newsletter mentions (cold pitch with an angle, free) which are covered in `02-launch-fuel.md`.

### The shortlist (in priority order)

| Newsletter | Audience | Subscribers | Est. cost (sponsored slot) | Notes |
|---|---|---|---|---|
| **Console.dev** | Developer tools | ~30,000 | $1,200-$1,500 | Highest fit. Tool-first audience. Run by Tessa Kriesel + David Mytton. Best ROI estimate. |
| **Hacker Newsletter** | Curated HN highlights | ~70,000 | $600-$800 | Broad indie audience. Lower fit than Console but lower cost too. |
| **IndieHackers Weekly** | Indie founders | ~30,000 | $400-$700 | Direct ICP match. Run by Stripe / Courtland. |
| **BetaList Pro** | Early-stage product hunters | ~25,000 | $300-$500 | Lower quality audience but very cheap and launch-focused. |
| **The PETIT Newsletter** | Solo founders (small but tight) | ~5,000 | $150-$250 | Tiny audience, very high engagement, very cheap. Good first sponsorship to learn what works. |
| **Refind** | AI-curated reading list | ~250,000 | $1,500-$2,500 | Massive but lower fit. Skip unless we have very strong creative. |
| **MakerNews / The Hustle / Morning Brew / TLDR** | General tech | varies | $1,000-$5,000 | Off-strategy. Skip. |

### Sequencing

| Month | Newsletter | Budget | Goal |
|---|---|---|---|
| 4 | The PETIT Newsletter | ~$200 | Learn what creative works at low risk |
| 5 | IndieHackers Weekly OR Hacker Newsletter | ~$700 | First mid-budget placement |
| 6 | Console.dev | ~$1,200 | The big one if revenue supports it |
| 7-9 | Repeat best-performing | ~$500-$1,200 ea | Quarterly cadence based on what worked |
| 10-12 | Test new newsletters | varies | Diversify if Console.dev plateaus |

**Decision rule:** if the first sponsorship returns less than 1.5x the spend in 30 days, we slow down. We don't repeat a losing placement to "see if it gets better." Newsletter response is fast and binary.

### Creative for sponsorships

Sponsorships work when the creative looks like the newsletter, not like an ad. A 2-3 sentence editorial blurb with a link beats a banner ad every time in this audience.

Template (this is the actual draft, not a placeholder):

> **Projelli** is a local-first AI workspace for founders. Every chat with Claude, GPT, or Gemini becomes a real Markdown file you own. Bring your own API key, no subscription, sold once. 15 templates for the work indie founders actually do (pitch decks, customer interviews, weekly reviews). Founder's Pricing right now: $29 lifetime, first 100 buyers. → [projelli.com](https://projelli.com)

Variants for testing:
- **Privacy-led:** open with the privacy story
- **Cost-led:** open with the BYOK math (cheaper than Notion AI in 8 weeks)
- **Workflow-led:** open with one specific founder workflow (pitch deck or customer interview)

We rotate between these and let conversion data tell us which one wins. After 3 newsletter placements we should have a clear winner.

### Tracking newsletter ROI

Every newsletter placement uses a unique UTM source (e.g., `?utm_source=console_dev&utm_campaign=2026_05`). Plausible tracks. We log:

| Newsletter | Date | Cost | Visitors (24h) | Visitors (7d) | Signups | Buyers | Revenue (30d) | ROI |
|---|---|---|---|---|---|---|---|---|

Stored at `~/projelli/sign-ups/newsletter-roi.csv`. Reviewed monthly.

---

## 3. Integration launches

Each integration is its own mini-launch. Cost is engineering time, not dollars. Effect is permanent: a Raycast extension lives in the Raycast store forever, surfacing Projelli to every new Raycast user.

This is the most valuable spike category for a tool with our ICP. Indie founders use Raycast, Obsidian, and similar power tools heavily. Being the integration they discover at the moment they're already shopping for productivity is high-conversion.

### The integrations worth building (priority order)

| Integration | Effort | Audience | When | Why |
|---|---|---|---|---|
| **Raycast extension** | 8-12 hr | Mac power users, ICP-perfect | Q2 (month 4-5) | Raycast users are early adopters and pay for tools. Extension store has built-in discovery. |
| **MCP server directory listing** | 2-4 hr | Anthropic / Claude Desktop users | Q1 (month 1, post-launch) | Already supports MCP. Easy listing in `modelcontextprotocol/servers` registry. |
| **Obsidian importer plugin** | 12-20 hr | Obsidian users (~1.5M) | Q3 (month 7-8) | Highest ICP overlap of any platform. "Bring your vault to Projelli" is a real value prop. |
| **Alfred workflow** | 4-8 hr | Mac power users | Q3 | Smaller audience than Raycast but still ICP-fit |
| **Logseq importer** | 6-10 hr | Local-first cousins | Q4 if data supports | Direct overlap with our positioning |
| **Bear / Notion / Apple Notes importer** | 12-20 hr | Mass market | Q4 | Lower ICP fit but expands reachable buyer pool |

We build each one as its own mini-launch:
- Code the integration
- Write a vs-page or use-case page that highlights it (`/integrations/raycast`, `/integrations/obsidian`)
- Submit to the relevant store / directory
- Announce on brand X, IH, Reddit (small spike, similar to launch-week sequence at lower intensity)
- Capture the integration on the homepage in an "Integrates with" row

### The MCP play specifically

Projelli already supports MCP (per `project_projelli.md` line 14). This is a unique position: most AI workspaces don't support MCP yet. We turn this into a content + distribution opportunity:

1. **Write `/mcp-explained` cornerstone page** (already in the SEO plan)
2. **List Projelli in the MCP servers directory** at `github.com/modelcontextprotocol/servers`, pull request, takes 30 minutes
3. **Publish a blog post** "Why I built MCP support into Projelli before any other AI workspace did"
4. **Pitch to Anthropic's MCP newsletter** if they have one (they do as of 2026)

This is the lowest-effort, highest-payoff integration play we have. Schedule it for week 2 post-launch.

### The Raycast play specifically

Raycast users are exactly our ICP. Building a Raycast extension that does:
- "Open Projelli workspace [name]"
- "Quick chat with Projelli AI" (opens the chat in Projelli with a pre-filled prompt)
- "Search Projelli files" (live search across the user's workspace)

…makes Projelli feel native to a Raycast user's workflow. The extension store is an active discovery channel. Several tools have built their primary pipeline this way (e.g., 1Password, Linear, Tinybird).

Effort: 8-12 hours of TypeScript + Raycast API. Submission process is straightforward. Schedule for month 4-5 once SEO foundation is solid.

---

## 4. Podcast circuit

Indie founder podcasts have small audiences (5,000-30,000 listeners) but very high alignment with our ICP. A single podcast appearance produces 30-90 days of trickle traffic, several backlinks, and a permanent asset (the show notes link).

### When podcasts become available

After Projelli has 3+ months of revenue data so the founder story has substance. "I built this and launched it" is not a podcast story. "I built this, launched it, did $X in month 1, here's what worked and what didn't" is a podcast story.

Realistic earliest pitch date: **month 4-5**.

### The shortlist

| Podcast | Host | Audience | Why this fits |
|---|---|---|---|
| **Indie Hackers Podcast** | Courtland Allen | ~50,000 | The canonical indie founder show. Hard to book but life-changing if booked. |
| **Software Social** | Colleen Schnettler + Michele Hansen | ~10,000 | Founder-tooling adjacent, friendly to BYOK / local-first stories |
| **Bootstrapped Web** | Brian Casel | ~8,000 | Bootstrapping focus, indie-tool friendly |
| **Build Your SaaS** | Jon Buda + Justin Jackson | ~10,000 | Solo founder stories |
| **Indie Bites** | James McKinven | ~5,000 | 15-minute format, easier to book |
| **Tropical MBA** | Dan Andrews + Ian Schoen | ~30,000 | Broader audience, but lifestyle-business angle fits |
| **The Joel Hooks Show / The Search Off the Record / The Daily Hodl** | various | varies | Off-strategy. Skip. |

### Pitch template

Cold email. Subject line direct. Body 4 paragraphs max. Must have a specific story angle, not "I have a product, please platform me."

> Subject: Built Projelli in 8 weeks, $X in launch month, would love to share the actual numbers
>
> [Host name],
>
> I'm Jameson Daines, the solo founder of Projelli, a local-first AI workspace for indie founders. Launched in [Month] after an 8-week build, did $X in launch month from Y total customers across Product Hunt and Show HN.
>
> The story I'd want to tell on [Podcast name]:
> - What it actually took to ship a paid desktop app as a non-developer using Tauri + AI assistants (Cursor, Claude Code) in 8 weeks
> - The decision to go BYOK and one-time pricing in a subscription-everything category
> - What did and did not work in the launch (specific numbers, no hand-waving)
> - The 5-10 hour-a-week schedule and how I'm sustaining it alongside a full-time design job at Wheel Health
>
> Happy to send actual numbers, screenshots, or whatever is useful in advance. Audio quality is good (Shure MV7).
>
> Jameson

This pitch works because it offers a specific, listenable story arc. "Builder of cool thing wants to be on your show" does not. Track sent pitches in `~/projelli/sign-ups/podcast-pitches.csv`.

### Goal

Land 3-5 podcast appearances in months 5-9. Each one drives 100-300 visitors over 60-90 days, 5-15 buyers, and 1-3 backlinks (show notes pages tend to be high-authority).

---

## 5. Affiliate / referral mechanic

LemonSqueezy has a native affiliate system. We turn it on in Q3 (month 7-8) once the buyer base is large enough that some buyers will recommend Projelli unprompted.

### Mechanics

- 15% lifetime commission on Pro and Lifetime tiers (so $7.35 per Pro, $14.85 per Lifetime, $4.35 per Founder's)
- Affiliates get a unique referral link and dashboard via LemonSqueezy
- We approve affiliates manually (no open signups; spam risk)
- Payouts via LemonSqueezy's existing payouts (no additional admin)

### Target affiliate types

| Type | Why | How we recruit |
|---|---|---|
| Indie tool reviewers (YouTube, blogs) | They already do reviews, will write Projelli into their cycle | Reach out after they organically mention or review us |
| Productivity creators (newsletter, YouTube) | High audience overlap | Pitch at Q3 with proof of revenue traction |
| Founder community moderators | They influence buying decisions inside niche communities | Earned, not pitched |

### Why we wait until Q3

Affiliate programs work when the product is established enough that affiliates feel safe recommending it. Launching an affiliate program in launch week reads as desperation and underwhelms because there's no proof yet. Six months in, with public revenue numbers and reviews, an affiliate program reads as "I want to share the upside with the people who are already helping me."

Goal for year one: **5-10 active affiliates** producing **$300-$1,000/mo combined** by month 12.

---

## 6. Partnerships we explicitly do not pursue in year one

| Partnership | Why not |
|---|---|
| Co-marketing with another paid tool | Splits the audience; rarely produces measurable revenue at our scale |
| Bundle deals with multiple indie tools (e.g., StackSocial) | The audience is bargain hunters who refund or churn; not our ICP |
| Investor-led "portfolio company" cross-promo | We have no investors, and we don't want to commit to that |
| Conference sponsorships | $5K-$50K for unclear ROI; not at our revenue level |
| Affiliate networks (Impact, ShareASale) | Spammy traffic, refund headaches, low ICP fit |
| Reseller / white-label deals | Compromises the brand and the local-first message |

These all sound flattering when proposed and rarely earn back the time and money. We say no by default.

---

## 7. Total partnership spike budget over year one

Realistic estimate, contingent on revenue earning the right to spend each tier:

| Cost item | Months | Total |
|---|---|---|
| Newsletter sponsorships (5-7 placements) | 4-12 | $3,500-$5,500 |
| Engineering time for integrations (Raycast, MCP listing, Obsidian importer) | 4-8 | 30-50 hrs (no $) |
| Podcast appearances | 5-9 | $0 |
| Affiliate program setup + management | 7-12 | 8-12 hrs (no $) |
| **Total cash** | | **~$3,500-$5,500** |
| **Total Jameson hours** | | ~10-15 hours (interviews, pitches, light comms) |

The partnership spike budget is roughly 5-10% of year-one revenue at the conservative target ($60K). That's a healthy allocation for an indie tool. If revenue ramps faster, the budget can scale; if revenue ramps slower, we delay or skip placements without compromising the SEO engine.

---

## 8. References

- `~/projelli/docs/marketing/channels/NEWSLETTER_OUTREACH.md`: earned (free) newsletter pitch templates
- `~/projelli/docs/marketing/channels/DIRECTORY_SUBMISSIONS.md`: directory list for week 1
- `01-seo-engine.md`: the engine these spikes feed
- `02-launch-fuel.md`: launch week, the biggest single spike
- `06-measurement-cadence.md`: how to evaluate partnership ROI
- `~/financial/08-recommendations/minimum-viable-launch.md`: the milestone framework that gates paid spend
