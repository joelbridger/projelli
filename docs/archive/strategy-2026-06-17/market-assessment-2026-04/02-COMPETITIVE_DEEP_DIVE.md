> **SUPERSEDED — history only.** Pre-advisor-reaim April 2026 market research.

# 02 — Competitive Deep Dive (April 2026)

> A per-competitor analysis of every meaningful player in and adjacent to the AI workspace category as of April 2026. Updated comparison matrix, threat rating, recent shipped features, and the structural reason each competitor *cannot* or *will not* close the gap to Projelli. Use this as reply ammunition for Product Hunt, Show HN, newsletter outreach, and any "how is this different from X" conversation.
> Sister docs: `01-MARKET_LANDSCAPE.md` for the 30K-foot view, `05-DIFFERENTIATION_STRATEGY.md` for where to plant Projelli's flag.
> Source baseline: `docs/reference/COMPETITIVE_LANDSCAPE.md` (2026-04-09) — this document updates and extends it.

---

## How to use this doc

When replying to "how is Projelli different from X?" on PH, HN, or in a newsletter email, the right structure is:

1. Open with what the competitor genuinely does well (1 sentence, sincere)
2. Name the structural constraint that makes them incapable of Projelli's pitch (1 sentence)
3. Describe the specific moment Projelli wins (1 sentence, concrete)

Each per-competitor section below gives you all three ingredients.

---

## Updated comparison matrix (42 tools)

This is the superset; shorter versions belong in marketing. The "Threat" column indicates direct competitive overlap with Projelli's ICP (solo indie founder wanting desktop AI workspace).

| Tool | Local-first | BYOK | AI native | Files on disk | Pricing | Audience | Recent ships (Oct '25 – Apr '26) | Threat |
|---|---|---|---|---|---|---|---|---|
| **Projelli** | Yes | Yes | Yes | `.md` | $0 / $29 / $49 / $99 one-time | Indie founders | 25K LOC Tauri, 15 templates, 3 providers streaming | — |
| Notion + Notion AI + Agents | No | No | Yes | Notion DB | $10/mo + AI credits | Generic teams | 3.0 Agents, 3.3 Custom Agents, 3.4 Voice+Dashboards | **HIGH** |
| Obsidian + Bases + Smart Connections + Copilot | Yes | Plugin | Plugin | `.md` | $0 + $4 Sync | PKM | Bases core plugin, SC 786K DLs, Copilot 100K+ | **HIGH** |
| ChatGPT (Atlas, Memory, Agent Mode) | Hybrid | No | Yes | None | $20/mo Plus | Anyone | Atlas browser, Tab Groups, Agent Mode, super-app announced | **HIGH** |
| Claude.ai (Projects, Artifacts) | No | No | Yes | None | $20 Pro / $200 Max | Knowledge workers | Projects+Artifacts free, persistent storage, MCP | **HIGH** |
| Claude Code (desktop/CLI) | Yes | Yes | Yes | Code files | Free w/ Claude Pro | Devs spilling to workflows | Redesigned desktop, Routines, Computer Use, /schedule | **HIGH** |
| Reflect | No | Partial | Yes | Their DB | $10/mo | PKM | Minor | Low |
| Tana | No | No | Yes | Tana graph | $10–18/mo + credits | Power users | Meeting Agents, 60 langs, Pro $18 | Med |
| Logseq | Yes | Plugin | Plugin | `.md` | Free | Outliner/PKM | DB still beta 3y running | Low |
| Mem.ai | No | No | Yes | Mem DB | $14.99/mo | Knowledge workers | Quiet, falling behind | Low |
| Cursor 3 | Desktop | Yes | Yes | Code | $20/mo Pro | Devs | Parallel agents, Cloud Agents, JetBrains ACP | Low (different cat) |
| Continue.dev | Yes desktop | Yes | Yes | Code | Free + $10 Hub | Devs | Background agents in CI, Hub marketplace | Low |
| AnyType | Yes (P2P) | No | Partial | Anytype objects | $0 / $5 / $99/yr / $299/yr | PKM privacy | Sovereign Collaboration, Local API for LLMs | Med |
| Capacities | No | Partial (Perplexity) | Yes | Object DB | $0 / $7.99 / $12 | Object thinkers | Perplexity provider, AI media analysis | Med |
| Heptabase | No | No | Yes | Their DB | $8.99 / $17.99 | Visual thinkers, students | AI Tutor, 1K free credits | Med |
| Saga | No | No | Yes | Their DB | $0 / $6+/mo | SMB workspaces | Keyboard-first AI | Low |
| AFFiNE v0.26 | Yes (option) | Partial | Yes | `.md` export | Free OSS / Cloud sub | Notion+Miro alt | Edgeless Mode, iOS/Android, 67K stars | **Med-High** |
| Craft | No | Partial | Yes | Markdown-ish | Free / $8/mo | Apple creators | MCP+API, on-device AI | Low |
| Bear 2.4 | Yes (Apple) | No | No | `.md` (iCloud) | Free / $2.99/mo | Apple writers | Math, callouts, OCR search | Low |
| iA Writer | Yes | No | Anti-AI | `.md` | $50 one-time | Writers | Authorship Tracking, paste-from-ChatGPT detection | Low (philosophical foil) |
| NotebookLM | No | No | Yes | None | Free + Plus | Researchers | Cinematic Video Overviews, Flashcards, 80 langs | Med |
| Granola | No | No | Yes | None | $0 / $14 / $35 | Founders/sales/PMs | $125M Series C, MCP server, personal+enterprise APIs | **HIGH** |
| Saner.AI / Cosmos | No | No | Yes | Various | $0–8/mo | ADHD founders | Skai assistant, auto-tag, connections | Low (watch) |
| NotePlan | Hybrid | Yes (OpenAI) | Partial | `.md` + tasks | $8–10/mo | Writers w/ tasks | Memo AI voice, transcription, handwriting OCR | Med |
| Roam Research | No | No | Limited | None | $15/mo | Legacy power users | Stagnant since 2023 | Very Low |
| Apple Notes + AI | Yes | No | Improving | Apple DB | Free | Apple users | Siri 2.0 expected at WWDC June 8–12, 2026 | Med (potential) |
| OneNote + Copilot Notebooks | Hybrid | No | Yes | OneDrive | $30/mo Copilot | MS shops | Notebooks redesigned, paywalling Copilot Apr 15 | Med |
| Workflowy | No | No | None | Their DB | Free / $4.99/mo | Outliners | Boards mode, no AI yet | Very Low |
| Coda (now Superhuman) | No | No | Yes | Coda docs | $10+ | Teams | Now in Grammarly/Superhuman bundle | Low (enterprise) |
| Linear + Linear Agent | No | No | Yes | Issues | $0 / $8+/seat | Dev teams | Linear Agent public beta, Code + Triage AI | Low (different cat) |
| Perplexity Spaces + Comet | No | No | Yes | None | $20 Pro / $200 Max | Researchers | Spaces 5K files, Comet browser, Memories | Med |
| Day One Gold | Hybrid | No | Yes | Day One DB | $0 / $50 / $75/yr | Journalers | Daily Chat voice, Go Deeper prompts | Low |
| Lex.page | No | No | Yes | None | $0 / $18/mo | Long-form writers | GPT 4.1 + Claude 4 Opus, AI checks | Low |
| Cline | Yes | Yes | Yes | Code | Free OSS | Devs | CLI, Plan/Act modes, MCP, 500K+ DLs | Low |
| Aider | Yes | Yes | Yes | Code | Free | Devs | Voice commands, advisor pricing | Low |
| Replit Agent 4 | No | No | Yes | Cloud | $20–100/mo + credits | Vibecoders | Effort-based pricing, extended thinking | Low |
| Devin 2.0 | No | No | Yes | Cloud | $20+/mo + ACUs | Eng teams | Slashed $500 → $20 | Low |
| MS Copilot Pages / Loop | No | No | Yes | M365 | $30/mo | Enterprise | Loop Recap killed May 2026 | Low |
| Typefully | No | No | Yes | None | $0 / $8 / $19 / $39 | Creators | AI Writing via Claude, PDF carousel | Low (diff cat) |
| Wispr Flow | Hybrid | No | Yes voice | None | $0 / Pro / Ent | Anyone typing | 4 OSes, Command Mode, Privacy Mode free | Med (adjacent) |
| Superhuman Suite | No | No | Yes | Various | $30 / $40 | Generic productivity | Grammarly+Coda+Mail+Go consolidation | Med (validates cat) |
| TypingMind | Yes | Yes | Yes | Local | $39–79 one-time | BYOK buyers | $1M revenue, $49 one-time signal | Low (adjacent, validating) |

