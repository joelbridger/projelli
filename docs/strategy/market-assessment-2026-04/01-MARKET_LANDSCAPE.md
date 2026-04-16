# 01 — Market Landscape (April 2026)

> Where the AI workspace category sits today, what's changed structurally in the last 6 months, and what shape the market will take through the end of 2026. Written as a CEO read, not a marketing sheet.
> Sister docs: `02-COMPETITIVE_DEEP_DIVE.md` for per-competitor detail, `03-USER_INSIGHTS.md` for what founders are actually saying.

---

## TL;DR

The AI workspace category bifurcated in 2026. Two macro-trends matter most:

1. **Big incumbents are racing to become "agent platforms," not "tools with AI inside."** Notion 3.0 → 3.4, the announced ChatGPT super-app (Atlas + Codex + ChatGPT in one binary), Claude Code's redesigned desktop app + Routines, Linear Agent, and the Grammarly → Superhuman rebrand all signal the same thing: the future of "productivity software" is "an agent that does things in your stack on a schedule." The shape buyers are being trained to expect is *cron-able, multi-step, can-call-tools.*
2. **A counter-current of local-first, BYOK, one-time-pay tools is rising fast.** JetBrains shipped BYOK in their AI Assistant in December 2025. AnyType matured "Sovereign Collaboration." AFFiNE crossed 67K GitHub stars. TypingMind hit $1M lifetime revenue. The BYOK discovery directories (BYOKList, byok.tech) are filling up. The HN comment that wins on every "I tried Notion AI" thread is now "I just migrated to Obsidian." Subscription stacking ($90–110/mo across ChatGPT + Claude + Gemini + Cursor + Notion AI) is the dominant complaint of the indie founder community.

Projelli sits exactly at the intersection of those two trends. The opportunity is real. So is the risk: the opportunity window may be 12–18 months before either (a) the incumbents ship a credible local-first BYOK tier, or (b) an Obsidian community plugin closes the founder-template gap in a weekend.

---

## Market sizing and segmentation

The "AI workspace" label spans at least five segments today, and most market reports conflate them. Useful split for Projelli's strategy:

| Segment | What "AI workspace" means here | Buyer | Typical price | Examples |
|---|---|---|---|---|
| **A. Generic team workspace + AI** | Cloud-collab docs/wiki with AI features bolted on | Knowledge worker teams (10–500) | $10–30/seat/mo | Notion, Coda (Superhuman), MS Loop, Confluence + Atlassian Intelligence |
| **B. PKM (personal knowledge management)** | Single-user note-taking with AI assist | Individual writers, researchers, engineers | $0–15/mo or one-time | Obsidian, Logseq, Reflect, Tana, Bear, Capacities, Heptabase, AnyType |
| **C. AI-native chat-first products** | The chat IS the UI; everything else is a thin layer | Anyone | $0–20/mo | ChatGPT, Claude.ai, Gemini, Perplexity, Lex.page |
| **D. AI-native vertical workflow tools** | Task-specific AI products (research, meetings, content) | Functional specialists | $14–50/mo | NotebookLM, Granola, Otter, Wispr Flow, Typefully |
| **E. AI-native dev tooling (relevant as category framing only)** | AI inside or alongside an IDE | Developers | $0–200/mo | Cursor, Continue, Cline, Aider, Claude Code, Replit Agent, Devin |

Projelli is in **Segment B with strong influences from C** (chat-as-input is structural to the product). The founder ICP also overlaps heavily with Segment D buyers (they use Granola for meetings, Typefully for content, Perplexity for research — and want a glue between them).

### Volume vs revenue split

Segment A (generic workspace) is by far the largest by revenue but is locked in by enterprise dynamics that don't apply to indie founders. Segment B is the smallest by total revenue but has the highest per-user lifetime value among the willing-to-pay slice. Segment C is the largest by volume but has near-zero margin per user (LLM cost ≈ revenue at $20/mo). Segment D is the fastest-growing in 2026 (Granola alone raised $125M Series C in March 2026 at a $1.5B valuation).

The slot Projelli is targeting is the niche that none of these own: **a single-user, files-on-disk, BYOK desktop tool with founder-specific workflows.** It's small. It's also defensible because every adjacent segment has structural reasons not to enter it (see Section 5).

---

## What changed structurally between October 2025 and April 2026

