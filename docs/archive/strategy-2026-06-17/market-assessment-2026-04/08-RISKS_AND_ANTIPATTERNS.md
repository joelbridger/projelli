> **SUPERSEDED — history only.** Pre-advisor-reaim April 2026 market research.

# 08 — Risks and Anti-Patterns (what NOT to do)

> The features that look appealing but would compromise Projelli's differentiator, the marketing moves that would backfire, and the strategic mistakes the product is structurally at risk of making. Equal-weight document to `06-RECOMMENDATIONS_BY_LOE.md` — what Projelli does not build is as strategic as what it does.
> Sister docs: `05-DIFFERENTIATION_STRATEGY.md` for what's sacred, `04-FEATURE_BRAINSTORM.md` for the full set of ideas (some of which are here as explicit don'ts).

---

## The five strategic guardrails (restated)

Every recommendation in this assessment respects these. Violating them by accident is the #1 way to undo Projelli's moat.

1. **Local-first.** No cloud sync, no real-time collab, no Projelli-hosted data.
2. **BYOK forever.** No Projelli-managed AI keys, no per-token billing, no usage metering.
3. **Single-user.** No real-time collaboration, no shared vaults, no team features.
4. **One-time pricing.** No subscriptions, no tier upgrade treadmill, no lock-in.
5. **Desktop-only.** No mobile apps, no browser-only versions (beyond the dev surface).

Each siren song below is tempting because it solves a near-term problem. Each one breaks one of these five. And each break is the kind buyers can't see you make until after they've paid.

---

## The 10 siren songs

### Siren 1: Projelli-managed AI tier ("Pro Plus" or similar, $10-15/mo)

**The temptation:** Someone is going to email saying *"I love Projelli but I don't want to manage an OpenAI key — can you host it?"* The $10-15/mo upsell seems obvious and small.

**Why it's a trap:**
- Breaks guardrail 2 (BYOK forever)
- Creates a two-tier product: "with your key" and "with ours" confuses onboarding and messaging
- Margin compression — API costs eat subscription revenue, which means you'll eventually need to limit usage, which creates the exact frustration ChatGPT/Cursor users are fleeing
- Signals to BYOK buyers that you're going to deprecate BYOK eventually (even if you don't plan to)
- Introduces a cloud dependency, which makes "Projelli doesn't see your data" a lie

**What to do instead:**
- Make BYOK setup flawless (Q20 in `06-RECOMMENDATIONS_BY_LOE.md`)
- Show live cost meter (Q3) so users see API costs are $1-5/mo, not $20
- If people still ask for managed AI: tell them honestly that Claude.ai, ChatGPT, and Gemini are the right managed-AI products, and Projelli is not one

**How to say no to the email:** *"Managed AI is the business model of Notion AI and Claude Pro. They do it well and charge for it. Projelli is the opposite pitch: pay once, use your own key, never pay us again. If managed is what you want, Claude Pro is the right call."*

---

### Siren 2: Cloud sync between devices

**The temptation:** "I want my workspace on my laptop AND my desktop." Sounds reasonable. iCloud / Dropbox / Google Drive integrations seem lightweight.

**Why it's a trap:**
- Breaks guardrail 1 (local-first)
- Once Projelli implements sync, bug reports about conflicts, missing files, offline-merge issues become your problem, not iCloud's
- Every competitor has cloud sync; the moment Projelli has it too, the differentiation collapses
- Creates architectural complexity (CRDTs, conflict resolution, merge semantics) that's ~80-120 hours on its own and never really "done"

**What to do instead:**
- Tell users to put their workspace folder in iCloud Drive / Dropbox / Git / Syncthing. Those products are better at sync than Projelli can reasonably be.
- Ship a `/docs/sync-your-workspace` page explaining the options.
- Maybe build a "export to git + push" button as a convenience. Optional, not required.

**How to say no:** *"Projelli's folder is just files on disk. Put it in iCloud Drive or Dropbox or Syncthing and it'll sync. We're intentionally not building Yet Another Sync Layer."*

---

### Siren 3: Real-time collaboration / shared workspaces

**The temptation:** "My co-founder wants to work in the same workspace." Obvious market. Notion has it. AFFiNE has it.

