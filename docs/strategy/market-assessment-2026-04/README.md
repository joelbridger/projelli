# Projelli Market Assessment — April 2026

> A comprehensive competitive analysis for Projelli (v1.0.8), sourced from deep web research on 30+ competitors, founder-community voice-of-customer, AI innovation trend scanning, and a fresh codebase capability audit. Written as a CEO read with a tactical build list attached.
>
> **Author:** Claude (in CEO/strategy role for Projelli, per `project_projelli.md`)
> **Date:** April 16, 2026
> **Intended audience:** Jameson, pre-launch, ratifying the 6-month post-launch feature roadmap.

---

## How to read this folder

You can skim this README in 5 minutes and walk away with the CEO read. The 8 supporting documents are for when you want the specifics.

| # | Document | When to read |
|---|---|---|
| 0 | `README.md` (this file) | First. Executive summary + top-10 recommendations. |
| 1 | `01-MARKET_LANDSCAPE.md` | When you want the 30K-foot view of where the AI-workspace category is in April 2026 and where it's going. |
| 2 | `02-COMPETITIVE_DEEP_DIVE.md` | When you need reply ammunition for a specific competitor (Notion, Obsidian, Claude Code, Granola, etc.). |
| 3 | `03-USER_INSIGHTS.md` | When you're writing marketing copy or validating a feature decision against what founders are actually saying. |
| 4 | `04-FEATURE_BRAINSTORM.md` | When you want the wide-net idea list (~110 ideas across 15 categories). |
| 5 | `05-DIFFERENTIATION_STRATEGY.md` | When you're deciding what hill Projelli plants its flag on. Answers "where's our moat?" |
| 6 | `06-RECOMMENDATIONS_BY_LOE.md` | When you're picking what to ship next. 30+ tickets triaged by effort with LOE estimates. |
| 7 | `07-ROADMAP.md` | When you want to see what ships when over the next 6 months. Calendar view. |
| 8 | `08-RISKS_AND_ANTIPATTERNS.md` | Before committing to any new feature. The 10 siren songs to avoid. |

---

## The headline read

Projelli sits at the intersection of two 2026 macro-trends:

1. **Incumbents are racing to become agent platforms.** Notion shipped 3.0 → 3.4 with autonomous agents, voice, dashboards. ChatGPT announced the super-app (Atlas + Codex + ChatGPT). Claude Code redesigned its desktop app + shipped Routines. Granola raised $125M Series C. The shape buyers expect is "AI that does things for you, cron-able, tool-capable."
2. **A counter-current of local-first, BYOK, one-time-pay tools is rising.** JetBrains shipped BYOK in Dec 2025. Privacy panic after the Notion AI exfiltration. AppSumo lifetime deals thriving. Subscription fatigue at all-time high (1.5M ChatGPT cancellations March 2026).

**Projelli lives exactly where these currents meet.** The opportunity window is 12-18 months before either (a) incumbents ship a credible local-first BYOK tier, or (b) an Obsidian community plugin closes the founder-template gap.

The strategic question isn't *whether* to ship Projelli as positioned — the positioning is correct. It's *which 3-5 differentiators to double down on* to make Projelli defensible post-launch.

The answer: **four flags**, planted in this order.

---

## The four flags

These are the differentiators worth doubling down on. Each satisfies five criteria: guardrail-aligned, structurally-unavailable-to-competitors, solves-a-named-founder-pain, has-a-demo-moment, compounds-with-the-others. Full reasoning in `05-DIFFERENTIATION_STRATEGY.md`.

### Flag 1: "The AI workspace that remembers your stuff"
**Local RAG + memory facts file + citations.** Every chat is aware of your entire workspace. A persistent facts file pre-pended to system prompts. Closes VOC pain #2 (context amnesia) and Request #1 (portable memory). **Demo:** *"What did I decide about pricing three months ago?"* → citation → open exact paragraph.

### Flag 2: "Your workspace, available in every AI tool you use"
**Projelli MCP server bundled as a .mcpb Desktop Extension.** One-click install in Claude Desktop. Claude Code / Cursor / ChatGPT Desktop can read your Projelli workspace. Plus consume MCP servers inside Projelli (Linear, GitHub, Stripe, Notion). **Demo:** one-click install MCP bundle, then ask Claude Desktop a question about your Projelli workspace.

