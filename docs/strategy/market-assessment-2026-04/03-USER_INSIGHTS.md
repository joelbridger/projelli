# 03 — User Insights (April 2026)

> Who the Projelli indie-founder ICP actually is, what they're saying in public, where their pain is, and what makes them pay. Sourced from HN threads, Indie Hackers posts, Reddit aggregators, X/Twitter founder community, ProductHunt review comments, and founder-tool substacks Oct 2025 – April 2026.
> Sister docs: `02-COMPETITIVE_DEEP_DIVE.md` (what competitors are doing), `04-FEATURE_BRAINSTORM.md` (features that address these pains).

---

## TL;DR

Three facts shape every recommendation downstream:

1. **Subscription fatigue is the #1 emotional driver in 2026.** Typical founder pays $90–110/mo across ChatGPT + Claude + Gemini + Cursor + Notion AI. 1.5M ChatGPT cancellations in March 2026 alone. "I'm done paying $20/mo for everything" is now a core narrative.
2. **Context loss / memory amnesia is the #1 functional pain.** Buyers report "5 hours/week re-explaining the same information to AI tools." Bessemer's State of AI calls memory "the new moat." OpenAI's own developer forum complains about GPT-4o context regressions within single chats.
3. **BYOK has gone from niche to mainstream.** JetBrains shipped BYOK in Dec 2025 (the canary). The HN comment "I just migrated from Notion to Obsidian" after the AI data exfiltration thread is the cultural marker. Privacy and cost pressure are fusing.

Projelli's positioning ("the last AI subscription you'll ever buy, with files on your hard drive") is directly aligned with all three. The question is not *whether* to go to market with this — it's which 3-5 unmet needs from Section 4 below to ship features for in the next 6 months.

---

## 1. Who the founder ICP actually is

Based on what people say in public, the Projelli buyer breaks into three overlapping personas:

### Persona A: The build-in-public solo founder

Age 26–42. On X/Twitter daily. Follows Pieter Levels, Marc Lou, Greg Isenberg, Tibo, Damon Chen. Has 500–10,000 followers. Has shipped 2–5 products, most were failures, one is making $3K–$30K MRR. Runs a one-person business and explicitly values that. Uses Cursor or Claude Code for coding; uses a chaotic stack of ChatGPT + Notion + Google Docs + Apple Notes + text files on desktop for everything else.

**Pain:** Subscription stack math. Tool sprawl. "I can't find that thing I wrote in February." Writes investor updates / launch posts / marketing copy and hates that they all sound AI-written.

**What they pay for:** One-time purchases under $100. AppSumo. GitHub Sponsors for favorite OSS. Claude Pro (grudgingly). A VPS ($5–20/mo). No other recurring subs if possible.

**What they won't pay for:** Anything with "AI" in the name at $20/mo unless they use it every day. Enterprise SKUs starting at $300/mo. Anything that requires a sales call.

### Persona B: The moonlighting founder with a day job

Age 28–45. Senior IC or manager at a tech company. Has been building a side project for 6–18 months. Nights-and-weekends schedule, 5–10 hours/week. Serious about shipping but cash-constrained on time not money. May or may not be on X; lurks on HN and r/SideProject.

**Pain:** Context switching. "By the time I open my tools at night, I've forgotten what I was doing." Their AI stack is one ChatGPT tab and one Cursor window — they don't want more apps. Privacy matters more than for Persona A (may not want their day-job company to see them building a product).

**What they pay for:** Whatever their employer reimburses (which is mostly nothing). Apps that save them time on nights/weekends. Lifetime deals. One big annual spend on a course or conference.

**What they won't pay for:** Anything that requires daily login to justify the subscription. Anything with a team/collab pitch.

### Persona C: The non-technical founder with technical co-founder (or AI as co-founder)

Age 30–50. Designer, PM, ex-ops lead, domain expert (healthcare, legal, education, fintech). Building with a technical co-founder or using AI to write code. Uses Notion extensively. Curates Loom videos, spreadsheets, and pitch decks as deliverables. Doesn't read code.