Eight shifts that materially affect Projelli's strategy:

### Shift 1: "Agents" went from demo to default

Six months ago, agents in productivity tools were a TechCrunch curiosity. Today they're the default release headline. Notion shipped autonomous agents in 3.0 (Sept 2025), Custom Agents with schedule + triggers in 3.3 (Feb 2026), and added voice + dashboards in 3.4 (Mar/Apr 2026). Cursor 3 (April 2026) reorganized its entire UI around parallel agent management. Claude Code shipped /schedule + Routines + Computer Use. Linear shipped Linear Agent. Granola pivoted from notetaker to "enterprise AI memory layer with personal/enterprise APIs."

**Implication for Projelli:** "Workflow templates that the user runs manually" no longer scans as cutting-edge. The framing buyers expect is closer to "a thing I can ask to do work for me." Projelli doesn't need to ship full multi-step autonomous agents to compete (and shouldn't, see `08-RISKS_AND_ANTIPATTERNS.md`), but the *language* of the product needs to incorporate "the AI does the work, you review it." The current homepage hero ("Big, annoying project? Put it in one place") is people-organizing-things, not AI-doing-things. That gap is widening monthly.

### Shift 2: MCP became the de facto interop standard

Anthropic's Model Context Protocol (MCP) hit ~97 million monthly SDK downloads in March 2026, the Official Registry has ~2,000 server entries, and OpenAI / Google / Microsoft all consume MCP now. Anthropic's Desktop Extensions (DXT, being renamed MCPB) ship one-click `.mcpb` install bundles. Cursor, Claude Code, ChatGPT desktop, and Notion 3.3 all integrate MCP servers.

**Implication for Projelli:** This is the single biggest distribution lever Projelli could use right now. A *Projelli MCP server* would let every Claude Code, Cursor, and ChatGPT desktop user read and write Projelli workspace files from inside their existing AI tool. "Where can I get to my workspace from?" goes from "the Projelli app" to "anywhere AI lives." On the consumption side, *consuming* MCP servers (Linear, GitHub, Stripe, Notion) inside Projelli would let founders wire their stack into their workspace without Projelli ever shipping native integrations.

### Shift 3: BYOK went mainstream

JetBrains shipping BYOK to their AI Assistant in December 2025 is the canary. Major-vendor AI products don't ship BYOK unless paying customers demand it. The BYOK discovery sites (byoklist.com, byok.tech) now exist as their own micro-category. The HN comment that drives BYOK conversion: *"Most people spend $1–5/month on API calls, not $20+ with traditional AI subscriptions."* That math has gone from "one weird trick" to common knowledge.

**Implication for Projelli:** The BYOK pitch isn't a niche differentiator anymore, it's a marketable category Projelli is one of the cleanest examples of. The opportunity is to lead with subscription fatigue, not lead with local-first. "The last AI subscription you'll ever buy" is a cleaner founder hook than "your data on your machine."

### Shift 4: Privacy concerns broke into mainstream founder discourse

The Notion AI data exfiltration vulnerability (HN thread id=46531565) generated wholesale flight, not "fix it" calls. Quote that crystallizes the mood: *"I just migrated from notion to obsidian today. Looks like I timed it perfectly."* The 67% statistic ("data privacy concerns are now the top barrier to AI agent adoption in regulated industries") is repeated across vendor pitches.

**Implication for Projelli:** Privacy is no longer a niche-aligned story for crypto/security/healthcare buyers. It's a default founder concern, and founders increasingly make tool decisions based on it. Projelli's local-first story finds receptive ears in 2026 that it wouldn't have in 2024.

### Shift 5: Subscription fatigue passed peak frustration into action

Specific 2026 stat: *"1.5M ChatGPT cancellations in March 2026 alone."* The math founders run: $20 ChatGPT Plus + $20 Claude Pro + $20 Gemini Advanced + $20 Cursor + $10 Notion AI = $90/mo before any vertical tools. AppSumo lifetime deals are thriving as the explicit anti-subscription play. TypingMind ($39–79 one-time, BYOK Anthropic/OpenAI/Gemini wrapper) hit $1M revenue in 20 months on this exact positioning.

**Implication for Projelli:** $49 one-time / $99 lifetime / $29 founder's launch is the right shape and at the right price. Lead with this in messaging.