### Flag 3: "AI edits your doc side-by-side with you"
**The Canvas / Artifacts UX pattern, but local.** Highlight text, ask "tighten this," streaming diff in-place with accept/reject per hunk. Version history attribution. **Demo:** highlight paragraph → say "make this 3 sentences" → 3 sentences appear diffed → accept.

### Flag 4: "Talk to your AI like it's already caught up"
**Voice input via Parakeet.cpp (96x faster than Whisper) + Ollama as 4th provider.** Offline voice query, offline LLM response. Because of Flag 1, voice queries actually work ("where were we on the pricing?" resolves). **Demo:** press-to-talk → speak → offline Ollama response with workspace citations.

The narrative arc across all four:

> **Projelli is the AI workspace that remembers your stuff, is available in every other AI tool you use, edits with you side-by-side, and you can talk to like it's already caught up.**

If only one flag can ship before launch, **pick Flag 1** (memory). It's the single cleanest story.

---

## Top 10 recommendations (the highest-leverage path)

These 10 items, shipped in approximately this order over 6 months, give Projelli the four flags AND the Quick Wins that convert launch traffic. Full list of 30+ in `06-RECOMMENDATIONS_BY_LOE.md`.

| # | Item | LOE | Impact | Flag | Ship in |
|---|---|---|---|---|---|
| 1 | **Real-time API cost meter** ($0.04 this chat, $0.17 today) | 4-6h | **HIGH** | — | **Pre-launch** |
| 2 | **Template preview gallery** (show filled-out output examples) | 6-8h | **HIGH** | — | **Pre-launch** |
| 3 | **API-key onboarding wizard** (screenshots per provider) | 6-8h | **HIGH** | — | **Pre-launch** |
| 4 | **`/vs-obsidian`, `/vs-notion` comparison pages** | 4-6h | **HIGH** | — | **Pre-launch** |
| 5 | **Ollama as 4th provider + per-template model** | 7-10h | **HIGH** | 4 | v1.1 (late May) |
| 6 | **Local RAG + @workspace + Ask-my-workspace** (LanceDB + e5-small) | 3-4 weeks | **V.HIGH** | 1 | v1.3 (July) |
| 7 | **Memory facts file + fact extraction** | 1-2 weeks | HIGH | 1 | v1.3 (July) |
| 8 | **Projelli MCP server + .mcpb bundle** | 2-3 weeks | **V.HIGH** | 2 | v1.5 (Aug) |
| 9 | **Side-by-side AI editing (Canvas-style)** | 2-3 weeks | **V.HIGH** | 3 | v1.6 (Sep) |
| 10 | **Voice input via Parakeet.cpp** | 1-2 weeks | HIGH | 4 | v1.7 (Oct) |

Items 1-4 are pre-launch: ~20-28 hours of work, ship before May 19-22. They're the highest-leverage conversion fixes independent of the flags.

Items 5-10 are the four flags themselves, sequenced over 5 months post-launch. This is an aggressive but realistic pace at 5-10 hr/week. Full calendar in `07-ROADMAP.md`.

---

## What NOT to build (the hard NOs)

Equal-weight to the "what to build" list. See `08-RISKS_AND_ANTIPATTERNS.md` for full reasoning. The seven non-negotiables:

1. **Don't build a Projelli-managed AI tier** (breaks BYOK, creates margin-compressed cloud dependency)
2. **Don't build cloud sync** (tell users to put workspace in iCloud / Dropbox / git — they're better at sync)
3. **Don't build real-time collaboration** (that's Notion's product; Projelli is single-user by design)
4. **Don't build autonomous multi-agent orchestration** (80-90% of agent projects fail; ship scheduled template runs instead)
5. **Don't position as "AI co-founder" or emotional-support** (wrong audience, wrong buyer)
6. **Don't lead marketing with "AI-powered"** (it's architecture, not a feature)
7. **Don't let marketing copy sound AI-written** (the cardinal sin for an AI product)

---

## Top 5 emerging threats

Monitor these. Full profiles in `02-COMPETITIVE_DEEP_DIVE.md`.

1. **Claude Code as category-eating AI shell** (April 14 2026 redesigned desktop + Routines + Computer Use, free for Claude Pro). Every Claude user is one command away from "half-converted Projelli user." Defense: Claude Code is dev-flavored; no founder onboarding.
2. **OpenAI super-app** (ChatGPT + Atlas + Codex combined, announced March 2026, H2 2026 ship). Defense: OpenAI-only, cloud-only, no real file editor.
3. **AFFiNE going founder-focused.** 67K GitHub stars, local-first option, AI built-in, whiteboard + doc + DB. Watchpoint: any "founder" or "templates" marketing.
4. **A breakout Obsidian plugin called "Founder Workflows."** Smart Connections has 786K downloads; same devs could ship this in a weekend. Watchpoint: ProductHunt launches tagged "Obsidian + AI."
5. **Granola going horizontal with MCP + APIs.** $125M Series C means they can ship anything. Watchpoint: "Granola for solo users" or Granola desktop app.

