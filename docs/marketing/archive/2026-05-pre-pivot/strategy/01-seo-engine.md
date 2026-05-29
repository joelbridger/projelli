# 01: The SEO + AI Search Compounding Engine

_Last reviewed: 2026-04-27_
_Status: Plan, not yet executed. Foundation work begins post-launch._

This is the primary engine for $10K/mo. It does the heaviest lifting from month 5 onward. Every other doc in `strategy/` either feeds this engine or harvests what it generates.

The mental model: if 20,000 monthly qualified visitors land on Projelli pages and 1% buy at an average $49 ticket, that's $9,800/mo. SEO is the only zero-cost channel that can produce 20K monthly qualified visitors for an indie tool inside 12 months. So the question is: which 20-30 pages, ranking for which queries, get us there?

---

## 1. Two-channel definition

We are optimizing for two related but distinct channels.

### Channel A: Classic search (Google, Bing, DuckDuckGo)

What we have always called SEO. Visitor types a query into Google, lands on a Projelli page, reads, clicks Buy or signs up for the email list.

Year-one realistic ranking targets:
- 8-12 vs-pages ranking on page 1 for `[competitor] alternative` queries
- 6-10 cornerstone pages ranking on page 1 for category queries
- 4-6 use-case pages ranking on page 1 for workflow queries
- 1-3 viral blog posts ranking for adjacent zeitgeist queries

### Channel B: AI search (ChatGPT, Claude, Perplexity, Gemini, Bing Copilot)

Newer. A user asks an AI assistant "what's a good local-first AI workspace?" and Projelli surfaces in the answer with a citation.

This channel is currently small but growing fast and is critical because:
- Indie hackers and founders are heavy users of AI assistants
- AI assistants are biased toward sources they've been trained on or can retrieve
- Being early in this channel is uniquely defensible (training data lags, citations compound)

Tactics differ between Channel A and Channel B but the underlying content investments overlap. We do not write separate pages for each channel. We write pages that work for both.

---

## 2. The page architecture

Three tiers of pages, with strict role separation. Total: 30-40 pages over 12 months.

### Tier 1: Cornerstone pages (8-12 pages)

The deep, definitional pieces that anchor Projelli's authority on its core topics. Each is 2,500-4,000 words, includes diagrams or interactive elements, and links out to authoritative sources.

| Slug | Working title | Primary query | Role |
|---|---|---|---|
| `/local-first-ai-workspace` | What is a local-first AI workspace? | "local-first AI workspace" | Category-defining authority piece |
| `/byok-ai` | BYOK AI: what bring-your-own-key actually means | "BYOK AI", "bring your own AI key" | Education for the privacy-leaning ICP |
| `/ai-workspace-privacy` | The privacy guide for AI workspaces | "AI workspace privacy", "AI tool privacy" | Privacy trust-builder |
| `/ai-for-indie-founders` | How indie founders are using AI in 2026 | "AI for founders", "AI tools for indie hackers" | ICP-specific landing |
| `/local-first-vs-cloud-ai` | Local-first vs cloud AI: the founder's tradeoffs | "local AI vs cloud AI" | Comparison framework piece |
| `/mcp-explained` | MCP servers explained for non-developers | "what is MCP", "MCP server explained" | Power-user education + flag amplification |
| `/markdown-for-ai` | Why Markdown beats database notes for AI workflows | "markdown for AI", "AI notes file format" | Anchors the chat-as-files pillar |
| `/founder-workflow-templates` | Founder workflow templates that save 10 hours a week | "founder workflow templates", "startup templates" | Templates pillar amplification |
| `/api-key-setup-guide` | Setting up Claude, OpenAI, Gemini API keys end-to-end | "set up Claude API key", "set up OpenAI API key" | Removes setup friction objection |
| `/ai-cost-calculator` | AI cost calculator: BYOK vs subscription tools | "AI cost calculator", "Notion AI vs ChatGPT cost" | Interactive tool, rankable + linkable |