### Shift 6: ChatGPT specifically lost ground to Claude

Widespread perception: GPT-5.x outputs are "shorter, refusals more frequent, often less helpful than GPT-4 era." Coding requests "now return skeleton code with comments like 'add your logic here.'" Claude has surged past ChatGPT in some App Store rankings; 70% of developers prefer Claude for coding per cited survey (Built In, NxCode 2026). OpenAI pulling Study Mode without announcement bred distrust.

**Implication for Projelli:** Default to Claude in onboarding (which the Free tier already does). When demoing or recording videos, use Claude. When writing comparison pages and FAQs, use Claude as the default reference model. This matches what founders are switching toward.

### Shift 7: Granola's Series C reshaped what "founder AI tool" looks like to investors

$125M at $1.5B valuation (March 25, 2026) on a pivot from meeting notes to "enterprise AI memory layer." Granola is now selling APIs, not just an app. They have more capital, more mindshare, and more momentum than any standalone "AI workspace for founders" play.

**Implication for Projelli:** This is good and bad. Good: it validates that "AI tool that helps me work" is a venture-attractive category, which means more press and more discovery. Bad: it raises the bar for what looks "real." Projelli's defense is the structural one — Granola is cloud-only, subscription-only, growth-funded — so they can't ship $49 lifetime BYOK without breaking their business model. Use this in PR positioning ("the indie alternative to the $1.5B-valuation enterprise stack").

### Shift 8: Anthropic, OpenAI, and Google all shipped structured outputs / 1M context / built-in memory

Three SDK-level changes that change what a Claude/GPT/Gemini-using app can do:

- **1M token context** (Claude Sonnet/Opus, GPT-5.x, Gemini 3 Pro) — stuffing the entire workspace into one prompt is now economical
- **Native structured outputs** (Anthropic public beta early 2026, OpenAI strict mode, Gemini response_schema) — workflow templates can return reliable JSON instead of "please format as a list"
- **Memory APIs** (Anthropic Memory in Pro/Max, OpenAI Memory across chats, Gemini saved info) — there's a parity layer Projelli can interop with

**Implication for Projelli:** The plumbing is finally good enough to do things that weren't reliably possible 12 months ago. Workflow templates can produce structured forms. "Ask my whole workspace" becomes a single API call with prompt caching at 1M context. Memory layer interop means Projelli can ship a "facts file" that informs Claude Memory and vice versa.

---

## What the market expects of "an AI workspace" by Q4 2026

Based on competitor velocity (Section 3 in `02-COMPETITIVE_DEEP_DIVE.md`) and founder voice-of-customer (`03-USER_INSIGHTS.md`), the implicit feature checklist that buyers will be running tools against by Q4 2026:

| Capability | Who has it now | Will be table stakes by Q4? | Projelli today |
|---|---|---|---|
| Stream chat with multiple LLM providers | Most | Yes | Yes |
| BYOK | Some (Obsidian plugins, Cursor, JetBrains) | Increasing | Yes |
| Files on disk in `.md` | Obsidian, Logseq, Bear, AFFiNE, NotePlan | Niche | Yes |
| Workflow templates | Notion (loose), prompt libraries | Forming | Yes (15) |
| Agents that run on schedule | Notion 3.3, Cursor 3, Claude Code, Linear | Yes | No |
| Database / structured views over notes | Notion, Obsidian Bases, Capacities, Tana | Yes | No |
| Voice input by default | Notion 3.4, Wispr, ChatGPT desktop | Yes | No (audio recording only) |
| Local LLM support | Smart Connections, AnyType, Continue | Niche | No |
| Embeddings / semantic search across vault | Smart Connections, Copilot, Mem | Yes | No (text search only) |
| Cross-document AI ("ask my notes") | NotebookLM, Smart Connections, Notion AI | Yes | No |
| MCP server (expose) + client (consume) | Cursor, Claude Code, Notion 3.3, Granola | Yes | No |
| AI artifacts (interactive HTML, React) | Claude Artifacts, Notion AI, ChatGPT Canvas | Niche but growing | No |
| Side-by-side AI editing of active doc (Canvas/Artifacts pattern) | ChatGPT Canvas, Claude Artifacts | Yes | No |
| Persistent AI memory across chats | ChatGPT, Claude Pro/Max, Mem0 | Yes | No |
| Mobile app | Notion, Obsidian, AFFiNE, Capacities, Heptabase, AnyType | Yes | No (intentionally) |