**Pain:** "I can't tell if my co-founder is burning cycles on the wrong thing." Privacy concerns (especially in regulated verticals). Sophisticated spreadsheet user, weak on terminal-first AI tools.

**What they pay for:** Notion ($10/mo — they keep it). Figma. Adobe. ChatGPT Plus. SaaS they learned from their last company.

**What they won't pay for:** Developer-flavored tools. Anything that requires reading documentation to set up.

### The consolidated Projelli buyer

Most likely a **hybrid of A and B**. Age 30, technical enough to paste an API key, uses Claude daily, has one active side project making $0–$5K MRR, burned by subscription stack, values privacy, has a Mac or a Windows gaming PC. Would convert on an impulse $29 purchase if the PH top comment says "this works." Would NOT convert on a $20/mo subscription even at the same long-term cost. Wants to be seen as someone who "figured out" a better AI workflow.

This is the persona that launch copy should be written for. Mac/Windows parity matters. BYOK setup friction is survivable but only if the onboarding is one-page and clear. The "5 hours re-explaining context" pain is acute.

---

## 2. The top 10 pain points founders are vocalizing right now

These are sourced with specific quotes, thread links, and paraphrases. Use in marketing copy, FAQ, reply templates.

### Pain 1: "I'm paying for ChatGPT AND Claude AND Gemini AND Cursor AND Notion AI"