Each cornerstone page includes:
- Direct factual answer in the first 100 words (for AI search citation)
- A clear opinion or stance, not Wikipedia-style neutrality
- At least 2 internal links to vs-pages or use-case pages
- At least 3 external links to authoritative sources (Anthropic docs, OpenAI cookbook, EFF, etc.)
- Schema.org markup (FAQ, Article, HowTo)
- A CTA to download Projelli or join the email list
- A "last updated" date that we keep accurate

### Tier 2: vs-pages (8-12 pages)

The single most valuable SEO investment for a category-defining tool. Buyers searching `[competitor] alternative` are mid-funnel: they already know they want a tool in this space, they're shopping. Conversion rate on these pages is typically 3-8%, vs 0.5-1.5% on cornerstone pages.

Priority order for vs-pages, weighted by search volume + ICP fit:

| Slug | Competitor | Search volume estimate | Fit notes |
|---|---|---|---|
| `/vs/notion-ai` | Notion AI | High | Direct competitor, "I'm tired of paying $20/mo for Notion AI" is a real query |
| `/vs/obsidian-ai` | Obsidian + AI plugins (Smart Connections, Copilot) | High | Closest spiritual cousin, ICP overlap is huge |
| `/vs/chatgpt-projects` | ChatGPT Projects | Very high | Massive volume, our local-first angle wins |
| `/vs/claude-projects` | Claude.ai Projects | High and rising | Same as above, plus our BYOK angle is sharper here |
| `/vs/reflect` | Reflect Notes | Medium | Direct competitor in the AI-notes space |
| `/vs/tana` | Tana | Medium | Different paradigm but same ICP |
| `/vs/mem-ai` | Mem.ai | Medium | Direct AI-first competitor |
| `/vs/cursor-for-writing` | Cursor (for non-code work) | Medium | Different category but same buyer overlap |
| `/vs/heyday` | Heyday / Rewind | Low-medium | Privacy-leaning ICP overlap |
| `/vs/logseq` | Logseq | Medium | Local-first cousin, ICP overlap |