**Calendar risk:** Apple WWDC 2026 (June 8-12). Apple may ship AI-deep-integrated Notes + Siri 2.0. Ship Mac build *before* WWDC, not after.

---

## What founders are actually saying

The single quote that should shape every marketing decision:

> **"I just migrated from notion to obsidian today. Looks like I timed it perfectly."** — someguyiguess on the Notion AI exfiltration HN thread

Three themes from voice-of-customer (full detail in `03-USER_INSIGHTS.md`):

1. **Subscription fatigue is the #1 emotional driver.** Typical founder pays $90-110/mo across 5-6 AI tools. 1.5M ChatGPT cancellations March 2026.
2. **Context loss / memory amnesia is the #1 functional pain.** Vendor-cited stat: *"Professionals waste 5+ hours per week re-explaining the same information to AI tools."*
3. **BYOK has gone mainstream.** JetBrains shipped BYOK in Dec 2025 (canary). "Most people spend $1-5/mo on API calls, not $20+."

**Projelli's positioning aligns with all three.** The launch copy opportunity is to lead with the subscription-fatigue emotional driver, reinforce with the privacy pillar (local-first), and prove the tactical win (memory + citations).

---

## Market shifts worth naming

Five things that became true in the last 6 months. From `01-MARKET_LANDSCAPE.md`:

1. **Agents went from demo to default** (Notion, Claude Code, Cursor, Linear, Granola)
2. **MCP became the de facto interop standard** (97M monthly SDK downloads, 2000+ servers in the Official Registry, .mcpb bundles for one-click install)
3. **Privacy concerns broke into mainstream founder discourse** (not just security/healthcare)
4. **Subscription fatigue passed peak frustration into action** (AppSumo thriving, TypingMind hit $1M on $39-79 one-time pricing)
5. **ChatGPT lost ground to Claude** for serious work (70% of devs prefer Claude for coding; ChatGPT perceived as past its peak)

---

## Pricing is in the right band

Reference points:

| Product | Annual (1y) | Annual (3y) | Model |
|---|---|---|---|
| **Projelli Pro** | **$49** | **$49** | One-time, 1yr updates |
| **Projelli Lifetime** | **$99** | **$99** | One-time, updates forever |
| Notion + Notion AI | $240 | $720 | $10 + $10 AI/mo |
| ChatGPT Plus | $240 | $720 | $20/mo |
| Reflect | $120 | $360 | $10/mo |
| Tana Pro | $216 | $648 | $18/mo |
| Superhuman Starter | $360 | $1080 | $30/mo |
| **TypingMind (benchmark)** | **$39-79** | **$39-79** | **One-time, BYOK ($1M revenue in 20 months)** |
| **iA Writer (benchmark)** | **$50** | **$50** | **One-time** |

**Projelli Lifetime pays for itself in 5 months vs the cheapest cloud-subscription competitor.** Projelli's pricing band is the same as TypingMind's (validated path to $1M) and iA Writer's (longevity play). It is correct.

---

## What specifically to do tomorrow

Not "schedule a strategy session." Specific actions for the next 72 hours:

### Friday (tomorrow)
1. **Ship Q9** — set the free tier default model to Claude Haiku 4.5. ~1 hour.
2. **Start Q3** — real-time cost meter. Open `Provider.ts`, add token counting in the streaming response handler. ~2 hours of the 4-6 hour total.

### This weekend (Apr 18-19)
3. **Finish Q3** — wire the cost meter UI into the chat panel. ~3-4 hours.
4. **Kick off Q10** — run each of the 15 templates against a fictional "Acme Widgets" company, save the outputs. This is content creation in Jameson's actual wheelhouse (product designer). ~4-5 hours.