The dominant 2026 complaint. A typical founder pays $20 ChatGPT + $20 Claude + $20 Gemini + $20 Cursor/Copilot + $10 Notion AI = $90+/mo before vertical tools. Aggregator platforms cite **"1.5M ChatGPT cancellations in March 2026 alone"** ([NxCode](https://www.nxcode.io/resources/news/why-people-leaving-chatgpt-alternatives-2026), [Aizolo](https://aizolo.com/blog/best-ai-subscription-services-2026/)).

**Projelli relevance:** Direct hit. Lead with this in every launch channel.

### Pain 2: Context loss / memory amnesia within and across chats

Most-cited functional pain. OpenAI's own developer forum: *"GPT-4o memory regression — context loss across chats and inside threads."* Specific pitch stat repeated across vendors: *"Professionals waste 5+ hours per week re-explaining the same information to AI tools."* Bessemer State of AI calls memory "the new moat" ([Supermemory](https://blog.supermemory.ai/context-memory-guide-ai-systems/), [OpenAI community](https://community.openai.com/t/bug-gpt-4o-memory-regression-context-loss-across-chats-and-inside-threads/1310926)).

**Projelli relevance:** Projelli's chat-as-artifacts model answers this indirectly (chats become files), but doesn't yet have a proper memory layer. See `06-RECOMMENDATIONS_BY_LOE.md` Medium-01.

### Pain 3: Cost unpredictability on credit/usage models

HN quote (id=46676554): one user reports **"$2k a week with premium models"** on Cursor before moving to Claude Code Max where they were "equally as prolific and paying 1/10th the price." Another: **"The $100 Claude plan is the minimum, I feel. Otherwise you run out of tokens way too often." — lysace.** Cursor's June 2025 pricing switch to credits is the biggest 2025–26 trigger event in founder dev community ([HN 46676554](https://news.ycombinator.com/item?id=46676554)).

**Projelli relevance:** BYOK with visible cost meter is the direct answer. See `04-FEATURE_BRAINSTORM.md` item "Real-time API cost meter."

### Pain 4: AI generates "looks done but isn't" output

Valtorian phrasing: *"AI creates work that looks finished but isn't. Later, they realize it doesn't match real users, business logic, or edge cases, then everything needs to be rewritten."* HN quote: **"It's too eager to commit, not eager enough to iterate." — inetknght.** Trust in AI-generated code dropped from 77% to 60% during 2025 ([Valtorian](https://www.valtorian.com/blog/ai-product-mistakes-2026), [Greenpeppersoftware](https://greenpeppersoftware.com/the-vibe-coding-backlash-is-here-and-its-mostly-justified-a-senior-engineers-honest-assessment/)).

**Projelli relevance:** Workflow templates with structured outputs + diff review address this. Message: *"AI proposes; you approve."* Already a Projelli principle; make it explicit in marketing.

### Pain 5: Vibe-coding cognitive exhaustion

HN thread id=46292365 (verbatim quotes):
- **simonw**: *"It's now 11:47am and I am mentally exhausted. I feel like my dog after sniff-training."*
- **visarga**: *"After 4 hours of vibe coding I feel as tired as a full day of manual coding."*
- **xnorswap**: *"We've built a motor that can generate 1,000 horsepower. But one man could steer a horse. I'm chasing it around trying to keep it pointed forward. It's so tiring."*
- **lelanthran**: *"When the code I get is not what I wanted even though tests pass, it's more mental energy than doing it myself."*

This is reviewer-burnout, not a "tools are bad" complaint ([HN 46292365](https://news.ycombinator.com/item?id=46292365)).

**Projelli relevance:** Workflow templates reduce the "steering" tax. Each template is a pre-thought scaffold. Emphasize in messaging: *"Projelli gives the AI a shape to fill in, not a blank page to generate from."*

### Pain 6: Privacy & data exfiltration in cloud AI workspaces

Notion AI exfiltration HN thread (id=46531565):
- **someguyiguess**: *"I just migrated from notion to obsidian today. Looks like I timed it perfectly."*
- **dcreater**: *"I wonder when there will be an awakening to not use SaaS for everything."*
- **digiown**: *"Never trust any consumer grade service without an explicit contract for important data."*

Vendor-cited stat: *"data privacy concerns are now the top barrier to AI agent adoption in regulated industries, cited by 67% of decision-makers"* ([HN 46531565](https://news.ycombinator.com/item?id=46531565), [Dume.ai](https://www.dume.ai/blog/what-is-a-desktop-ai-agent-the-definitive-guide-2026)).

**Projelli relevance:** Core differentiator. Every marketing surface should reinforce: files on disk, keys in OS keychain, API calls direct to provider, zero Projelli servers see your data.

### Pain 7: ChatGPT specifically "got worse"

Widespread perception across HN / Reddit / dev forums: GPT-5.x outputs are *"shorter, refusals are more frequent, often feels less helpful than GPT-4 era."* Coding requests *"now return skeleton code with comments like 'add your logic here.'"* Claude has surged past ChatGPT in App Store ranking. 70% of developers prefer Claude for coding per Built-In survey ([NxCode on ChatGPT quality](https://www.nxcode.io/resources/news/chatgpt-getting-worse-2026-what-changed-alternatives), [Built In](https://builtin.com/articles/chatgpt-claude-switching-analysis)).

**Projelli relevance:** Default Projelli onboarding + demos to Claude, not GPT. When writing docs/FAQs, use Claude as the reference model. This matches where founders are switching.

### Pain 8: AI-as-feature stopped impressing buyers

Quote from SaaS M&A research: *"Buyers are not rewarding AI as a feature. They are rewarding AI as architecture. A chatbot on your support page or a predictive scoring model in your dashboard does not move you out of the Limited AI Use tier."* Founders increasingly feel "AI feature added" isn't a moat — it's table stakes ([Development Corporate](https://developmentcorporate.com/corporate-development/saas-ma-2026-ai-valuation-gap/)).

**Projelli relevance:** Don't market as "AI-powered workspace." Market as "workspace built around AI from the ground up where every conversation produces a real file on your hard drive." The architecture difference is the pitch, not the feature.

### Pain 9: Tool sprawl + decision fatigue

*"Tool overload creates decision fatigue, and 2026 is being called the Year of Distractions."* One RevOps lead *"spent $56,000 on 25 GTM tools last year but canceled 20 of them."* QuickBooks study: solopreneurs report 40% more burnout than traditional business owners; admin layer is the primary driver ([Marisa Shadrick](https://marisashadrick.com/ai-solopreneur-clarity-over-complexity-in-2026/), [11x Blog](https://www.11x.ai/tips/ai-gtm-tools)).

**Projelli relevance:** Single product. One file tree. 15 templates that cover the main workflows. Reduce choice, don't add to it.

### Pain 10: Distribution remains AI-immune; product judgment too

From Indie Hackers retrospective: **"AI executes. It doesn't decide."** and **"The hard part was always finding people who actually wanted it."** AI accelerates building, then drops you off at a marketing wall it can't climb ([IH post](https://www.indiehackers.com/post/i-shipped-a-productivity-saas-in-30-days-as-a-solo-dev-heres-what-ai-actually-changed-and-what-it-didn-t-15c8876106)).

**Projelli relevance:** Projelli's workflow templates include ContentStrategy, GoToMarketPlan, UserInterviews. These can be marketed as *"the parts of founder work AI hasn't solved yet, but shouldn't own."* Language: *"Projelli doesn't write your business. It organizes the parts that are yours to think through."*

---

## 3. Top 10 most-requested features nobody has shipped (or shipped well)

These are where Projelli can compete. The opportunity set.

### Request 1: Persistent, portable cross-tool memory

Every AI assistant has its own siloed memory. Founders want *"memory that lives with me, not the tool"* — a personal context layer that travels Claude → ChatGPT → Cursor. Plurality.network and Supermemory are circling this; no one has nailed it ([Plurality](https://plurality.network/blogs/best-universal-ai-memory-extensions-2026/)).

**Projelli opportunity:** Ship a local "facts file" that any LLM can load as context. Later: expose via MCP server so Claude Code / Cursor / ChatGPT can consume it.

### Request 2: Multi-model side-by-side comparison built into one workflow

*"A SaaS founder writing product documentation needs Claude for nuanced prose, ChatGPT for broad ideation, and Perplexity to verify competitive claims — in the same morning."* Aggregators like NanoGPT and OpenRouter solve routing, not workflow ([NanoGPT](https://nano-gpt.com/blog/ai-subscription-alternative-2026)).

**Projelli opportunity:** Already has the three providers. Needs a "Run on all 3" button in chat + a comparison view. Partial implementation exists in `ComparisonView.tsx` per codebase audit.

### Request 3: "Do my investor update from my recent activity" agent

The Visible/Pilot template ecosystem proves demand, but the AI tool that ingests Stripe + Linear + Slack + Notion + email and spits out a faithful, voice-matched investor update **does not exist**. Every founder still hand-writes investor updates ([TechCrunch on updates](https://techcrunch.com/2024/02/05/how-to-write-your-monthly-investor-update/)).

**Projelli opportunity:** InvestorUpdate template exists. Enhance with (a) voice-matching from past published content, (b) MCP-based ingestion of Stripe / Linear metrics. High-value lighthouse workflow.

### Request 4: Workflow templates with actually named outputs (not "ChatGPT but with categories")

2026 founder corpus wants prompt libraries where *"click → fill 4 inputs → get a real structured deliverable."* PromptDen and PromptHero are search engines for prompts, not workflows. Founders want finished documents, not prompts to copy ([Pinggy](https://pinggy.io/blog/best_prompt_libraries_for_ai_assisted_software_development/)).

**Projelli opportunity:** *This is exactly what Projelli does.* The marketing gap: the homepage must make it obvious this is "the answer to prompt libraries," not "a prompt library." Show the filled-in output as the demo, not the interview form.

### Request 5: Local-first chat with mixable cloud + local models

Locally Uncensored and a few Tauri projects exist but are dev-flavored. Founders want polished desktop where *"data stays on my disk but I can call Claude when I need to,"* with one-click toggling. JetBrains shipping BYOK in late 2025 was the signal ([JetBrains](https://blog.jetbrains.com/ai/2025/12/bring-your-own-key-byok-is-now-live-in-jetbrains-ides/)).

**Projelli opportunity:** Add Ollama as 4th provider. Per-template model selection lets users route "daily journal" to local, "pitch deck" to Claude.

### Request 6: Pricing strategy / financial model AI (with voice, not generic SaaS-bro outputs)

Pitch deck generators (Alai, PitchGrade) get reviews like *"consistent formatting, design, and textual errors within final outputs."* There's no founder-grade financial model AI that doesn't read like McKinsey-template-lite ([Hebbia](https://www.hebbia.com/resources/ai-pitch-deck-generators)).

**Projelli opportunity:** FinancialModel and PricingStrategy templates exist. Opportunity is to sharpen the system prompts to produce *concrete, founder-voice* output, not generic SaaS prose. This is a content revision on existing files, not a new feature.

### Request 7: Customer/user-interview synthesis better than "summarize this transcript"

Founders want: feed 12 interview transcripts, get themes, the killer 5 quotes, the contradictions, the JTBD framework, AND the priority-ranked feature list. Today's tools do bullet-point summaries. Rally is doing simulated personas — synthetic, not real synthesis ([Every](https://every.to/podcast/100-ai-personas-said-you-d-click-this)).

**Projelli opportunity:** UserInterviews template exists. Add a "synthesize across multiple interviews" mode that chain-calls templates (running multiple transcripts through → aggregate synthesis).

### Request 8: Founder-voice content engine

Typefully/Hypefury have *"generic AI generation that doesn't know your voice."* The gap: AI workspace that reads your published LinkedIn/X/blog history → generates posts indistinguishable from your writing ([XreplyAI](https://xreplyai.com/blog/best-ai-tools-for-x-twitter-creators)).

**Projelli opportunity:** ContentStrategy template + a one-time "voice profile" generation step from user's existing content files. High differentiator because most competitors don't have files-on-disk to learn from.

### Request 9: Customer simulation / pre-launch validation

Rally pioneered this. Real demand for *"test my landing copy on 100 simulated personas before paying for ads."* Greg Isenberg's threads pump this concept hard. No founder-priced ($49 not $200) tool has shipped a polished version ([Every](https://every.to/podcast/100-ai-personas-said-you-d-click-this)).

**Projelli opportunity:** New template: CustomerSimulation. Takes copy + persona description → simulated reactions from N personas. Medium LOE. See `06-RECOMMENDATIONS_BY_LOE.md`.

### Request 10: Long-running agent that doesn't lose its mind on hour 2

Agent-failure research: *"37% experienced AI agent-caused operational issues in the past twelve months. 80–90% of AI agent projects fail in production."* Founders see Claude Code work for hours and want THAT pattern for non-coding work — research, drafting, content batches ([CSO Online](https://www.csoonline.com/article/4132860/why-2025s-agentic-ai-boom-is-a-cisos-worst-nightmare.html), [Composio](https://composio.dev/blog/why-ai-agent-pilots-fail-2026-integration-roadmap)).

**Projelli opportunity:** **Don't build an agent.** The agent-reliability problem is real and the founder community is skeptical. Instead, ship a *scheduled workflow run* feature: "run template X every Monday at 9 AM with these inputs, review the output at 9:15." Same delegation feel, none of the hallucination tarpit. See `06-RECOMMENDATIONS_BY_LOE.md`.

---

## 4. The actual founder AI stack, April 2026

What founders *say* they use vs what they actually use. The aspirational vs actual gap is huge.

### Actual stack (median indie founder, confirmed via HN / IH / X / tool comparison articles)

1. **Claude Code** as daily driver for code AND "thinking partner" tasks. 46% of devs rate it #1 (vs Cursor 19%, Copilot 9%) per NxCode. Plan: $20–100/mo.
2. **ChatGPT (free or Plus)** as "ask anything" secondary. Many founders only on free tier now because Claude won the "serious work" slot.
3. **Cursor OR Windsurf** for those who still want an IDE-shaped AI. Cursor 3 pivoted to agent-management UI which alienated some users.
4. **Notion (maybe + AI)** for docs/wikis. Many founders run Notion AND ChatGPT in parallel because Notion AI's Q&A *"frequently fails to find information that's clearly in the user's notes."*
5. **Perplexity OR Gemini Deep Research** for research/citations. Rarely pay for both.

### The Pieter Levels / Marc Lou pattern (more extreme)

**Cursor or Claude Code + Replicate + a single VPS**, no SaaS layer at all. Extreme example of subscription-minimization. Greg Isenberg's prediction:

> *"The biggest startups of 2026 will be built by remixing three or four existing AI tools into new vertical workflows."* — [Greg Isenberg on Threads](https://www.threads.com/@gregisenberg/post/DS5FK2_kaym/)

### The aspirational vs actual gap

Aspirational lists mention Lovable, Bolt, Make, Sentry, PostHog, Beehiiv. **Actual** founders at month 3 are still using Claude + Cursor + a Stripe link.

**Projelli relevance:**
- Project Projelli as the *glue* for an existing Claude + Cursor + Stripe stack, not a replacement for any of them
- The "remix three or four AI tools into new vertical workflows" framing is *exactly* Projelli's opportunity — an MCP bridge lets Projelli workflows call out to Claude, Cursor, Stripe, etc.
- Don't position against the individual tools. Position as the workflow surface that ties them together.

---

## 5. Pricing sentiment

### What founders happily pay for

- **$20–30/mo for the model itself** (Claude Pro, ChatGPT Plus, Cursor base) — normal expectation
- **$49–79 one-time on AppSumo** for narrow tools. TypingMind ($39–79) is the cited success case. AppSumo's typical band: *"$49–79 for tools that might otherwise cost $50–200 monthly"* ([99signals](https://www.99signals.com/appsumo-deals/), [IBTimes](https://www.ibtimes.com.au/appsumo-review-2026-lifetime-deals-marketplace-thrives-amid-ai-boom-offering-deep-discounts-1862819))
- **$100/mo Claude Max** — accepted by serious users *because* it's the cost of staying productive (*"it's the minimum, I feel"*)
- **$200/mo Pro tier** normalized if shipping product daily

### What founders REJECT

- **$20/mo wrappers around Claude/GPT.** Reddit sentiment: *"Reddit's AI communities tend to punish hype; the first reply to a $20/month subscription is typically 'what does this do that Claude can't?'"* ([AI Tool Discovery](https://www.aitooldiscovery.com/guides/best-ai-tools-reddit))
- **Notion AI as standalone $10 add-on** when they already pay for Notion Plus + ChatGPT. Math doesn't work.
- **Per-seat enterprise SKUs** starting at $300/mo for what feels like a desktop tool
- **Anything with a sales call**

### Subscription vs. one-time vs. lifetime

- **Subscription is still default but actively resented.** Hybrid models dominate (base + usage)
- **Lifetime deals thrive on AppSumo.** Warning: *"AppSumo buyers are often deal hunters who purchase impulsively but underuse tools or demand heavy support"*
- **The $49 one-time / $99 lifetime band is exactly the AppSumo sweet spot.** TypingMind generated $22K in first 7 days and $1M in 20 months on this model ([Market Clarity](https://mktclarity.com/blogs/news/ai-tools-top))

**TL;DR:** Projelli's $29/$49/$99 pricing is well-positioned as a "buy peace from the subscription stack" play. The implicit message is *"the $29–99 you pay me is the LAST money I'll ever ask; your usage costs go to OpenAI/Anthropic at API rates ($1–5/mo)."* Lead with that math.

---

## 6. Local-first and BYOK sentiment

**Sentiment is unambiguously rising and mainstream-adjacent.** Three pieces of evidence:

1. **JetBrains shipped BYOK in their AI Assistant in December 2025** — canary event. Big-tooling vendors don't ship BYOK unless paying customers demand it ([JetBrains](https://blog.jetbrains.com/ai/2025/12/bring-your-own-key-byok-is-now-live-in-jetbrains-ides/)).
2. **HN reaction to Notion AI exfiltration was wholesale flight, not "fix it."** *"I just migrated from notion to obsidian today."*
3. **A whole BYOK-discovery ecosystem now exists** — BYOKList, byok.tech — targeting users who want subscription-free apps using their own keys. Stat: *"Most people spend $1–5/month on API calls — not $20+ with traditional AI subscriptions"* ([BYOKList](https://byoklist.com/), [BYOK.tech](https://www.byok.tech/)).

### The real friction with BYOK (solve these)

- *"Where do I get a key?"* is the #1 onboarding drop point. Tools that ship a one-page guide with screenshots win.
- Key management for non-devs is scary. Projelli should encrypt at rest + never display plaintext after entry. **Projelli already does this** via OS keychain.
- Per-token costs worry users. **Show running cost estimates in real time** ("This conversation has cost you $0.04") — this is a category-winning UX feature nobody's nailed.

### Local-first vs hybrid

Pure local-first crowd wants Ollama/LM Studio. Most founders want **hybrid**: local for routine, cloud for hard problems. Emerging pattern: *"Discover in LM Studio → develop with Ollama → deploy with vLLM/cloud"* ([Open Tech Stack](https://open-techstack.com/blog/ollama-vs-lm-studio-local-llms-2026/)).

**Projelli relevance:** Ship Ollama support as 4th provider + per-template model selection. Frame as "most private tool in the category that still works with frontier models when needed."

---

## 7. Five high-leverage opportunities ("if Projelli shipped this, founders would notice")

Not a roadmap — a signal list. Filtered to things matching Projelli's guardrails.

### A. Real-time cost meter ("you've spent $0.07 this hour")

No major AI tool shows live API cost as you work. For BYOK founders especially, this is psychologically liberating (*"I can use it more — it's actually cheap"*) AND a viral demo moment. Expensive to build well; uniquely valuable. See `06-RECOMMENDATIONS_BY_LOE.md` Quick Win.

### B. Investor-update workflow that ingests Stripe + Linear + GitHub

Pre-built InvestorUpdate + BoardMeetingPrep templates. MCP connectors to Stripe API + repo. Draft uses real numbers and last update's tone. **Single highest-perceived-value template Projelli could enhance.** Today every founder hand-writes or pays $50/mo for Visible. Medium-Hard.

### C. "Show me what I should ship today" — context-aware morning briefing

Reads recent commits, calendar, last week's review → produces 3-bullet "today's leverage" doc. Pain is real per the "5 hours/week re-explaining" research. The daily habit hook that makes desktop apps sticky vs browser tabs. Big Bet.

### D. Workflow chaining: template output → next template input, no copy-paste

Greg Isenberg's "remix three or four AI tools" insight. If `CompetitorAnalysis` output can flow into `PricingStrategy` input, that's a real workflow OS. This is the #1 feature distinguishing "templates" from "actual workspace." Medium.

### E. Voice-tuned content workflow that learns from your existing posts

Point Projelli at your published LinkedIn/X/blog history → auto-generate style profile → ContentStrategy outputs sound like *you*. Founder community hostile to AI-flavored slop; a tool that DOESN'T sound like ChatGPT is a real moat. Medium-Hard.

---

## 8. Five TRAP insights ("founders wouldn't actually pay for this")

Things that look like demand but aren't.

### A. Generic PitchDeck generator

**Trap.** Alai, PitchGrade, PitchBob, Slidebean all exist. Churn through them in days. *"Consistent formatting, design, and textual errors within final outputs"* is the universal complaint. Hard to be better than Claude + Beautiful.ai manually. Keep the template; don't build special tooling around it.

### B. "AI Co-founder" / "Therapist for founders" positioning

**Trap.** Founders use ChatGPT for therapy privately and don't want to pay for it. The narrative ("AI emotional support for founders!") will get HN/PH attention but won't drive paid conversions. People don't want a relational bond with their workspace tool — they want a sharp tool. Vanta-style positioning doesn't survive contact with the wallet.

### C. Pure prompt library / template marketplace

**Trap.** PromptDen, PromptHero, AIPRM, PromptHub all exist; free community libraries dominate; willingness-to-pay near zero. Templates only have value when *bundled with execution* (workflow + routing + memory). The value is the ENGINE, not the library.

### D. Multi-agent / "team of AI workers" concept

**Trap.** Agent reliability is brutal (*37% agent-caused issues, 80–90% projects fail in production*). Founders skeptical of demos. If Projelli ships one flaky agent, the founder community will roast it. Stay in the "structured workflow" lane.

### E. Generic "Notion replacement" positioning

**Trap.** Notion alternatives are a graveyard (Capacities, AnyType, SilverBullet, Logseq, Obsibrain, Journal It, Cocube, Buildin, dozens more). Positioning against Notion puts you against their network effect AND every other Notion-killer. Position as a tool for founder *workflows*, not a knowledge base or notes app.

---

## 9. Build-in-public community specifics

Jameson's strategic choice re: build-in-public is still open (per `BOARD_ACTION_ITEMS.md` item A). If it tilts "yes," the community has these specific needs:

- **Auto-celebrating revenue milestones** half-built (Stripe → tweet triggers exist). No one's done end-to-end "your milestone, your visual, your draft tweet, scheduled." Jameson already understands this from Postiz.
- **"My numbers vs last month" weekly recap visuals.** Tool ecosystem doesn't generate these well.
- **Less performance, more grounding.** 2026 founders specifically want *"grounded, predictable, real"* tools, not performative AI.

---

## 10. Opinion-leaders whose endorsement matters (April 2026)

For manual outreach. One post from any of these moves Projelli meaningfully.

- **Pieter Levels (@levelsio)** — indie founder Pope. Anti-SaaS-stack so BYOK + one-time aligns with worldview. Transformational if he posts about Projelli.
- **Marc Lou (@marc_louvion)** — extremely active builder community. His audience is exactly the Projelli ICP.
- **Greg Isenberg (@gregisenberg)** — has forecasted "remix three or four AI tools into vertical workflows" as the 2026 startup pattern. Projelli IS that pattern wrapped as a desktop app.
- **Tibo (@tibo_maker)** — build-in-public archetype.
- **Damon Chen (@damengchen)** — TestimonialTo founder, vocal on tool stacks.
- **Simon Willison (@simonw)** — quoted directly above re: vibe-coding fatigue. Category-shaping voice for HN founders. A Willison blog post = high-leverage.

**Tactical note:** Don't cold-DM all 6 at launch. Send 1–2 thoughtful beta access offers to the 2 whose audience is most specifically the Projelli ICP (Levels, Lou). If they give honest feedback, the others become warmer.

---

## 11. The un-articulated opportunity

A theme across the research that doesn't show up as a single quote but is present everywhere:

**Founders want AI that respects what they've already thought through.** They don't want AI that rewrites their voice. They don't want AI that restarts from blank-page every conversation. They don't want AI that forgets what matters to them. They want a tool that *holds the thread* of their business across months and conversations, so the AI isn't a stranger every time.

This is what "memory" means in founder language, and it's why the Projelli chat-as-artifacts model resonates even when people can't quite articulate why. Every chat becomes a file. Every file is searchable. Next conversation, the AI can reference the file. The founder's thinking persists.

If Projelli's launch copy can crystallize this single idea — *"the AI workspace that doesn't forget you"* — it would be the difference between a $500 launch month and a $5,000 launch month.

---

## Bottom line

The founder community is ready for Projelli's positioning. Subscription fatigue, privacy panic, BYOK normalization, and context-loss frustration are all aligned with Projelli's structural differentiators. The features that would matter most are the ones that close the "memory" and "ask my stuff" gap (see `06-RECOMMENDATIONS_BY_LOE.md`).

The traps — agent demos, PitchDeck overbuilds, therapy positioning, prompt marketplaces, Notion-replacement — all look like demand but aren't. Avoid them.

The opinion-leaders are reachable with a specific, BYOK-forward pitch. The community narratives (data back, subscription-done, AI-should-do-the-work) are available to attach to. The pricing is right. The feature backlog is knowable.

What's needed now is sharp messaging and the highest-leverage 3–5 feature bets. Those are in `04-FEATURE_BRAINSTORM.md` (wide net), `05-DIFFERENTIATION_STRATEGY.md` (where to plant the flag), and `06-RECOMMENDATIONS_BY_LOE.md` (what to actually build).