Projelli is at parity on the bottom layer (chat + BYOK + files on disk + templates) and structurally behind on most of the middle. The realistic 6-month plan can't close everything but can close the highest-leverage gaps: **embeddings/semantic search, local LLM, MCP, voice input, side-by-side editing, memory.** That's exactly the bet `06-RECOMMENDATIONS_BY_LOE.md` makes.

---

## Pricing benchmarks

Five reference points for pricing intuition. Projelli's $0 / $29 founder / $49 Pro / $99 Lifetime is in a strong band — not the cheapest, not the most premium, exactly where founders are trained to convert from AppSumo and TypingMind.

| Tool | Free tier | Paid entry | Top tier | Model |
|---|---|---|---|---|
| Notion + Notion AI | $0 (limited) | $10/mo + $10 AI | $30+/mo Business | Subscription + AI credits |
| Obsidian | $0 (full) | $4/mo Sync | $50/yr Catalyst | Free core, paid sync/insider |
| Reflect | None | $10/mo | $10/mo (one tier) | Subscription |
| Tana | $0 limited | $10/mo Plus | $18/mo Pro | Subscription + AI credits |
| Mem.ai | None | $14.99/mo | $14.99/mo | Subscription |
| Capacities | $0 | $7.99/mo Pro | $12/mo Believer | Subscription |
| Heptabase | None | $8.99/mo Pro | $17.99/mo Premium | Subscription |
| AnyType | $0 (1GB) | $5/mo Plus | $99/yr / $299/yr Co-Creator | Tiered subscription |
| Bear | $0 | $2.99/mo | $2.99/mo | Subscription |
| iA Writer | None | $50 one-time | $50 one-time | One-time |
| TypingMind | None | $39 one-time | $79 one-time | One-time, BYOK |
| ChatGPT | $0 (limited) | $20/mo Plus | $200/mo Pro | Subscription |
| Claude.ai | $0 (limited) | $20/mo Pro | $200/mo Max | Subscription |
| **Projelli** | **$0 (1 provider, 3 templates)** | **$29 Founder's / $49 Pro** | **$99 Lifetime** | **One-time, BYOK** |

The two products in this list with strongest "I bought this and would buy it again" signal in 2026 founder communities are **iA Writer** ($50 one-time) and **TypingMind** ($39–79 one-time, BYOK). Projelli's pricing matches both.

The pricing trap to avoid: adding a "Projelli managed AI" subscription tier later. See `08-RISKS_AND_ANTIPATTERNS.md` siren song #3.

---

## Geographic and language considerations

Out of scope for v1 launch but worth flagging for later thinking:

- The English-speaking founder community on X/HN/IH/Reddit is the primary launch audience. No localization needed for v1.
- The German-speaking PKM community is large and disproportionately into Obsidian / Capacities / Tana; potential v2 audience.
- The Japanese AI productivity community is strong (Notion has a large JP user base), but tooling expectations are different (more journaling, less startup-focused).
- The Indian indie hacker community is growing fast and is BYOK-receptive (subscription pricing in USD is painful at INR purchasing power); potential post-launch audience to court explicitly.

For Q2/Q3 2026: ship English only, accept the founder-community ICP, optimize for it.

---

## Where the market is heading by end of 2026

Three predictions worth committing to as planning anchors:

### Prediction 1: Notion will extend agents into a freemium tier and a marketplace

Notion has been adding agent capabilities monthly. The Custom Agents preview goes paid on May 4, 2026. By Q4 2026, expect: a marketplace of pre-built agents (founder agents, sales agents, content agents), a free tier with one bundled agent, and tighter MCP integrations to common SaaS. Projelli's defense: agents in Notion live on Notion's data; Projelli's data lives on the user's disk.

### Prediction 2: Apple ships AI-deep-integrated Notes at WWDC 2026 (June 8–12)

The WWDC keynote is now confirmed for June 8–12, 2026, and Apple has signaled AI focus. The most likely shape: Apple Notes with Siri 2.0 deep integration, on-device drafting/editing, document intelligence, image-to-note. Mac users will get a free competitor preinstalled. Projelli's Mac launch should be **before WWDC**, not after, so that early-adopter Mac users find Projelli first and have it before Apple ships their version. (See `07-ROADMAP.md` Week 3 / Mac.)