### Next week (Apr 20-26)
5. **Ship Q10** — the template preview gallery page on projelli.com. ~3 hours of gallery + content from weekend.
6. **Draft Q20** — API-key onboarding wizard. Design the flow in Figma (Jameson's tool), then implement. ~6-8 hours spread across 2-3 sessions.

After Week 1: the cost meter is live, the template gallery converts traffic, and the API-key wizard is ready. That's three conversion levers ahead of launch.

---

## What's different in this assessment from the existing `docs/reference/COMPETITIVE_LANDSCAPE.md`?

The existing competitive doc (2026-04-09) is good for reply ammunition against the pre-2026 competitors. What's new in this assessment:

- **April 2026 competitor ships** (Notion 3.4, Claude Code redesign, Granola Series C, ChatGPT super-app, AFFiNE v0.26, Heptabase AI Tutor, Linear Agent, etc.)
- **20+ additional competitors** not in the original doc (AnyType, Capacities, Heptabase, Saga, AFFiNE, Craft, Bear, iA Writer, NotebookLM, Granola, Saner.AI, NotePlan, Perplexity Spaces, Day One Gold, etc.)
- **Innovation trend scan** — what's shipping in AI-native products that an AI workspace could adopt (MCP, local LLMs, memory layers, voice, RAG, agentic workflows, multi-modal, structured outputs, Canvas/Artifacts)
- **Founder voice-of-customer** — what people are actually saying in HN / IH / Reddit / X about AI tools and subscription fatigue
- **Codebase capability audit** — what Projelli actually has (vs what the docs claim) and what's cheap vs expensive to extend
- **Four-flag differentiation thesis** — the specific 3-5 directions to double down on
- **6-month calendar roadmap** — calendar-explicit ship sequence tied to launch week + WWDC + quarterly checkpoints
- **10 siren songs** — explicit features to refuse to build, with the structural reasons why

The existing `COMPETITIVE_LANDSCAPE.md` should be treated as a reply-library supporting `02-COMPETITIVE_DEEP_DIVE.md`. No need to delete it; it complements.

---

## Verification: how to know this assessment is good

Five tests. Outcomes expected:

1. **Skim test:** can you read this README in 5 minutes and walk away with a clear picture? If yes, structure works. If no, tell Claude what was unclear.
2. **Surprise test:** at least 5 ideas in the brainstorm or recommendations you hadn't considered? Likely: Parakeet.cpp (voice at 96x Whisper speed), .mcpb Desktop Extension bundle format, LanceDB for local RAG, AFFiNE as under-discussed competitor, the scheduled-runs-instead-of-agents framing.
3. **Anti-pattern test:** does `08-RISKS_AND_ANTIPATTERNS.md` correctly call out the siren songs? Notably: managed AI tier, multi-agent fleets, cloud sync, Notion-replacement positioning, AI-co-founder language.
4. **Action test:** could you, working alone with Claude, ship 3 of the Quick Wins this weekend without further planning? Yes: Q3 cost meter, Q9 Haiku default, Q10 template gallery are all atomic weekend-scale items with clear scope.
5. **Citation test:** every competitor claim should be traceable. Every specific claim has a source link; run the URLs if verifying.

---

## Update cadence

This folder is a snapshot of April 16, 2026. Re-audit cadence:

- **`02-COMPETITIVE_DEEP_DIVE.md`**: refresh every 90 days (next: July 2026)
- **`01-MARKET_LANDSCAPE.md`**: refresh after major shifts (Apple WWDC, OpenAI super-app launch, any $10M+ raise in category)
- **`03-USER_INSIGHTS.md`**: refresh every 6 months or after any paying-customer feedback spike
- **`06-RECOMMENDATIONS_BY_LOE.md`**: check-mark shipped items monthly; full retriage every quarter
- **`07-ROADMAP.md`**: weekly during pre-launch, bi-weekly during launch recovery, monthly during build mode

If this folder still exists unchanged in October 2026, that's a red flag — it means the calendar hasn't been reviewed.

---

## One paragraph version (for the "I only have 30 seconds" moment)

Projelli's pricing, audience, and positioning are correct. The four differentiators worth doubling down on are: (1) local RAG + memory that makes the AI workspace-aware, (2) a Projelli MCP server so the workspace is available in every other AI tool, (3) Canvas-style side-by-side AI editing, (4) offline voice input with Ollama. Pre-launch, ship four Quick Wins: real-time API cost meter, template preview gallery, API-key onboarding wizard, and /vs comparison pages. Then execute the four flags over 6 months per the roadmap. Don't build: managed AI tiers, cloud sync, real-time collab, autonomous agents, AI-co-founder positioning. The opportunity window is 12-18 months before incumbents or an Obsidian plugin close the gap. Go fast on the highest-leverage items; leave margin for launch-week support.