Each vs-page is 1,800-2,500 words and follows a strict template:
1. **Direct comparison hero**: one paragraph, names both products, states the core difference in one sentence. (For AI search, this is the citation-bait paragraph.)
2. **TL;DR table**: feature-by-feature, 8-12 rows, brutally honest (we lose on some rows, that's fine and improves trust)
3. **Where Projelli wins**: 2-4 specific scenarios with concrete examples
4. **Where the competitor wins**: 1-2 honest acknowledgments (people who want X should buy Y, not Projelli)
5. **The pricing comparison**: annual cost over 3 years, almost always favors Projelli
6. **The migration path**: how to bring data over from the competitor (this is huge for conversion)
7. **FAQ**: 5-8 schema-marked questions covering objections
8. **CTA**: try Projelli free, or buy at the Founder's price if available

The "Where the competitor wins" section is non-negotiable. AI assistants and Google both downrank vs-pages that read as one-sided sales pitches. Honest comparison ranks better and converts better.

### Tier 3: Use-case pages (5-8 pages)

Each maps to one of the 15 founder workflow templates. These are bottom-funnel: visitors who type in a specific workflow query already know what tool category they want, they just want to know if Projelli does this specific job.

| Slug | Template / use case | Primary query |
|---|---|---|
| `/use/pitch-deck` | Pitch deck creation with AI | "AI pitch deck", "investor pitch deck AI" |
| `/use/customer-interviews` | Customer interview guides with AI | "customer interview AI", "user research with AI" |
| `/use/financial-projections` | Financial projections with AI | "AI financial projections", "startup financial model AI" |
| `/use/competitor-analysis` | Competitor analysis with AI | "competitor analysis AI", "competitive research AI" |
| `/use/weekly-review` | Weekly founder review with AI | "weekly review template", "founder weekly review" |
| `/use/landing-page-copy` | Landing page copy with AI | "AI landing page copy", "AI copywriting workspace" |
| `/use/investor-update` | Monthly investor updates with AI | "investor update template", "AI investor update" |

Each use-case page is 1,200-1,800 words, opens with a worked example (not abstract benefits), shows screenshots of the actual template in Projelli, and CTAs to download Projelli plus a free downloadable Markdown copy of the template.

The free template download is a deliberate conversion mechanism. Anyone can download the template even without buying Projelli. Most won't. Some will. The few who do get added to the email list, see the template's note that says "this template has 30+ AI-augmented prompts when used inside Projelli", and convert at a higher rate than cold visitors.

---

## 3. AI search engine optimization (Channel B specifics)

ChatGPT, Claude, Perplexity, and Gemini are increasingly the discovery layer. The tactics are not yet a settled science, but a few patterns are clear.

### What works (verified across 2025-2026 industry data)

1. **Direct factual answers in the first paragraph.** AI assistants prefer to cite sources that state the answer plainly. "Projelli is a local-first AI workspace for indie founders" is better than a 200-word lyrical preamble.

2. **Mention competitors by name and explain the differences.** AI assistants synthesize across sources. A page that mentions Notion AI, Obsidian, and ChatGPT alongside Projelli with clear distinctions becomes a higher-quality citation than a page that only describes Projelli in a vacuum.

3. **Schema.org markup, especially FAQ and HowTo.** AI assistants look for structured data. Every cornerstone page and vs-page gets FAQ schema for the FAQ section.

4. **Get cited in the sources AI assistants train on or retrieve from.** Specifically:
   - GitHub READMEs (especially awesome-lists like `awesome-local-first`, `awesome-ai-tools`)
   - Hacker News discussion threads (organic, not astroturfed)
   - Reddit comment threads (organic, not astroturfed)
   - Wikipedia adjacency (a Wikipedia article on "local-first software" that links to Projelli is gold; we will not edit Wikipedia ourselves but we will create the conditions for it to happen)
   - Newsletter archives that get scraped (Console.dev, Hacker Newsletter, BetaList weekly)
   - Stack Overflow answers (where relevant questions exist)

5. **Maintain `llms.txt` and `/llms.txt`.** Emerging convention. We publish a plain-text file at `projelli.com/llms.txt` that gives AI crawlers a structured, opinion-rich summary of the product, the differentiation, the pricing, and the canonical URLs. This is cheap and we do it in week 1.

6. **Submit to AI tool directories** that are themselves cited by AI assistants. Targets: There's An AI For That, Futuretools.io, AIToolsDirectory, ToolFinder. Most are free.

### What does not work (and where we will not waste hours)

- Stuffing keywords. AI search ranks worse with this than classic SEO did.
- Generating content with AI and publishing as-is. AI assistants detect AI-generated content and downrank it as a citation source. (Deeply ironic. Also true.) Every page goes through Jameson's voice review under `feedback_jameson_voice_profile.md`.
- Massive content volumes. 200 thin pages will rank worse than 20 strong pages. We do 30-40 strong pages, maintained.

---

## 4. Keyword targeting

We are not chasing high-volume head terms ("AI", "writing", "notes"). Those are unwinnable for an indie tool with no paid budget. We are chasing mid-tail terms with clear buyer intent.

### Primary keyword targets (the ones we must rank for)

Tier 1, must rank top 3 by month 9:
- `local-first AI workspace`
- `BYOK AI workspace`
- `Notion AI alternative`
- `Obsidian AI plugin alternative`
- `local AI for founders`
- `[product name] alternative` for each of the 8-12 vs-page targets

Tier 2, must rank top 10 by month 9:
- `AI workspace privacy`
- `AI tool no subscription`
- `one-time AI tool`
- `chat history Markdown`
- `MCP server desktop app`
- `voice AI workspace`
- `Ollama desktop app`

Tier 3, opportunistic:
- Long-tail variations of the above (`how to set up Claude API key for desktop app`, `Notion AI vs Obsidian for founders`)

### How we measure

We do not pay for Ahrefs or Semrush at year one's revenue level. Free tools that work:
- Google Search Console (already wired or wire it in week 1)
- Plausible Analytics (already running, see `project_plausible_analytics.md`)
- Google's "People Also Ask" boxes (manual scrape into a doc)
- AnswerThePublic free tier
- Direct query in ChatGPT/Claude/Perplexity for the target queries (does Projelli appear in the answer? if not, why not?)

Monthly review: check rank for the 30 highest-priority queries. Add to a sheet at `~/projelli/sign-ups/seo-tracking.csv` (gitignored). One row per query, columns for month-over-month rank change.

---

## 5. Content cadence

The hours budget for SEO from `00-master-strategy.md` is 3-5 hr/wk in Q1, 1-2 hr/wk thereafter.

### Q1 (months 1-3): foundation push

Total content goal: 16-20 pages live by end of month 3.

| Week | Output |
|---|---|
| Week 1 (post-launch) | `/local-first-ai-workspace`, `/byok-ai`, `/vs/notion-ai` |
| Week 2 | `/vs/obsidian-ai`, `/vs/chatgpt-projects`, `/api-key-setup-guide` |
| Week 3 | `/vs/claude-projects`, `/ai-workspace-privacy`, `/use/pitch-deck` |
| Week 4 | `/vs/reflect`, `/vs/mem-ai`, `/use/customer-interviews` |
| Week 5 | `/local-first-vs-cloud-ai`, `/use/financial-projections` |
| Week 6 | `/mcp-explained`, `/use/competitor-analysis` |
| Week 7 | `/markdown-for-ai`, `/vs/tana`, `/use/weekly-review` |
| Week 8 | `/ai-cost-calculator` (interactive), `/founder-workflow-templates` |
| Weeks 9-12 | Refresh + 4 more pages based on what's ranking |

This is ambitious but doable at 4 hours/week if we use the structured templates and Jameson's voice profile to draft fast.

**Drafting flow:** Claude drafts each page in the Jameson voice profile, then Jameson reviews + tweaks for 15-20 min, then publish. The draft-review-publish loop is the bottleneck, not the writing.

### Q2-Q4 (months 4-12): maintenance + opportunistic

| Cadence | Output |
|---|---|
| Monthly | 1 new page (use-case or vs-page based on what's ranking) |
| Monthly | Refresh 1-2 existing pages with updated information |
| Quarterly | 1 deep-dive long-form (3,000+ words, attempts a viral piece) |
| Quarterly | Update `/llms.txt` with current product state |

Total content over the full year: 30-40 pages. Modest, but every page is high-quality, evergreen, and refreshed.

---

## 6. Internal linking architecture

Strict pattern. Search engines and AI assistants both score pages partly by their internal link graph.

### Hub-and-spoke

- **Homepage** is the central hub
- **Cornerstone pages** are sub-hubs, each linking to relevant vs-pages and use-case pages
- **vs-pages** link to the homepage and 2-3 relevant cornerstone pages
- **Use-case pages** link to the homepage, the templates cornerstone page, and 1-2 relevant cornerstone pages
- **Blog posts** link to relevant cornerstone pages

### Anchor text rules

- Use descriptive anchor text. "BYOK explained" beats "click here".
- Vary anchor text across links to the same page (so Google doesn't think we're keyword-stuffing).
- Always link to the canonical URL, not redirects.

### The "obvious next read" pattern

Every page ends with a "What to read next" block of 2-3 links. This:
- Increases time-on-site (a ranking signal)
- Distributes link authority across the site
- Improves the user journey toward conversion

---

## 7. Backlink strategy (organic only in year one)

We do not buy links. We do not do link exchanges. We do not pay for sponsored posts that pretend to be editorial. Both Google and AI assistants increasingly punish all of these.

What we do:

| Source | How we earn the link | Effort |
|---|---|---|
| Hacker News submissions (Show HN, weekly Show HN re-list of new feature) | Quality of submission, organic comments | Already in `02-launch-fuel.md` |
| Reddit posts (r/SideProject, r/Entrepreneur) | Same | Already drafted |
| IndieHackers post (8-week launch story) | Same | Already drafted |
| Newsletter mentions (Console.dev, Hacker Newsletter, BetaList) | Cold pitch with a real angle | `03-partnership-spikes.md` |
| Awesome-lists on GitHub (`awesome-local-first`, `awesome-ai-tools`, `awesome-tauri`) | Pull request to add Projelli | 30 min/list, do all of them in week 1 |
| Wikipedia (local-first software article links) | Do not edit ourselves; create conditions for organic editor adoption | Long tail |
| Blog mentions from indie tools we integrate with | Build the integration first (Raycast, Obsidian, etc.) | `03-partnership-spikes.md` |
| Podcast appearances | Pitch in Q3 | `03-partnership-spikes.md` |
| Guest blog posts on indie publications | One per quarter, on `building-in-public` themes | Q2 onward |

### Critical: harvest backlinks from launch coverage

Launch week (PH, HN, IH, etc.) generates links. Many of those links are temporary or buried. We track every link in launch week into `~/projelli/sign-ups/launch-backlinks.csv` (URL, source, date, anchor text). Some of these will be high-authority and we want to be able to reference and reinforce them later (e.g., quoting the reviewer's comment in a follow-up tweet to keep the post fresh in search).

---

## 8. Technical SEO requirements

These are setup-once items. Done in week 1.

| Item | Status | Owner |
|---|---|---|
| HTTPS via Cloudflare tunnel | ✅ Live | Done |
| Plausible Analytics | ✅ Live | Done |
| Google Search Console verified | ⏳ Pending | Jameson (5 min, see action pack) |
| Bing Webmaster Tools verified | ⏳ Pending | Jameson (5 min) |
| `sitemap.xml` published at `/sitemap.xml` | ⏳ Pending | Engineering, week 1 |
| `robots.txt` allows all crawlers, disallows `/sign-ups/` and `/api/` | ⏳ Pending | Engineering, week 1 |
| `llms.txt` published at `/llms.txt` | ⏳ Pending | Engineering + content, week 1 |
| Schema.org markup on every page | ⏳ Pending | Engineering, ongoing |
| Open Graph + Twitter Card meta tags | ⏳ Pending | Engineering, week 1 |
| Canonical URLs on every page | ⏳ Pending | Engineering, week 1 |
| Page speed: LCP under 2.5s on every page | ⏳ Verify | Engineering, week 1 |
| Mobile responsive | ⏳ Verify | Engineering, week 1 |

The technical setup is ~6 hours of engineering work. Not Jameson's. Either Claude does it via subagents during a maintenance session or it gets queued in the BACKLOG.

---

## 9. The interactive tool: `/ai-cost-calculator`

Worth calling out specifically. This is the single piece of content most likely to attract organic backlinks and AI search citations.

**What it does:** Lets a visitor type in their estimated monthly AI usage (chats per day, tokens per chat, model preference) and see:
- Cost via Notion AI ($20/mo flat)
- Cost via ChatGPT Plus ($20/mo flat)
- Cost via Cursor Pro ($20/mo flat)
- Cost via BYOK + Projelli (one-time $49 + actual API spend, usually $2-15/mo)
- Three-year total cost comparison

**Why it works as SEO:**
- Bloggers and newsletter writers love linking to interactive tools
- Tools rank well in Google's "Tools and calculators" feature snippets
- AI assistants cite interactive tools as authoritative sources for cost claims
- It's defensible: the math is honest and we update prices as competitors change theirs

**Engineering effort:** ~4-6 hours. Pure client-side JavaScript, no backend.

This goes on the Q1 backlog. Priority: ship by month 2.

---

## 10. The 12-month outcome we are betting on

By month 12, if this engine is working:

- **30-40 pages live**, of which 8-12 are ranking on page 1 for their primary queries
- **15,000-25,000 monthly organic visitors** to projelli.com
- **2-4 newsletter mentions per month** unprompted
- **AI assistants cite Projelli** for 4-6 of the 30 priority queries
- **15-25% of new buyers** report finding Projelli via Google or an AI assistant (asked at checkout)

If we're at 50% of these by month 6, we are on track. If we're at 20% of these by month 6, the engine is mis-tuned and we re-examine in the monthly review.

If we're at zero by month 9, the strategy itself is wrong and we revisit `00-master-strategy.md`.