**Why it's a trap:**
- Breaks guardrail 3 (single-user)
- Shifts Projelli into head-to-head competition with Notion and AFFiNE, where they win on network effects + feature count
- Requires WebSocket server, CRDT implementation, presence cursors, permission layers, identity — roughly 80-120 hours baseline plus ongoing infra costs
- Breaks the "no Projelli servers in path" story because collab requires a server
- Every founder who wanted collab was going to use Notion anyway; building it doesn't flip that buyer

**What to do instead:**
- For "my co-founder wants one too," sell a Team License ($199 one-time, 5 seats). Each seat has their own workspace. No sharing.
- If two people really need to collaborate on a doc: they trade files in Slack or git. This is the founder-community pattern anyway.
- Ship async-friendly export options (Q17 `/vs` pages use this messaging).

**How to say no:** *"Real-time collab is the Notion pitch. It's great if you need it. Projelli is single-user by design, because every founder I interviewed said their workspace being private is part of the value. If you need co-editing, Notion is the right tool and I'd recommend it."*

---

### Siren 4: Autonomous multi-agent fleets

**The temptation:** Notion Custom Agents, Cursor parallel agents, Devin, Manus, Replit Agent 4 all ship this. "Your agent team researches competitors while you sleep." Demo videos are jaw-dropping.