---

## Per-competitor deep profiles

Each profile: what's new, strategic read, what they can't/won't ship, and the specific Projelli angle.

### Notion + Notion AI + Agents — threat: HIGH

**What shipped Oct 2025 – Apr 2026:**
- **Notion 3.0** (Sept 2025): autonomous agents doing 20-min unattended runs, [announcement](https://www.notion.com/blog/introducing-notion-3-0)
- **Notion 3.2** (Jan 20, 2026): agents on mobile, auto model selection across GPT-5.2 / Claude Opus 4.5 / Gemini 3
- **Notion 3.3** (Feb 24, 2026): Custom Agents with triggers and schedules, MCP integrations to Linear / Figma / HubSpot, [release notes](https://www.notion.com/releases/2026-02-24)
- **Notion 3.4** parts 1 + 2 (Mar 26 / Apr 14, 2026): voice input by default, presentation mode, dashboards, Salesforce/Box connectors, 28% page render perf improvement, [notes](https://www.notion.com/releases/2026-04-14)
- Custom Agents move from free preview to paid Notion credits add-on on **May 4, 2026**

**Strategic read:**
Notion has clearly decided the future is "agents that work for you in your workspace," not "Markdown editor with chat sidebar." Their agents are powerful and integrated, but they are cloud-only, pay-per-use credits on top of a $10/mo seat, and built around their proprietary block model, not files. Notion is becoming a managed AWS for productivity.

**What Notion can't or won't ship:**
Files on the user's hard drive in plain `.md`. Their entire business model is the proprietary block DB on their cloud. Local-first would gut their data moat and recurring revenue. This is structural, not a roadmap issue.

**Projelli angle:**
*"Notion's agents are cloud-only and pay-per-use. Projelli runs workflows on your own API keys against files on your hard drive. When Notion's agent does something you don't like, you pay Notion to try again. When Projelli's workflow does something you don't like, you edit the Markdown."*

---

### Obsidian + Bases + Smart Connections + Copilot for Obsidian — threat: HIGH

**What shipped Oct 2025 – Apr 2026:**
- **Obsidian Bases** (core plugin, 1.9.0+): native database system turning any folder of notes into tables/cards/maps with no third-party plugin, [docs](https://help.obsidian.md/bases)
- **Smart Connections**: passed 786,090 community downloads by Jan 2026; Smart Chat module split off into its own plugin with Smart Chat Pro tier, [stats](https://www.moritzjung.dev/obsidian-stats/plugins/smart-connections/)
- **Copilot for Obsidian** (Logan Yang's): 100K+ users, weekly releases, [site](https://www.obsidiancopilot.com/en)
- Obsidian core v1.9 shipped faster search, canvas improvements

**Strategic read:**
Obsidian is the closest philosophical cousin to Projelli, and it got more dangerous in two ways:
1. **Bases** means "I can build a CRM-like view of my customer interview notes" is now a native Obsidian capability, not a Notion-only feature
2. **Smart Connections + Copilot together approximate ~80% of Projelli's "AI in your vault" pitch for free**

The remaining 20% — chat-as-artifacts pattern, founder workflow templates, polished onboarding, single polished product — is where Projelli still wins. The asymmetry: Obsidian can ship that 20% with a single core-plugin update from a founder team that has no funding pressure.

**What Obsidian can't or won't ship:**
A unified, polished AI experience with three providers built-in and chat-as-artifacts. Their model is "we ship the editor; the community ships AI plugins." Centralizing AI breaks their ecosystem promise. Shipping polished founder-workflow templates would compete with their paid community plugins.

**Projelli angle:**
*"If your Obsidian + Smart Connections + Copilot + templates plugin stack is already working for you, there's no reason to switch. Projelli is for the people who want that experience without assembling it themselves. One polished app, three AI providers, 15 founder workflows, five minutes to set up."*

**Biggest risk:** A single breakout Obsidian community plugin called "Founder Workflows" could close the gap to near-zero overnight. Mitigate by shipping on schedule, owning the founder positioning, and making the "I don't want to assemble my own stack" message land.

---

### ChatGPT (Atlas + Memory + Agent Mode + super-app) — threat: HIGH

**What shipped Oct 2025 – Apr 2026:**
- **Atlas browser** (Oct 21, 2025): Chromium-based AI browser with Browser Memories, [release notes](https://help.openai.com/en/articles/12591856-chatgpt-atlas-release-notes)
- **Atlas Tab Groups** (Jan 2026), Auto search mode, Agent Mode (books appointments, does web tasks autonomously)
- **Canvas**: builds interactive apps, calls APIs
- **Memory**: applies across all chats with project-scoped memory, search/sort
- **Super-app announced** (March 2026): ChatGPT app + Atlas browser + Codex CLI combining into single desktop binary, [Hypebeast coverage](https://hypebeast.com/2026/3/openai-merges-chatgpt-codex-and-atlas-into-desktop-superapp), [Neowin](https://www.neowin.net/news/openai-to-merge-atlas-browser-chatgpt-and-codex-into-a-single-desktop-super-app/)
- **ChatGPT cancellations**: 1.5M in March 2026 alone per widely-cited stat (subscription fatigue real)

**Strategic read:**
The OpenAI super-app is the biggest existential question for Projelli that didn't exist a quarter ago. If OpenAI ships a desktop app combining chat + browser + coding + memory + project-scoped context in one binary, "I just use ChatGPT" stops being hand-wave and becomes literally true.

**What ChatGPT can't or won't ship:**
BYOK with non-OpenAI models (Claude, Gemini). They're OpenAI. Three-provider neutrality is structurally impossible. Also: files on disk as source of truth. Their model IS the chat, the artifact is secondary.

**Projelli angle:**
*"ChatGPT is brilliant at answering questions. The problem is the chat IS the artifact. Close the tab and the work is scattered across hundreds of conversations. Projelli takes the same streaming model and points it at a real folder. Your files are the source of truth, and you pick the model (Claude, OpenAI, or Gemini) per chat."*

---

### Claude.ai (Projects, Artifacts, persistent storage) + Claude Code — threat: HIGH

**What shipped Oct 2025 – Apr 2026:**
- **Projects + Artifacts now FREE** for all users, [Tom's Guide](https://www.tomsguide.com/ai/claude-just-made-two-of-its-best-features-free-heres-how-to-use-projects-and-artifacts)
- **Artifacts with persistent storage** across sessions + direct API calls + MCP integrations, [help center](https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them)
- **Claude Code redesigned desktop app + "Routines" research preview** (April 14, 2026), [VentureBeat](https://venturebeat.com/orchestration/we-tested-anthropics-redesigned-claude-code-desktop-app-and-routines-heres-what-enterprises-should-know)
- **Computer Use inside Claude Code** (March 2026) — no setup, Pro/Max tier
- **/schedule** for cron-style automation in Claude Code
- **Phone-to-computer remote prompting** in Claude Code

**Strategic read:**
Anthropic is doing what OpenAI is doing — converging chat + IDE + computer use into one product — but inside Claude Code, which is a CLI/desktop aimed at developers. The risk: Claude Code becomes the place power users do everything and "AI workspace" becomes a Claude Code subroutine. Anthropic has been more disciplined about not bolting workspace features into Claude.ai itself, leaving the founder-document-editor space more open than OpenAI does.

**What Claude.ai / Claude Code can't or won't ship:**
- **Claude.ai**: BYOK with non-Anthropic models. Same OpenAI-mirror problem.
- **Claude Code**: A polished founder onboarding with 15 non-developer workflow templates. They're a CLI for developers; adding "founder mode" cannibalizes Claude.ai positioning.

**Projelli angle vs Claude.ai:**
*"Claude Projects is the closest managed-cloud comparison. Upload reference docs, have a conversation against them. But the documents live in Anthropic's cloud, the conversation history lives in Anthropic's cloud, and if you want to take a generated doc and edit it later, you copy-paste it out. Projelli flips the model: the files are the source of truth, they live on your machine, the chat creates and modifies them."*

**Projelli angle vs Claude Code:**
*"Different tools for different jobs. Claude Code is a coding CLI. Projelli is for everything that surrounds coding: the business plan, the pricing page, the GTM doc, the pitch deck, the customer interviews, the weekly review, the investor update. If you're a solo founder writing code AND running the business, you'll probably use both."*

---

### Granola — threat: HIGH (newly relevant)

**What shipped Oct 2025 – Apr 2026:**
- **$125M Series C at $1.5B valuation** (March 25, 2026) led by Index Ventures + Kleiner Perkins, [TechCrunch](https://techcrunch.com/2026/03/25/granola-raises-125m-hits-1-5b-valuation-as-it-expands-from-meeting-notetaker-to-enterprise-ai-app/)
- **Pivot from meeting notepad to enterprise AI memory layer**
- **Spaces** (workspaces with folder ACLs), **MCP server**, **personal API for personal notes**, **enterprise API for team context**
- Pricing: $0 / $14 / $35

**Strategic read:**
Granola has more capital, mindshare, and momentum than any standalone "AI workspace for founders" play right now. The pivot to memory layer + APIs means they're trying to become the substrate other tools call into. They could ship a founder-templates layer in three weeks if they wanted.

**What Granola can't or won't ship:**
One-time pricing. Data on your machine. No Granola servers in the path. They just took $125M of growth capital. They need recurring revenue and they need to own the data to monetize the platform play. Shipping local-first one-time-pay would break the thesis they sold to investors.

**Projelli angle:**
*"Granola is brilliant for meeting notes and they just raised $125M to be your team's shared context layer. That's a different product for a different buyer. Projelli is for the solo founder who wants the same 'AI knows my stuff' feeling but with files on their own machine and no monthly bill."*

---

### AFFiNE v0.26 — threat: MED-HIGH (most under-discussed direct competitor)

**What shipped Oct 2025 – Apr 2026:**
- **v0.26.3** (Feb 25, 2026), last commit Apr 6, 2026 — actively developed, [releases](https://github.com/toeverything/affine/releases)
- **67.1k GitHub stars**
- **Edgeless Mode**: toggle one workspace between document and infinite whiteboard with one click
- **AFFiNE AI** summarizes a whiteboard into a doc
- **iOS and Android clients** shipped
- **Local-first option** exists alongside hosted cloud

**Strategic read:**
AFFiNE is the most under-discussed direct competitor for Projelli. They have local-first, they have AI, they have whiteboard + doc + database in one open-source app, and they have momentum (67K stars). The gap: they're targeting "Notion + Miro replacement for teams," not "founder workspace for solos." If they do a founder pivot, that's a real threat.

**What AFFiNE can't or won't ship:**
A solo-founder-focused product with founder workflow templates. They're chasing the Notion+Miro team segment. Solo-founder is a rounding error in their roadmap. Also: a curated, polished founder onboarding. OSS tools optimize for power users first.

**Projelli angle:**
*"AFFiNE is impressive as an open-source Notion+Miro alternative for teams. Projelli is focused on the solo indie founder running a business: 15 founder-specific workflow templates, three AI providers, one-time pricing. Different shape for a different user."*

**Monitor:** Any AFFiNE announcement mentioning "founders" or "solo" or "templates gallery."

---

### Claude Code — threat: HIGH (deserves its own subsection beyond Claude.ai)

The most important category-eating threat right now. Separated out because Claude Code is rapidly becoming the default "AI shell" for power users.

**Recent momentum:**
- Free for Claude Pro / Max subscribers
- Desktop app redesigned April 14, 2026
- Routines = cron-like automation (research preview)
- Computer Use landed in the IDE — no setup
- 80.9% SWE-bench score, ~5.5x fewer tokens than Cursor on identical tasks (33K vs 188K), [NxCode comparison](https://www.nxcode.io/resources/news/cursor-vs-claude-code-vs-github-copilot-2026-ultimate-comparison)

**The scenario:** A founder who already pays for Claude Pro tries Claude Code on a Tuesday, asks it to "draft a pitch deck and save it to my desktop," gets 60% of the Projelli value with zero installation. Every Claude user is one command away from being a half-converted Projelli user.

**Defense:**
- Claude Code is dev-flavored. Non-developers bounce off `cd` and terminal-first UX.
- No `.aichat` artifact concept — conversations don't become labeled workspace files automatically.
- No founder workflow templates.
- Claude Code only uses Claude. BYOK to OpenAI or Gemini is not on their roadmap.

**Projelli angle:**
*"Claude Code is incredible for developers. It's a terminal-shaped tool. Projelli is for the founder who isn't in a terminal all day — wiki-links, backlinks, side-by-side editing, 15 workflow templates that produce real documents, Claude + OpenAI + Gemini with one click to switch. Different shape for different work."*

---

### Reflect — threat: LOW

**What shipped Oct 2025 – Apr 2026:** Nothing material. Still $10/mo, still cloud-sync, still GPT-4 + Whisper for autocomplete and voice notes. Product is solid; velocity isn't there.

**Strategic read:**
Not moving. Reddit complaints in 2026 are the old ones ("no folders," "no databases," "$10/mo for a journal"), [ToolRadar](https://toolradar.com/tools/reflect).

**What Reflect can't or won't ship:**
Local files. One-time purchase. Their model is cloud-sync VC-funded subscription.

**Projelli angle:** Don't lead with Reflect in messaging. They're not the right foil.

---

### Tana — threat: MED

**What shipped Oct 2025 – Apr 2026:**
- Pro tier at $18/mo with 5,000 AI credits
- **AI Meeting Agent** transcribes in 60 languages, creates linked action items
- Reddit consensus unchanged: powerful but the supertag/graph model is too abstract for most users to absorb in a week

**Strategic read:**
Tana pivoting to meeting-centric "AI co-pilot for knowledge workers in meetings." Smart pivot but takes them further from founder-documents use case.

**What Tana can't or won't ship:**
A flat file tree someone can grok in 5 minutes. Tana's whole identity is supertag/graph abstraction.

**Projelli angle:**
*"Tana is incredibly powerful for people who want to model their entire life as a structured graph. Most people who try it bounce off in the first week because the model is too abstract. Projelli is the opposite — file tree, files, editor, chat. If you can use a Mac, you can use Projelli."*

---

### Logseq — threat: LOW

**What shipped Oct 2025 – Apr 2026:** DB version still in beta — through three years of "the new version is coming," [Logseq DB status](https://discuss.logseq.com/t/logseq-db-version-beta-release-date/31127).

**Strategic read:** Cautionary tale. Open-source community stagnation. Skip Logseq in marketing; the user isn't your buyer persona anyway.

---

### Mem.ai — threat: LOW

**What shipped Oct 2025 – Apr 2026:** Quiet. Still ~69 employees, $28.6M raised, no new headline ships, [Pitchbook](https://pitchbook.com/profiles/company/327411-82).

**Strategic read:** Became a feature, not a category. No longer the threat it was in 2024.

---

### AnyType — threat: MED (most ideologically aligned)

**What shipped Oct 2025 – Apr 2026:**
- **Sovereign Collaboration** (P2P co-editing, end-to-end encrypted, no central server)
- **Local API** now exposes integration with local LLMs for private AI
- Pricing: Free 1GB / $5/mo Plus / $10/mo Pro / $99/yr Builder / $299/yr Co-Creator, [roadmap](https://community.anytype.io/t/roadmap-update-2026-feb/30112)

**Strategic read:**
AnyType is the most ideologically aligned competitor. Local-first, encrypted, P2P. But it's an object database, not a Markdown editor, and the AI story is local-LLM-first, not BYOK-cloud-first. Watchpoint: Local API for LLMs.

**What AnyType can't or won't ship:**
Cloud-API LLMs (Claude, GPT, Gemini) as primary AI. Their identity is sovereign / P2P / local. BYOK to cloud APIs is philosophically opposite.

**Projelli angle:** Not direct competition yet. If AnyType ships a polished cloud-BYOK AI chat, reassess.

---

### Capacities — threat: MED

**What shipped Oct 2025 – Apr 2026:**
- **Perplexity as custom AI provider** (notable BYOK-adjacent move)
- AI Property Auto-Fill, multi-note context selection
- **AI media analysis** (image OCR/tagging) in Believer beta
- Cloud-first, subscription, [docs](https://docs.capacities.io/reference/ai-assistant)

**Strategic read:** Closest "object-thinking" competitor. Cloud-only, subscription, leaning toward content creators not founders.

**What Capacities can't or won't ship:**
Files on disk in plain `.md`. Their object model IS the value prop.

---

### Heptabase — threat: MED

**What shipped Oct 2025 – Apr 2026:**
- **AI Tutor** — structured tutor sessions inside note-taking system
- **1,000 free credits** to paid users through April 22, 2026
- Pricing $8.99 / $17.99, [pricing](https://heptabase.com/pricing)

**Strategic read:** Doubled down on deep learning / research use case. Winning in academia and self-learners but not chasing founders.

**What Heptabase can't or won't ship:**
A non-visual workflow for founders writing prose docs. They're a whiteboard-first learning tool.

---

### Saga — threat: LOW

Not moving. Treading water.

---

### Craft — threat: LOW

Apple-native, beautiful, subscription-only. 2026 ships: MCP+API integration, some on-device AI, [craft](https://www.craft.do/whats-new). Not chasing founders.

---

### Bear 2.4 — threat: LOW

Math formulas, callouts, OCR search added. Apple-only. No AI, [Bear updates](https://blog.bear.app/category/updates/).

---

### iA Writer — threat: LOW (philosophical foil)

**What shipped 2026:** **Authorship Tracking** — visually distinguishes what you wrote vs what was pasted from ChatGPT. Paste-from-ChatGPT auto-marks AI authorship, [version history](https://ia.net/writer/support/help/version-history).

**Strategic read:**
iA Writer is positioned as "honest writing without AI doing your work for you." They're a philosophically opposite tool. Worth referencing as a sincere alternative for writers who don't want AI at all — and Projelli respects user authorship by keeping files on disk and using AI as a transparent tool.

---

### NotebookLM — threat: MED

**What shipped Oct 2025 – Apr 2026:**
- **Cinematic Video Overviews** in 80 languages
- **10 infographic styles** (Sketch Note, Kawaii, Anime, etc.)
- **Studio panel** with revisable presentations
- **Flashcards + Quizzes** with progress tracking
- Free + Plus tiers, [Google blog](https://blog.google/technology/google-labs/notebook-lm-audio-video-overviews-more-languages-longer-content/)

**Strategic read:** Separate use case — research synthesis, not document drafting. But it's eating "I want to upload PDFs and ask questions." Worth noting in matrix, not a head-to-head.

**What NotebookLM can't or won't ship:**
Document creation / editing. They're a research-into-podcast tool.

**Projelli angle:** If you're synthesizing a stack of research papers into an audio summary, use NotebookLM. If you're drafting a pitch deck or competitor analysis from scratch, use Projelli.

---

### NotePlan — threat: MED (closest Apple-ecosystem cousin)

**What shipped Oct 2025 – Apr 2026:**
- **Memo AI** for voice-to-structured-notes
- Custom transcription prompts, handwriting-to-text on iPad/iPhone
- AI prompting with notes/folders as context
- ~$100/yr, files are `.md` with task syntax, [AI limits](https://help.noteplan.co/article/209-what-are-the-limitations-of-using-ai-features)

**Strategic read:**
Closest Apple-ecosystem competitor that's also `.md`-on-disk. Focused on "writer + planner" persona, not founders.

**What NotePlan can't or won't ship:**
Cross-platform (Apple-first). BYOK with Claude / Gemini (OpenAI-only).

---

### Roam Research — threat: VERY LOW

No major updates since 2023. ~1M MAU, dedicated but shrinking base.

---

### Apple Notes + Apple Intelligence — threat: MED (potential, date-dependent)

**What's coming:** WWDC 2026, **June 8–12, 2026**. Apple has confirmed AI focus. Siri 2.0 with personal context + on-screen awareness expected. Apple Notes AI deep-integration not yet announced but likely, [Geeky Gadgets](https://www.geeky-gadgets.com/apple-intelligence-wwdc-2026/).

**Strategic read:** The biggest near-term landscape risk. If Apple ships "Notes + Siri 2.0 with AI that writes/edits notes for you," macOS users get a free competitor preinstalled.

**What Apple Notes can't or won't ship:**
- Cross-platform (Windows, Linux)
- BYOK with three providers
- Chat-as-artifacts pattern
- Structured founder workflow templates
- Files in `.md` (Apple proprietary format)

**Projelli angle:** Ship the Mac build **before WWDC**, not after, so early-adopter Mac users find Projelli first.

---

### OneNote + Copilot Notebooks — threat: MED

**What shipped Oct 2025 – Apr 2026:**
- Copilot Notebooks redesigned: three-column layout, Audio Overview, expanded reference materials (PDFs, Copilot Pages), [Microsoft community](https://techcommunity.microsoft.com/blog/microsoft365copilotblog/meet-the-updated-copilot-notebooks-experience-your-home-for-understanding-work-p/4501383)
- **Paywalling Copilot in Word/Excel/PowerPoint/OneNote April 15, 2026** — only paid M365 Copilot ($30/mo) gets full Copilot, [Yahoo coverage](https://tech.yahoo.com/ai/copilot/articles/microsoft-moving-best-copilot-features-144421643.html)

**Strategic read:**
Microsoft sliding Copilot upmarket leaves indie/solo segment under-served. Tailwind for Projelli.

---

### Workflowy — threat: VERY LOW

Still no AI features. Falling behind.

---

### Coda (now Superhuman suite) — threat: LOW (enterprise)

Now the "all-in-one workspace" prong of the Superhuman suite. $10+/Doc Maker/mo. In $30/mo Superhuman bundle.

---

### Linear + Linear Agent — threat: LOW (different category)

Linear Agent public beta (March 24, 2026) on all plans. Code Intelligence, Triage Intelligence, semantic search, AI-summarized initiative updates as audio digest, [Linear changelog](https://linear.app/changelog/2026-03-24-introducing-linear-agent).

**Cultural marker:** "The CEO declared issue tracking dead." Agents are eating per-vertical SaaS. Leading indicator, not direct competition.

---

### Perplexity Spaces + Comet — threat: MED

**What shipped Oct 2025 – Apr 2026:**
- **Spaces up to 5,000 files per Space** (Enterprise Max) with custom instructions, SSO permissions, sync from Google Drive/Dropbox/Box, [help](https://www.perplexity.ai/help-center/en/articles/10352961-what-are-spaces)
- **Comet browser** shipped (cross-platform March 2026 with iOS)

**Strategic read:** Doing to research what Notion is doing to docs. Spaces + files + chat + custom instructions. Differentiator is web grounding. Not direct competition but Spaces is the closest UX cousin to "Projects with files."

---

### Day One Gold — threat: LOW

Gold tier $75/yr (Apr 8, 2026) with **Daily Chat** voice journaling, Go Deeper AI prompts, AI summaries, image generation. End-to-end encrypted, [9to5Mac](https://9to5mac.com/2026/04/08/day-one-journaling-app-introduces-gold-plan-with-ai-summaries-and-daily-chat/). Journal product, not workspace.

---

### Lex.page — threat: LOW

$18/mo Pro with GPT-4.1 + Claude 4 Opus + Sonnet. AI checks for grammar, brevity, clichés, readability, passive voice, [pricing](https://lex.page/pricing). Web-based long-form writer.

---

### Cursor 3 / Continue.dev / Cline / Aider / Replit Agent 4 / Devin 2.0 — threat: LOW (different category)

All are AI-native dev tools. Framing reference only. The pattern language Projelli inherits from this category:

- **BYOK** is the norm (Cursor, Continue, Cline, Aider)
- **One-time** or very cheap entry is common (Aider free, Continue free OSS + $10 Hub)
- **Agents as primitives** is how buyers think now (Cursor 3 parallel agents, Claude Code sub-agents)
- **Pricing pressure downward**: Devin went from $500 → $20/mo in 2026. Signal: the premium tier is compressing.

**Opportunity:** Position Projelli as "the Cursor or Claude Code equivalent, but for business documents instead of code." Most indie founders end up using a dev AI tool AND a workspace tool — they don't compete, they complement.

---

### MS Copilot Pages / Loop — threat: LOW

Loop Copilot Recap retired May 2026. Copilot in Office paywalled. Microsoft moving upmarket.

---

### Typefully — threat: LOW (different category)

AI Writing Assistant via Claude. PDF carousel. Creator tool. Adjacent, not competing.

---

### Wispr Flow — threat: MED (adjacent, partnership angle)

**Recent ships:** Cross-platform on Mac/Win/iOS/Android. Command Mode for voice editing. Privacy Mode free. SOC 2 / ISO 27001 / HIPAA BAA, [pricing](https://wisprflow.ai/pricing).

**Strategic read:** Dictation layer that complements (not competes with) Projelli. Potential partnership / featured-integration angle. Don't compete on voice input, *integrate* with Wispr Flow.

---

### Superhuman Suite (Grammarly + Coda + Mail + Go) — threat: MED (validates category)

**Recent ships:**
- **Grammarly rebranded to Superhuman** (consolidating email + docs + writing + agent layer), [announcement](https://www.grammarly.com/blog/company/announcing-company-rebrand-to-superhuman/)
- **Acquired Rows** in Feb 2026 for spreadsheets
- $30/mo Starter, $40/mo Business

**Strategic read:** Validates the bundle play but aimed at sales/business teams. Reference as "big guys are building agents too and they're charging $30/mo for it."

---

### TypingMind — threat: LOW (adjacent, validating benchmark)

Not a direct competitor but a validation: **$1M revenue in 20 months** on $39–79 one-time BYOK pricing. Proves the Projelli pricing band is the right shape.

---

## Top 5 emerging threats to watch most carefully

1. **Claude Code as a category-eating AI shell.** April 14, 2026 redesigned desktop + Routines + Computer Use + free for Claude Pro. Every Claude user is one command away from "AI workspace." *Watch for:* Claude Code shipping a non-developer onboarding or "workflows" feature.

2. **The OpenAI super-app.** Announced March 2026. When it ships (likely H2 2026), "I just use ChatGPT" becomes a literal all-in-one. *Watch for:* launch date and whether they ship a file-system-aware editor surface.

3. **AFFiNE going founder-focused.** Local-first + AI + whiteboard/doc/DB + OSS momentum (67K stars). *Watch for:* AFFiNE marketing mentioning "founders" or "solo" or "templates gallery."

4. **A breakout Obsidian community plugin called "Founder Workflows" (or similar).** Smart Connections has 786K downloads. The same devs could ship "Founder OS for Obsidian" in a weekend. *Watch for:* ProductHunt launches tagged "Obsidian + AI" or "Obsidian template" in the next 60 days.

5. **Granola going horizontal with MCP + APIs.** $125M Series C means they can ship anything. Their "personal API" is one product release away from being the substrate other apps wrap as a founder workspace. *Watch for:* Granola "Spaces for solo users" tier or a Granola desktop app.

---

## Feature gaps Projelli has vs leaders (honest self-assessment)

Don't hide these in marketing. The ones to close in the 6-month horizon are marked.

| Gap | Who has it | Close in 6 months? | Why |
|---|---|---|---|
| Autonomous agents that run on schedule | Notion, Cursor, Claude Code, Linear | Partial | Schedule + hotkey triggers yes, full autonomy no |
| Database/structured views over notes | Notion, Obsidian Bases, Capacities, Tana, AnyType | Low priority | Not the founder-docs use case |
| AI-built artifacts (React apps/HTML) | Claude Artifacts, Notion AI, ChatGPT Canvas | Partial via Canvas-style editing | See `06-RECOMMENDATIONS_BY_LOE.md` |
| **Voice input by default for AI prompts** | Notion 3.4, Wispr, ChatGPT | **YES** | Feasible with Whisper/Parakeet.cpp |
| **Local LLM support (Ollama)** | Smart Connections, AnyType, Continue | **YES** | 4–6 hours of work |
| **Embeddings / semantic search across vault** | Smart Connections, Copilot, Mem, NotebookLM | **YES** | LanceDB + e5-small fit Tauri |
| **Cross-document AI ("ask my notes")** | NotebookLM, SC, Copilot, Notion AI | **YES** | Depends on embeddings |
| Mobile app | Notion, Obsidian, AFFiNE, many | No | Desktop-only by design |
| Real-time collaboration | Notion, AFFiNE, Logseq RTC, AnyType | No | Single-user by design |
| Web clipper / browser extension | Obsidian, Notion, Reflect | Partial | Basic clipper feasible |
| Calendar / task integration | NotePlan, Saner.AI, Reflect, Tana, Day One | Low priority | Founder templates cover most |
| Audio overview / podcast generation | NotebookLM, Granola, Day One Gold | Partial | Voice output yes, podcast no |
| PDF parsing / OCR / image analysis | NotebookLM, Heptabase, Capacities | Partial | Via vision models BYOK |
| **MCP server + client** | Notion 3.3, Granola, Cursor, Claude Code | **YES** | Biggest distribution lever |
| Authorship tracking | iA Writer | Low priority | Niche |

The five in bold are what `06-RECOMMENDATIONS_BY_LOE.md` proposes to close in the 6-month window. They're also the ones compounding into one coherent story: *Projelli is the AI workspace that knows your stuff and connects to every other AI tool.*

---

## Where Projelli is structurally stronger than each competitor

The "things competitors literally can't or won't ship because of their constraints" table. These are the hard moat. Use as reply ammunition.

| Competitor | What they can't or won't ship | Why |
|---|---|---|
| Notion | Files on user's hard drive in `.md` | Gut their data moat and recurring revenue |
| ChatGPT / Atlas | BYOK with non-OpenAI models | They're OpenAI |
| Claude.ai | BYOK with non-Anthropic models | Same, mirrored |
| Claude Code | Polished founder onboarding with workflow templates | They're a dev CLI |
| Granola | One-time pricing; no Granola servers in path | Took $125M growth capital |
| Obsidian | Unified polished AI with 3 providers + chat-as-artifacts | Breaks their ecosystem promise |
| Reflect | Local files; one-time purchase | VC-funded subscription model |
| Tana | A flat file tree comprehensible in 5 minutes | Supertag/graph is their identity |
| Logseq | A polished founder-onboarded experience | OSS volunteer project |
| AFFiNE | Solo-founder-focused product with founder workflows | Chasing team/enterprise |
| AnyType | Cloud-API LLMs as primary AI | Sovereign/P2P identity |
| Capacities | Files on disk in plain `.md` | Object model is their value prop |
| Heptabase | Non-visual workflow for founders writing prose | Whiteboard-first learning tool |
| NotebookLM | Document creation/editing | Research-into-podcast tool |
| Apple Notes + AI | Cross-platform, BYOK, 3 providers | Apple ecosystem lock-in |
| OneNote + Copilot | $0 tier with full AI; works offline | Microsoft moving upmarket |
| iA Writer | AI-as-primary-input | Explicitly anti-AI-doing-work-for-you |
| NotePlan | Cross-platform, BYOK with Claude/Gemini | Apple-first, OpenAI-only |
| Cursor/Continue/Cline/Aider | Anything for non-developers | They're code editors |
| Day One Gold | Document-based workflow, not journal-only | They're a journal product |
| Lex.page | Files on disk, Markdown-as-source | Cloud long-form editor |
| Wispr Flow | Document/file management surface | Input method, not workspace |
| Superhuman Suite | One-time pricing under $50 | $30–40/mo enterprise stack |

**The synthesis:** Projelli is the only product that holds all four of {desktop app + files on disk + BYOK with three providers + founder workflow templates}. Every competitor breaks at least one, usually structurally — it's not a feature gap, it's their business model.

---

## Quick reference: pricing comparison

For homepage FAQ and PH/HN replies.

| Tool | Annual (1y) | Annual (3y) | Model |
|---|---|---|---|
| **Projelli Pro** | **$49** | **$49** | One-time, 1yr updates |
| **Projelli Lifetime** | **$99** | **$99** | One-time, updates forever |
| Notion + Notion AI | $240 | $720 | $10 + $10 AI/mo |
| ChatGPT Plus | $240 | $720 | $20/mo |
| Claude Pro | $240 | $720 | $20/mo |
| Reflect | $120 | $360 | $10/mo |
| Tana Pro | $216 | $648 | $18/mo |
| Mem.ai | $180 | $540 | $14.99/mo |
| Granola Pro | $168 | $504 | $14/mo |
| Capacities Believer | $144 | $432 | $12/mo |
| Heptabase Premium | $216 | $648 | $17.99/mo |
| Superhuman Starter | $360 | $1080 | $30/mo |
| Obsidian | $0 | $0 | Free core |
| Logseq | $0 | $0 | OSS |
| iA Writer | $50 | $50 | One-time |
| TypingMind | $39–79 | $39–79 | One-time |

**Projelli Lifetime pays for itself in 5 months vs the cheapest cloud-subscription competitor.**

---

## Update cadence

This document should be re-audited **every 90 days**. Notion, Obsidian, Anthropic, and OpenAI are moving monthly; claims true today will be stale in Q3. The structure stays; per-competitor paragraphs refresh.

**Next scheduled audit:** July 2026 (pre-Q3 strategic check-in)
**Triggering events that warrant early audit:**
- Apple WWDC 2026 announcement (June 8–12)
- OpenAI super-app launch date
- Any new entrant crossing 100K GitHub stars or $10M raised in the category