### Prediction 3: One major Obsidian community plugin will close ~80% of Projelli's gap

Smart Connections has 786K downloads. Copilot for Obsidian has 100K+ users. The same indie devs (or a new entrant) could ship a $25 "Founder OS for Obsidian" community plugin in a quarter. Defense: ship a polished single product that doesn't require plugin assembly. Marketing wedge: *"the AI workspace for founders who don't want to spend a weekend assembling it from parts."* (Already in the existing COMPETITIVE_LANDSCAPE.md, keep it sharp.)

---

## Three category-defining narratives founders are buying into in 2026

Knowing which story to attach Projelli to in launch copy matters as much as the product itself. The three narratives currently capturing founder mindshare:

### Narrative A: "I want my data back"

Triggered by the Notion AI exfiltration, the SaaS sprawl panic, and the rise of self-hosting. Buyers in this narrative pay for tools that put data on their disk, that don't phone home, that have an export button. iA Writer, Obsidian, AnyType, and Logseq all live here. Projelli fits cleanly.

### Narrative B: "I'm done paying $20/mo for everything"

Triggered by AppSumo lifetime deal traffic, the Claude/ChatGPT/Cursor/Notion AI stack math, and the BYOK movement. Buyers in this narrative pay one-time prices to escape recurring billing. TypingMind, iA Writer, the entire AppSumo catalog. Projelli fits cleanly.

### Narrative C: "AI should do the work, not just answer questions"

Triggered by Claude Code / Cursor agents / Notion 3.3 / Devin pricing reset. Buyers in this narrative want their AI to take action, not just chat. They evaluate tools on "how much does this take off my plate." Notion, Cursor, Claude Code, Granola, Linear Agent.

**Projelli is strong on A and B, weak on C.** Most launch copy and Show HN / Product Hunt comments should lead with A and B (where Projelli wins outright) and *acknowledge* C (workflow templates, soon-to-ship agents) without overpromising. The risk is leading with C and getting compared head-to-head against Notion's agent product or Claude Code's Routines.

---

## What's NOT happening in the market that might surprise you

Worth noting because their absence shapes Projelli's opportunity:

- **No major founder-template-marketplace tool has launched.** PromptDen and PromptHero are prompt search engines, not workflow products. Founders Fund hasn't backed a "Notion for founders." The slot is open.
- **No major one-time-pay AI productivity app has crossed $5M ARR.** TypingMind (~$1M total), iA Writer (long-tail), and a handful of AppSumo wins are the high-water marks. Founder-priced one-time AI is an under-explored business model.
- **No major "AI workspace" has shipped a clean Mac-first product.** Notion is web-first. Obsidian is cross-platform but not Mac-native. Bear and Craft are Mac-native but anti-AI or weak-AI. The Mac-native + AI-native + founder-niche slot is open if Projelli's Week 3 Mac build is good enough.
- **No AI workspace has a credible "speak instead of type" interface for founder workflows.** Wispr Flow does dictation. Granola does meeting notes. Voice-as-input-to-template-runs is unclaimed.

All four of these are opportunities Projelli can plant a flag on with relatively small investment. See `04-FEATURE_BRAINSTORM.md` and `06-RECOMMENDATIONS_BY_LOE.md`.

---

## Bottom line

The category is moving fast and the incumbents are widening their feature lead, but the *founder-niche, files-on-disk, BYOK, one-time-pay* slot Projelli targets is empty by everyone else's choice. The opportunity is real and the window is 12–18 months. The biggest threats aren't the named competitors; they're (a) Apple at WWDC, (b) an Obsidian plugin, and (c) Anthropic deciding Claude Code should have founder mode. None of those are imminent in Q2 2026, all are plausible by Q4 2026.

The right move is to **ship the launch on schedule**, lead with the subscription-fatigue + privacy narrative, and use the post-launch quarter to close 4–5 specific feature gaps (RAG, MCP, memory, side-by-side editing, Ollama) that compound into a defensible "the AI workspace that knows your stuff and lives on your machine" story.

The next document, `02-COMPETITIVE_DEEP_DIVE.md`, profiles each competitor in detail with the "what they can't ship" reasoning that powers PH/HN replies.