**Why it's a trap:**
- Agent reliability data is brutal: *37% of teams report agent-caused operational issues, 80-90% of agent projects fail in production*
- The founder community is explicitly skeptical ("AI creates work that looks finished but isn't" — pain #4 in VOC)
- Multi-agent orchestration requires cloud execution environments, sandboxing, process management — not a local-first story
- One flaky agent at launch and HN roasts you as "just another agent demo that doesn't work"
- The rewards are asymmetric: a working agent gets you "cool demo," a broken agent gets you refund requests and 1-star reviews

**What to do instead:**
- Ship **scheduled template runs** (B3 in `06-RECOMMENDATIONS_BY_LOE.md`) — 80% of the perceived benefit (delegation, work gets done while you sleep), zero of the hallucination risk
- Template-chaining (M7) covers "multi-step AI workflow" without claiming "multi-agent"
- If users press: *"I'm deliberately not building autonomous agents because they don't work reliably enough yet. Projelli does scheduled workflows: you pick a template, I run it on Monday at 9am with your inputs, you review the output. Same outcome, different framing, much less hallucination."*

**Language rule:** Don't use the word "agent" in Projelli marketing. Use "workflow," "scheduled run," "template." This sidesteps the cultural baggage.

---

### Siren 5: "AI co-founder" / "Projelli is your business partner" emotional positioning

**The temptation:** Character.AI has 20M MAU; 41% engage for emotional support. The AI-companion narrative is hot. Founders are lonely. "Projelli is the co-founder you never had" writes itself.

**Why it's a trap:**
- VOC research: founders use ChatGPT for therapy *privately* and don't want to pay for it. They want a sharp tool, not a relationship with their workspace.
- Character-first positioning will get HN / PH attention but won't drive paid conversions
- Attracts the wrong buyer: support-seeking users who convert poorly and churn high
- Conflicts with the "professional founder tool" positioning that drives the $49/$99 buying decision

**What to do instead:**
- Lightweight: let users define system prompt personality overlays ("respond like a senior PM who values brevity"). Keep it an option, not a pitch.
- Marketing voice: competent, direct, operator-focused. Not friendly, not warm, not "your journey matters."
- Let users find emotional utility privately if they want it; don't sell it.

**Red flag if you catch yourself writing:** "Your business partner," "your founder journey," "you're not alone," "AI that understands you." Delete. Rewrite as operator-speak.

---

### Siren 6: Generic "Notion replacement" positioning

**The temptation:** Notion alternatives get free SEO traffic. "X alternative to Notion" searches are high-volume.

**Why it's a trap:**
- The Notion alternatives graveyard: Capacities, AnyType, SilverBullet, Logseq, Obsibrain, Journal It, Cocube, Buildin, Workflowy — every single one is "Notion alternative" and none have meaningfully displaced Notion
- Notion's network effect is in collaboration and integrations, neither of which Projelli does
- Head-to-head comparison lets Notion pick the terrain (collab, mobile, embeds, databases — all areas Projelli weakly cares about)
- The 2026 Notion user is more entrenched than the 2020 one — agents ship monthly

**What to do instead:**
- Position as **a tool for founder workflows**, not a knowledge base or notes app
- The `/vs-notion` page (Q17) exists, but it's defensive positioning for the "I'm comparing" moment, not offensive positioning in the hero
- Hero should name the specific workflow moment Projelli wins (competitor analysis, pitch deck drafts, investor updates), not dance with Notion
- Lead with "designed for the job," not "not Notion"

**Framing rule:** Projelli vs Notion in hero copy is weak. Projelli vs "my AI stack is a mess" is strong.

---

### Siren 7: Plugin / extension marketplace

**The temptation:** Obsidian's plugin ecosystem is part of why people love it. "Let community extend Projelli" sounds empowering.

**Why it's a trap:**
- Plugin systems require: plugin API design (which constrains future refactors), sandboxing (security), dependency management, review/publishing process, documentation
- Plugins are the #1 source of bug reports in Obsidian ("plugin X broke the editor"). Support burden is high.
- The value is currently in Projelli being ONE POLISHED PRODUCT. Plugins shift the UX to "assemble your Projelli" — exactly the Obsidian failure mode buyers complain about
- Ecosystem building is a full-time job that requires a real community manager. Jameson is 5-10 hr/wk.

**What to do instead:**
- **MCP server (M4)** is the extensibility point. The MCP protocol is community-maintained by Anthropic + OpenAI + Google; Projelli inherits the plugin ecosystem for free.
- **User templates (Q19, B1)** cover the "let me customize this" need without a plugin API
- **Prompt library (B5)** covers "let me share my setup" without a plugin SDK

**How to say no:** *"Projelli extends through MCP, which is the standard all the major AI tools use. Anything a plugin could do, an MCP server can do — and it works in Claude Desktop and Cursor too, not just in Projelli."*

---

### Siren 8: Mobile app (iOS / Android)

**The temptation:** "I want to jot ideas on my phone." Notion, Obsidian, Bear, AFFiNE, Heptabase, AnyType, and basically every competitor have mobile. Buyers mention it.

**Why it's a trap:**
- Breaks guardrail 5 (desktop-only)
- Requires Swift / Kotlin codebases separate from Tauri — effectively building a second product
- Tauri mobile is alpha-quality as of April 2026 — not a shortcut
- App store fees (15% Apple / 15% Google) on one-time purchases compress margin
- Mobile users have different workflow patterns (capture, not authoring) — building a version of Projelli for phone means redefining the product
- Founder-community data: mobile is the most-asked-for thing they never actually use heavily. Aspirational feature.

**What to do instead:**
- Ship a **URL-based capture endpoint**: `projelli://capture?text=...` that any mobile app (Shortcuts, text expander) can hit to drop a note into your Projelli workspace
- Document the iCloud / Dropbox pattern so users can see their files on mobile in any Markdown app (iA Writer iOS, Taio, Bear)
- Revisit at the 12-month mark if ≥30% of buyers explicitly ask for it AND Tauri mobile is production-ready

**How to say no:** *"Projelli is desktop-only by design. Put your workspace in iCloud / Dropbox / Syncthing and read it on mobile in any Markdown app. The writing experience lives on the desktop; the reading experience travels."*

---

### Siren 9: Pivoting audience away from indie founders

**The temptation:** The first 100 paying customers may include 30 students, 20 writers, 10 lawyers, and only 40 founders. "The founder pitch isn't working. Let's broaden."

**Why it's a trap:**
- The previous panic-broaden (D&D / hobbies / family planning) was already rolled back once per `project_projelli.md`. The founder positioning is correct.
- Broad audience positioning dilutes marketing effectiveness — you end up generic
- 15 workflow templates that are founder-specific won't resonate with students or lawyers
- The ICP has concentrated distribution channels (HN, IH, X founder community) — broadening loses those channels' signal
- Founders pay more, churn less, and recommend louder than generic professionals

**What to do instead:**
- Trust the 100-customer data for 6 months before pivoting
- If non-founders are buying, understand WHY — maybe you accidentally built a good writer tool. Don't pivot, but make sure you're not blocking adjacent use cases
- Build out the founder workflows further instead of adding new audience slots

**How to say no to yourself:** Jameson has already ratified this. The voice in your head saying "broaden" is the same voice that led to the D&D mistake. Ignore it.

---

### Siren 10: Heavy VC-style feature arms race with Notion / Granola / Claude Code

**The temptation:** Notion shipped Custom Agents. Granola raised $125M. Claude Code ships weekly. Projelli feels slow by comparison. "We need to match them."

**Why it's a trap:**
- Projelli's advantage is structural constraints those companies can't abandon. Matching their feature pace would erode structural advantage AND fail to catch up on feature count
- The VC-tempo treadmill is designed for cash-burning startups. It's the wrong game for a one-time-pay indie product
- Shipping one flag per quarter, well, is better than shipping three flags poorly and breaking things
- Users buying Projelli are buying *intentionality*, not breadth

**What to do instead:**
- Ship the 4 flags over the 6-month horizon per `07-ROADMAP.md`
- Let competitors out-ship on feature count while Projelli out-positions on design
- Every quarter, re-audit `02-COMPETITIVE_DEEP_DIVE.md` and check: are competitors *changing their structural position*, or just adding features? If the former, adjust. If the latter, stay the course.

**Pacing rule:** 1-2 user-visible features per release, each fully polished, each with a blog post and a demo. Not 6 half-shipped things.

---

## Marketing anti-patterns

Beyond product sirens, six marketing moves to avoid.

### MA1: "AI-powered" as the lead

VOC pain #8: *"Buyers are not rewarding AI as a feature. They are rewarding AI as architecture."* Homepage that says "AI-powered workspace" signals feature-bolt-on, not architecture-first. Architecture language is "every chat becomes a file," "files live on your disk," "the AI reads your workspace."

### MA2: Feature-laundry homepage

Homepage that lists 12 checkmark features reads like an enterprise sales page. Founder-niche buyers scan for *positioning*, not feature count. Lead with the Flag 1 story, name one specific use-case moment, show one animated demo. Let them dig for features.

### MA3: "Better than ChatGPT" headlines

Direct negative positioning against ChatGPT reads as insecure. Even if true (for specific workflows), the buyer's response is "well, then just fix ChatGPT." Use "different shape" framing instead: *ChatGPT is brilliant at answering questions; Projelli turns the conversation into a file.*

### MA4: Social proof theater

Faked or vague social proof: *"Loved by hundreds of founders."* Real proof or no proof. For launch, use the founder's own credibility (Wheel Health, BehaviorUX) + specific named early users + specific metrics (*"23 founders on the email list as of launch day"*). Scarcity is honesty; inflation is a trust leak.

### MA5: AI-written marketing copy (the recursive tell)

The #1 cardinal sin: marketing copy for an AI tool that reads like AI wrote it. Em dashes, *"it's not X, it's Y"* parallelism, italicized fragments at sentence ends, consultant vocabulary. All the tells. Projelli's voice is specifically disciplined per `feedback_marketing_copy_voice.md` AND `feedback_no_em_dashes.md`. Violating it on Projelli of all products is the most corrosive possible mistake.

### MA6: Over-promising agents / automation / "AI does everything for you"

Buyers in April 2026 have been burned by agent demos. Under-promise, ship the demo, let the product surprise upward. *"Workflows that actually finish"* > *"autonomous AI that runs your business."*

---

## Operational anti-patterns

Business-side mistakes that undermine the product.

### OA1: Trying to scale support before sales

Don't build a Discord / forum / Slack community until there's something for it to moderate. Premature community gets lonely and embarrassing. Ship, get customers, *they* tell you when they want a community.

### OA2: Discounting below $29 early

Once you give away a $29 lifetime license to a beta tester, the price floor is psychologically $29. Don't offer $15 lifetime for "early supporters" — offer free licenses or nothing.

### OA3: Getting into the content hamster wheel without a retention hook

Weekly blog posts are a form of performance, not revenue. Don't start the content engine (BACKLOG W8-05) until there's a clear funnel: blog post → trial → activation → purchase. Content without funnel is noise.

### OA4: Building public voting / roadmap transparency too early

Pre-1000 customers, a public roadmap invites feature-request overflow and anchors expectations. Keep the roadmap internal until customer volume justifies community-driven prioritization. `07-ROADMAP.md` is internal.

### OA5: Ignoring the Apple / OpenAI announcement risk

WWDC (June 8-12) and the OpenAI super-app launch (H2 2026) are calendar events that can blow up Projelli's positioning overnight. Schedule space to respond, not to be surprised. Pre-draft reactive content.

### OA6: Relying on single-channel launch

Product Hunt alone, Show HN alone, or email list alone are each single points of failure. Multi-channel launch (PH + HN simultaneously, then IH + AlternativeTo + Reddit + newsletter outreach over 2 weeks) is the pattern. BACKLOG Weeks 6-7 already cover this; don't let launch week burn the follow-up energy.

---

## Strategic risks (not failures, but tail-risk events)

Things that could happen that significantly shift the calculation:

### SR1: Apple ships first-party AI-deep-integrated Notes at WWDC (June 8-12)

**Probability:** Medium-high. **Impact:** Medium.
**Mitigation:** Ship Mac before WWDC. Pre-draft "why Projelli vs Apple Notes + AI" reactive content. Highlight cross-platform + BYOK + founder-workflow (none of which Apple will match).

### SR2: OpenAI super-app launches and subsumes everything

**Probability:** Medium (H2 2026 shipment). **Impact:** High.
**Mitigation:** Defensive copy: *"Apple gives you Notes + Siri; OpenAI gives you ChatGPT + Canvas + Codex + Atlas. Both are vertical stacks tied to one vendor. Projelli works with whichever model you prefer, files live on your machine, and costs you $49 one time."*

### SR3: An Obsidian community plugin called "Founder Workflows" launches

**Probability:** Medium. **Impact:** Medium.
**Mitigation:** Accelerate M4 (MCP server) — that's the plugin-immune distribution. Also: ship the 15 templates with real demo quality so the marketing bar is higher than a weekend plugin can match.

### SR4: A YC-backed competitor launches with $5M+ in funding targeting the exact ICP

**Probability:** Low. **Impact:** High if it happens.
**Mitigation:** Shift to community / indie-hacker credibility positioning. VC-funded companies have structural reasons not to do BYOK-one-time-pay. Lean into the "indie alternative" framing.

### SR5: Claude Code ships a non-developer "workflow mode"

**Probability:** Low. **Impact:** High.
**Mitigation:** Projelli's pitch becomes "the non-CLI version of Claude Code, with OpenAI and Gemini support too, and version history on disk." Positioning still defensible.

### SR6: LemonSqueezy raises pricing or adds friction that breaks the one-time model

**Probability:** Low. **Impact:** Medium.
**Mitigation:** Gumroad and Paddle are alternatives. Migration cost is ~2 weeks. Document the stack before lock-in.

### SR7: Jameson's job at Wheel Health intensifies

**Probability:** Medium. **Impact:** High.
**Mitigation:** Roadmap in `07-ROADMAP.md` has a 30% margin built in. If the day job goes full-tilt, cut scope on Quick Wins, protect the M1→M4 critical path. Consider hiring a freelance engineer for specific sprints (~$5K per sprint) once revenue clears $3K MRR — that's the break-even point.

### SR8: A Projelli security incident / data loss bug

**Probability:** Low (desktop-local, no cloud). **Impact:** High.
**Mitigation:** Robust testing pre-launch (already per BACKLOG). Have a response template ready. Never silently fix security bugs — disclose + patch.

---

## How this document gets used

- **Whenever a new feature idea surfaces:** check the 10 Sirens. If it smells like one, don't build without explicit reconsideration
- **When writing marketing copy:** check the 6 MA items. Especially MA5 (voice).
- **During operational/business decisions:** check the 6 OA items.
- **Monthly:** re-read the Strategic Risks section and note any change in probability
- **Before committing to a large feature:** explicitly check against the 5 strategic guardrails

---

## Summary: the seven things to not do

Strip away the explanations; the hard-line rules are:

1. **Don't build a Projelli-managed AI tier.**
2. **Don't build cloud sync or multi-device workspace.**
3. **Don't build real-time collaboration.**
4. **Don't build autonomous multi-agent orchestration.**
5. **Don't position Projelli as "AI co-founder" or "emotional support."**
6. **Don't lead marketing with "AI-powered."**
7. **Don't let marketing copy sound AI-written.**

Everything else is a judgment call. These are non-negotiables for the next 12-18 months, until customer signal or market shift proves one of them wrong.

---

## Closing thought

The shortest path to killing Projelli isn't a competitor launch or a market shift. It's Jameson (or future Claude sessions) slowly pivoting the product toward the features buyers "asked for" without understanding which asks are real and which are the wrong audience requesting the wrong thing.

The differentiator is not the feature set. It's the *combination* of structural constraints that no competitor will ever match. Every siren song breaks one constraint. Every broken constraint cedes one advantage. The eventual product that matches all the sirens IS Notion. Notion is already built and it's not what founders said they wanted.

Stay sharp. Ship the 4 flags. Let the constraint-respecting product do its work.
