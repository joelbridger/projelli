# 06 — Recommendations by Level of Effort

> The triaged buildable list. ~30 specific recommendations drawn from `04-FEATURE_BRAINSTORM.md`, grounded in the codebase audit findings (LOE estimates use Jameson's actual code as the baseline), and prioritized by the differentiation strategy in `05-DIFFERENTIATION_STRATEGY.md`. Every recommendation includes the WHAT, WHY, WHO ELSE has it (or doesn't), LOE, IMPACT, and DEPENDENCIES.
> Sister doc: `07-ROADMAP.md` sequences these against the 8-week launch + 6-month horizon.

---

## How to read this

LOE calibrated for Jameson's 5-10 hr/week side-project pace:

- **Quick Win (Q#)**: 1-8 hours. Doable in a weekend. Ship pre-launch or shortly after.
- **Medium (M#)**: 1-4 weeks of side-project time (~8-40 hours). Ship in v1.1–v1.3.
- **Big Bet (B#)**: 1-3 months of side-project time (~40-120 hours). Ship in v1.4+.

Each item's expected **IMPACT** is rated low / med / high based on:
- Frequency of the underlying pain (from `03-USER_INSIGHTS.md`)
- Visibility in launch/demo materials
- Marketing pull (can you post a screenshot and get engagement?)
- Moat contribution (does it make Projelli harder to displace?)

**DEPENDENCIES** name other items that must ship first, or infrastructure that must exist.

---

# QUICK WINS (≤1 day each, 20 items)

## Q1 — Ship Mermaid rendering

**What:** Load the `mermaid` npm package; render fenced code blocks with ` ```mermaid` language identifier in `MarkdownPreview.tsx`.

**Why:** CLAUDE.md claims Mermaid support. Source says no. This is a documented doc/code mismatch per codebase audit. Users will paste Mermaid diagrams (AI outputs them) and see raw text; they'll assume it's broken.

**Who has it:** Obsidian (plugin), Notion, GitHub, Bear (2.4), most modern Markdown editors.

**LOE:** ~3-4 hours. Install package, wire preview, test 3 diagram types.

**Impact:** MED. Low marketing pull, but high "credibility tax" — without it, Projelli looks half-finished when anyone tests Markdown features.

**Dependencies:** None.

---

## Q2 — Ship KaTeX math rendering

**What:** Load `katex` (or `rehype-katex`), render `$...$` inline and `$$...$$` block.

**Why:** Another doc/code mismatch. Founders with technical backgrounds will paste formulas.

**Who has it:** Obsidian (plugin), Notion, Bear 2.4, iA Writer, Typora.

**LOE:** ~2-3 hours.

**Impact:** LOW-MED. Niche-loved.

**Dependencies:** None.

---

## Q3 — Real-time API cost meter in chat

**What:** Bottom-right of chat pane: `$0.04 this chat / $0.17 today`. Each provider's streaming response includes token counts or you count them via `tiktoken`. Existing ProviderMetadata already includes pricing (input/output per 1K tokens).

**Why:** Named VOC insight A. BYOK founders have cost anxiety; showing the actual number is liberating ("I thought this would cost me $20, it's $0.17"). Category-winning UX — no competitor does this.

**Who has it:** Nobody prominently. Latitude and a few LLM playgrounds show per-call cost but not real-time cumulative.

**LOE:** ~4-6 hours. Token counting per provider response, aggregation in chat store, small UI component.

**Impact:** HIGH. Screenshot-able, Twitter-viral, directly addresses Pain #3 (cost unpredictability).

**Dependencies:** None. (Ideally first step because it reinforces every other BYOK-related pitch.)

---

## Q4 — Monthly cost dashboard (settings)

**What:** Small settings panel: "This month you spent $2.38 across Claude ($1.60), OpenAI ($0.61), Gemini ($0.17)." Data is in the audit log per codebase audit.

**Why:** Pairs with Q3. Reinforces the "you pay <$5/mo to operate Projelli" story.

**Who has it:** Nobody in this segment.

**LOE:** ~4-6 hours. Aggregation query, small chart.

**Impact:** MED. Reinforces launch narrative; helps retention.

**Dependencies:** Audit log has the data (already true per codebase audit).

---

## Q5 — Audit log export (CSV / JSON)

**What:** Add "Export" button to `AuditLog.tsx`. Serialize structured entries.

**Why:** Audit log is a hidden capability. Export unlocks compliance / record-keeping use cases (regulated founders) and lets users analyze their own AI usage.

**Who has it:** Notion (partial, enterprise only), Linear (paid plans). Nobody in the local-first segment.

**LOE:** ~2-3 hours.

**Impact:** LOW-MED. Niche-loved; "compliance / privacy" trust signal.

**Dependencies:** None.

---

## Q6 — Audit log filtering UI

**What:** Filters on `AuditLog.tsx` by date range, model, action type.

**Why:** Makes the existing data useful. Per codebase audit, this is a hidden capability worth surfacing.

**LOE:** ~3-4 hours.

**Impact:** LOW. Supports Q5 use case.

**Dependencies:** None.

---

## Q7 — Add Ollama as 4th provider

**What:** New `OllamaProvider.ts` implementing the `Provider` interface. Auto-detect Ollama on `127.0.0.1:11434`. List installed models via `/api/tags`. Streaming via Ollama's SSE endpoint. Proxy through Rust because of Tauri CSP (the allowed-origins list needs updating or a Rust sidecar).

**Why:** Privacy-maximalist founders love this. 2026 has mainstreamed local LLMs (Ollama 0.19 with MLX). Anchor of Flag 4 in differentiation strategy.

**Who has it:** Smart Connections, AnyType, Continue, Cline. In the Projelli-like segment: nobody polished.

**LOE:** ~4-6 hours for basic send + streaming. Add ~2-3 hours for Tauri CSP proxy.

**Impact:** HIGH. Specific launch-moment appeal ("privacy-first mode now supported"). Unblocks Flag 4.

**Dependencies:** Tauri CSP update for 127.0.0.1:11434 OR a small Rust sidecar fetch command. Codebase audit flagged CSP as a constraint.

---

## Q8 — Per-template model assignment

**What:** Each workflow template gets a default model; user can override. Settings UI for "use Claude Opus for PitchDeck, Ollama llama3.1 for DailyReview."

**Why:** Fastest way to make Ollama (Q7) actually useful without forcing users to change models every time.

**LOE:** ~3-4 hours. Template schema gets a `defaultProvider` + `defaultModel`. Settings UI is a table.

**Impact:** MED.

**Dependencies:** Q7 (Ollama).

---

## Q9 — Claude Haiku 4.5 as default for free-tier users

**What:** Set the free-tier default model to Claude Haiku 4.5 (cheap, fast). Users can change it.

**Why:** Free tier is about hooking users into the BYOK pattern. Haiku is cheap (< $0.10 per typical workflow) and fast. Makes first-run feel snappy.

**LOE:** ~1 hour. Change the default config.

**Impact:** MED. Reduces free-tier drop-off.

**Dependencies:** None.

---

## Q10 — Template preview gallery (filled-out examples)

**What:** `website/examples/` + a gallery page. Each of the 15 templates has a pre-filled example showing the final output (not the interview form). PDF or HTML screenshots.

**Why:** Critical marketing gap. The current homepage shows template NAMES ("PitchDeck"), not what the OUTPUT looks like. The Feature Brainstorm lists this as #109. Shows what the AI actually produces.

**Who has it:** Notion (template gallery shows outputs). Obsidian (vault demos). Projelli does not.

**LOE:** ~6-8 hours. Run each of 15 templates on a fictional company ("Acme Widgets"), save outputs, build a simple gallery page.

**Impact:** HIGH. Direct conversion driver; fixes the "I don't know what this does" drop-off.

**Dependencies:** None. (Jameson can do this in a weekend.)

---

## Q11 — Sample workspace on first run

**What:** On first launch, offer to populate workspace with 3 sample files: "Sample — Pricing Strategy.md", "Sample — Pitch Deck.md", "Sample — Weekly Review.md". Plus a README that says "these are examples — edit or delete as you like."

**Why:** Empty workspace is a drop-off moment. Samples make Projelli "what it does" tangible in 30 seconds. Related to Q10 but inside the product.

**Who has it:** Notion, Bear, Heptabase.

**LOE:** ~3-4 hours. Content is already written if Q10 is done.

**Impact:** MED-HIGH. First-run conversion.

**Dependencies:** Should share content with Q10.

---

## Q12 — Smart paste: URL → Markdown link with title

**What:** Paste a URL anywhere, editor fetches `<title>` and inserts `[title](url)` instead of just the URL.

**Why:** Quality-of-life win. Nothing ships this well in the Projelli-like segment.

**LOE:** ~2-3 hours. Detect URL on paste, fetch title (via Rust sidecar to avoid CORS), format.

**Impact:** LOW-MED. Feels magical.

**Dependencies:** None.

---

## Q13 — Image paste + auto-save to `workspace/media/`

**What:** Paste or drop an image anywhere → saves to `workspace/media/YYYY-MM/image-<hash>.png` and inserts `![](media/...)`.

**Why:** Founders paste screenshots constantly. Today this either fails or inserts Base64 data URIs.

**Who has it:** Obsidian (well), Bear, Notion.

**LOE:** ~4-6 hours. Clipboard image detection, file write, reference insertion.

**Impact:** MED. Removes friction.

**Dependencies:** Tauri drag-drop is currently disabled in config per codebase audit — needs re-enabling or a custom paste handler.

---

## Q14 — Wiki-link autocomplete polish

**What:** Typing `[[` shows file autocomplete. Likely already exists per codebase audit; verify and polish.

**Why:** Obsidian-parity. Expected behavior for anyone familiar with `.md` workflow.

**LOE:** ~2-3 hours if it exists and just needs UX polish. ~4-6 if building.

**Impact:** MED. Friction remover.

**Dependencies:** None.

---

## Q15 — "Run on all 3 providers" button in chat

**What:** Existing `ComparisonView.tsx` suggests this was scaffolded. Wire a button in chat that sends the same prompt to all configured providers simultaneously and shows outputs side-by-side.

**Why:** VOC Request #2: multi-model comparison in one workflow. Provider interface supports it per codebase audit.

**Who has it:** Nobody polished. OpenRouter / NanoGPT solve routing, not comparison.

**LOE:** ~6-8 hours. Parallel calls, comparison UI, "keep this one" to promote one output.

**Impact:** HIGH. Demo moment. Shows off BYOK value (free to run on all 3 because it's your keys, not Projelli's credits).

**Dependencies:** Multiple keys configured. Free tier is single-provider so this is a Pro feature (tier-gated via existing `useLicense` hook).

---

## Q16 — Keyboard shortcut cheatsheet overlay

**What:** Press `?` anywhere → modal showing all shortcuts grouped by category.

**Why:** Standard desktop app polish. Reduces "I can't remember how to..." friction.

**LOE:** ~3-4 hours. Build modal, collect shortcut list from existing code.

**Impact:** LOW.

**Dependencies:** None.

---

## Q17 — Write the `/vs-obsidian` and `/vs-notion` comparison pages

**What:** `website/vs/obsidian.html` and `website/vs/notion.html`. Content is mostly in `docs/reference/COMPETITIVE_LANDSCAPE.md` already.

**Why:** Every SaaS in this category has these pages and they drive meaningful organic traffic. Projelli's positioning is sharpest when compared.

**LOE:** ~4-6 hours. Lift content, polish for public voice (per voice rules), add screenshots from Q10.

**Impact:** HIGH. SEO + conversion driver post-launch.

**Dependencies:** Q10 (for screenshots).

---

## Q18 — In-app changelog / "What's New"

**What:** On first launch after an app update, show release notes. Link to full CHANGELOG.md on GitHub.

**Why:** Expected behavior. Increases feature discovery, signals active development (important for one-time-pay buyers worried about abandonment).

**LOE:** ~3-4 hours.

**Impact:** LOW-MED.

**Dependencies:** None.

---

## Q19 — Template fork / remix

**What:** "Duplicate this template" button. Creates a user-editable copy in `~/.projelli/user-templates/`. User can tweak the system prompt. (Schema stays the same; prompt-only edit.)

**Why:** Biggest UX uplift for template power users without needing a full template editor (that's B1). Users often want to tweak tone ("more casual") or add a constraint ("must mention Acme's budget").

**Who has it:** Nobody in this segment.

**LOE:** ~6-8 hours. File storage layer, small editor UI for the system prompt, template loader respects user-templates dir.

**Impact:** HIGH. Huge power-user unlock. Pro-tier differentiator.

**Dependencies:** None.

---

## Q20 — First-run API-key onboarding with screenshots

**What:** Replace the current API key entry with a 3-step guided flow per provider: 1) "Go here [deep link]" 2) screenshot of where to click 3) paste the key. Show estimated monthly cost ("$2-5 typical").

**Why:** Named VOC pain: "Where do I get a key?" is the #1 onboarding drop point. Tools that do this well win BYOK conversion.

**LOE:** ~6-8 hours. Content work, some UI for the wizard. Jameson is a Product Designer — this is in his wheelhouse.

**Impact:** HIGH. Directly fixes a named conversion blocker.

**Dependencies:** None.

---

# MEDIUM (1-4 weeks of side-project time, 8 items)

## M1 — Local RAG with LanceDB + fastembed-rs + e5-small (FLAG 1 foundation)

**What:** Background indexing of every workspace file. Embedding model: e5-small (384d, ~25-30ms/chunk). Vector DB: LanceDB (Tauri-friendly, Rust-native, in-process). Incremental updates on file save. Expose a `retrieve(query, top_k)` method to the chat layer.

**Why:** This is the foundation for "Flag 1: The AI workspace that remembers your stuff." Also unlocks M2, M5, M6. VOC Pain #2 (context amnesia), Request #1 (portable memory).

**Who has it:** Smart Connections (Obsidian plugin, 786K DLs). Mem.ai. NotebookLM. Nobody in Projelli's exact segment.

**LOE:** ~2-3 weeks. fastembed-rs integration (~4h), LanceDB Rust integration (~6h), incremental indexing (~8h), retrieval API (~4h), testing with large workspaces (~8h).

**Impact:** VERY HIGH. The single highest-leverage feature. Every other feature gets better when the AI can see your files.

**Dependencies:** Tauri + Rust backend (already in place). May need a Tauri plugin or sidecar for background indexing.

---

## M2 — `@workspace` command + "Ask my workspace" chat mode

**What:** Two user-facing surfaces for M1:
1. In any chat, typing `@workspace` auto-fills the latest relevant chunks from the vector index into the prompt, with citations.
2. A dedicated "Ask my workspace" button that switches the chat into retrieve-first mode, responses cite which file + paragraph.

**Why:** Named VOC Request #1. Makes M1 visible to the user. Demo-able.

**Who has it:** NotebookLM does "ask your notes" best. Smart Connections does this within Obsidian. Reor is trying.

**LOE:** ~1 week. Prompt templating for retrieval, citation UI, chat mode toggle.

**Impact:** VERY HIGH. This is the demo moment for Flag 1.

**Dependencies:** M1.

---

## M3 — Local memory facts file + fact extraction

**What:** `workspace/.projelli/memory.json` with long-lived facts ("company is Wheel Health," "ships on Fridays," "voice prefers contractions"). Pre-pended to system prompts for all chat. Fact-extraction: every 10 messages, AI proposes 1-3 new facts. User approves or rejects.

**Why:** The second half of Flag 1. Closes VOC Pain #2 (context amnesia) directly. Addresses "I have to re-explain my context every chat."

**Who has it:** mem0 (as a library), ChatGPT Memory, Claude Memory (in Pro/Max). Nobody local-first.

**LOE:** ~1-2 weeks. JSON schema + CRUD (~6h), fact-extraction prompt (~4h), prepending logic (~4h), UI for review/accept facts (~8h).

**Impact:** HIGH. Compounds M1 and M2.

**Dependencies:** None strict. Better with M1.

---

## M4 — Expose Projelli MCP server + .mcpb bundle (FLAG 2 foundation)

**What:** Ship a Projelli MCP server (Node or Rust) that exposes:
- `list_workspace_files`
- `read_workspace_file`
- `search_workspace` (uses vector index from M1)
- `write_workspace_file` (with user confirmation)
- `get_memory_facts`

Distribute as a signed `.mcpb` Desktop Extension bundle. Install in Claude Desktop with one click. Submit to the Official MCP Registry.

**Why:** Biggest distribution lever available. Every Claude Code / Cursor / ChatGPT Desktop user becomes a potential Projelli-surfaced user. Central to Flag 2. See `01-MARKET_LANDSCAPE.md` Shift 2.

**Who has it:** Notion 3.3, Granola, Cursor, Claude Code. Nobody in Projelli's segment.

**LOE:** ~2-3 weeks. MCP server (~16h), DXT/MCPB packaging (~8h), registry submission (~4h), testing (~8h), documentation (~4h).

**Impact:** VERY HIGH. This is the "Projelli in every other AI tool" moment. Marketing pull is enormous.

**Dependencies:** Better with M1 (semantic search is the most useful MCP capability to expose).

---

## M5 — Side-by-side AI editing (FLAG 3)

**What:** Highlight text in the editor → inline chat anchor appears → "tighten this" / "add a step" / "change tone to warm" → streaming diff in place → accept/reject per hunk. Version history tracks human vs AI authorship.

**Why:** The defining UX moment for "AI workspace." Proven by ChatGPT Canvas and Claude Artifacts popularity.

**Who has it:** Canvas, Artifacts, Microsoft Copilot Pages, Cursor (for code). Nobody local-first in workspace category.

**LOE:** ~2-3 weeks. Inline chat anchor UI (~12h), streaming diff renderer (~16h), accept/reject per hunk (~12h), version history integration (~8h).

**Impact:** VERY HIGH. Defining demo moment.

**Dependencies:** None strict. Better with M3 (memory-aware edits).

---

## M6 — Voice input via Parakeet.cpp (FLAG 4 foundation)

**What:** Bundle Parakeet.cpp as a sidecar binary. Global hotkey (default: hold Shift+Space) records voice, transcribes locally, drops text into active chat input. Also: voice-to-note quick capture.

**Why:** Parakeet is 96x faster than Whisper on CPU, supports Apple Silicon Metal natively. Low latency (80ms-1120ms). Reference implementation: Handy (Tauri + Rust). Direct response to voice-is-mainstream trend.

**Who has it:** Wispr Flow (dictation). Notion 3.4 (cloud). ChatGPT / Claude voice modes (cloud). Handy (OSS). Nobody positioned for founders.

**LOE:** ~1-2 weeks. Sidecar binary setup (~4h), audio capture with `cpal` (~8h), transcription integration (~8h), hotkey (~4h), UI indicator (~4h).

**Impact:** HIGH. Novel in this segment. Ollama + voice = "fully offline Projelli" pitch.

**Dependencies:** Sidecar binary packaging in Tauri build.

---

## M7 — Template chaining (workflow → workflow)

**What:** After a workflow completes, "run another template using this output as input" prompt. Eventually: explicit chain configuration where `CompetitorAnalysis` output → `PricingStrategy` input without user copy-paste.

**Why:** Greg Isenberg: *"the biggest startups of 2026 will be built by remixing three or four existing AI tools into new vertical workflows."* Projelli becomes a genuine workflow OS, not a template library.

**Who has it:** Zapier / Make do this for SaaS APIs. Nobody does it for AI workflow templates in a founder workspace.

**LOE:** ~1-2 weeks. Output serialization (~6h), chain-config UI (~8h), state passing (~6h), testing (~6h).

**Impact:** HIGH. Shifts Projelli from "tool" to "system."

**Dependencies:** Template output schema (partially exists).

---

## M8 — Multi-interview synthesis template

**What:** UserInterviews template v2: upload N transcripts → AI aggregates into themes, killer quotes, contradictions, JTBD frameworks, priority-ranked feature requests.

**Why:** VOC Request #7. No tool does synthesis well; most do bullet-point summaries. High-value per founder, moderate LOE.

**Who has it:** Rally (customer simulation, different angle). Nobody does multi-interview synthesis well.

**LOE:** ~1-2 weeks. Multi-file input UI (~4h), chain-prompting across transcripts (~8h), aggregation output schema (~6h), testing with real transcripts (~6h).

**Impact:** HIGH. One of the "lighthouse templates" from VOC #3.

**Dependencies:** Template chaining (M7) helps. Structured outputs (needed anyway) helps.

---

# BIG BETS (1-3 months of side-project time, 6 items)

## B1 — User-created workflow templates via UI

**What:** Template editor: drag-drop steps, question builder, system prompt editor, output schema builder, save/load/share as `.projelli-prompt` JSON. User templates live in `~/.projelli/user-templates/`.

**Why:** Templates code-only today per codebase audit. Unlocks the long tail ("my specific weekly review for my specific business"). Plus shareable templates become a viral vector.

**Who has it:** Notion (templates, but no interview flow). Nobody with the interview-then-generate pattern.

**LOE:** ~40-60 hours per audit. Schema + validation (~16h), editor UI (~24h), file storage (~8h), import/export (~8h), testing (~8h).

**Impact:** VERY HIGH. Unlocks community-driven growth. Lifetime-tier feature.

**Dependencies:** Q19 (template fork as a stepping stone). Ideally after M5 (side-by-side editing establishes the UX language).

---

## B2 — Full MCP client + marketplace (FLAG 2 complete)

**What:** In-app MCP client consuming external servers. OAuth flows for GitHub, Linear, Stripe, Notion, Postgres. Tool-call execution engine (wire up the stub the codebase audit identified). In-app browse of the Official MCP Registry (~2,000 servers).

**Why:** Completes Flag 2. With this, Projelli workflows can ingest Stripe revenue for investor updates, Linear issues for weekly recap, GitHub commits for morning briefing. Unblocks VOC Request #3 (investor update from activity).

**Who has it:** Notion 3.3, Cursor, Claude Code, Granola.

**LOE:** ~60-80 hours. MCP client (~16h), tool-call execution engine (~20h), OAuth flows per server (~16h), UI (~12h), secrets storage (~8h).

**Impact:** VERY HIGH. Completes the "workspace is available everywhere AI is" story.

**Dependencies:** M4 (MCP server) establishes the MCP plumbing. Tool-call execution engine is the missing piece from the codebase audit.

---

## B3 — Scheduled template runs (non-agent delegation)

**What:** Cron-like schedule for any template. "Run WeeklyReview every Sunday at 9 AM with these default inputs." Output lands in a `Scheduled/` folder with a date stamp. Optional: OS notification when it completes.

**Why:** Buyers expect "agents that run for me" per market shift #1. Projelli does NOT want to build full autonomous agents (see `08-RISKS_AND_ANTIPATTERNS.md`). A schedule is 80% of the perceived benefit (delegation, the work gets done while you sleep) with ZERO of the hallucination risk.

**Who has it:** Notion Custom Agents (cloud only, credits-billed). Claude Code /schedule. Cursor Automations. All heavy-weight "agent" framings.

**LOE:** ~40-60 hours. Scheduler (Rust + cron crate) (~12h), persistent jobs (~8h), execution integration (~12h), notifications (~8h), UI for scheduling (~12h).

**Impact:** HIGH. Closes the "where are your agents?" gap for PH/HN launch comments without requiring actual agents.

**Dependencies:** None strict.

---

## B4 — Local browser automation agent for research

**What:** Bundled headless Chromium (via Chromiumoxide or Playwright) that runs web searches + scrape-and-summarize. Outputs markdown SourceCards with title, quote, URL. User's search API key (Tavily / Brave), BYOK extends.

**Why:** VOC + trend alignment. Founders constantly need research. Read-only (no action agents — see `08-RISKS_AND_ANTIPATTERNS.md`). Reliability still a tarpit but bounded scope helps.

**Who has it:** Browserbase (cloud). Stagehand (OSS, dev-flavored). ChatGPT Agent Mode (cloud). Perplexity (cloud).

**LOE:** ~60-80 hours. Bundling headless Chromium (~16h), scrape logic (~20h), BYOK search API (~8h), SourceCard generation (~8h), error handling (~16h).

**Impact:** HIGH. Differentiated (local research agent is rare). But highest-risk for bugs/reliability.

**Dependencies:** None strict. Structured outputs help. Tool-call engine helps.

---

## B5 — Prompt library with parameterization

**What:** `prompts/` folder in workspace. Markdown files with `{{variables}}`. Version-history-tracked like any other file. Parameterized prompt runner ("fill these 3 blanks, run"). Shareable as `.projelli-prompt` files.

**Why:** VOC Request #4 + Greg Isenberg "remix" thesis. The difference between "a prompt library" and "a prompt library that executes" is the difference between PromptDen (low WTP) and Projelli (high WTP).

**Who has it:** Helicone, PromptLayer (teams). Nobody for indie founders.

**LOE:** ~40-60 hours. Variable substitution (~8h), UI for filling blanks (~12h), sharing format + import/export (~8h), integrate with version history (~8h), template-compatible schema (~8h).

**Impact:** MED-HIGH. Long-tail retention feature.

**Dependencies:** B1 (template editor) overlaps significantly.

---

## B6 — Founder-voice content engine

**What:** One-time "voice profile" generation step. Point Projelli at your published LinkedIn/X/blog history (via import or MCP connector). Generates a style profile Markdown file. ContentStrategy + LandingPageCopywriter templates use it.

**Why:** VOC Request #8. Category-winning — most tools generate AI-flavored slop, this one generates in your voice. Pairs with Jameson's own personal brand strategy work.

**Who has it:** Typefully (partial, Claude-based). Nobody does "read everything you've written and match voice" well.

**LOE:** ~40-60 hours. Import pipeline (~12h), style-profile prompt (~8h), template integration (~8h), testing across voices (~12h).

**Impact:** HIGH. Unique, demo-able, retention driver.

**Dependencies:** B2 (MCP client) for LinkedIn/X ingestion, though basic file import works.

---

# DEFERRED (explicitly not in the 6-month plan, but worth capturing)

## D1 — Mobile app (iOS/Android)
Violates desktop-only guardrail. Revisit if 12-month data shows ≥30% of buyers asking for it.

## D2 — Real-time collaboration
Violates single-user guardrail. Would need to build an entirely different product.

## D3 — Plugin / extension system
Siren song per `08-RISKS_AND_ANTIPATTERNS.md`. Adds support burden, security surface, and ecosystem-management work. Consider post-v2 only if community request is overwhelming.

## D4 — Autonomous multi-agent orchestration
Siren song. Agent reliability data is brutal. Scheduled template runs (B3) covers the perceived benefit.

## D5 — Cloud sync / Projelli-hosted backup
Siren song. Breaks local-first. Users who want sync can put workspace in iCloud / Dropbox / git.

## D6 — Projelli-managed AI tier (non-BYOK)
Siren song. Defeats the core pitch.

---

# Summary tables

## Quick Wins (ship by v1.1, weekend-scale each)

| # | Feature | LOE (h) | Impact |
|---|---|---|---|
| Q1 | Mermaid rendering | 3-4 | Med |
| Q2 | KaTeX rendering | 2-3 | Low-Med |
| Q3 | Real-time cost meter | 4-6 | **HIGH** |
| Q4 | Monthly cost dashboard | 4-6 | Med |
| Q5 | Audit log export | 2-3 | Low-Med |
| Q6 | Audit log filtering | 3-4 | Low |
| Q7 | Ollama as 4th provider | 4-6 | **HIGH** |
| Q8 | Per-template model | 3-4 | Med |
| Q9 | Haiku 4.5 free default | 1 | Med |
| Q10 | Template preview gallery | 6-8 | **HIGH** |
| Q11 | Sample workspace | 3-4 | Med-High |
| Q12 | Smart paste URL | 2-3 | Low-Med |
| Q13 | Image paste auto-save | 4-6 | Med |
| Q14 | Wiki-link autocomplete polish | 2-6 | Med |
| Q15 | "Run on all 3" button | 6-8 | **HIGH** |
| Q16 | Shortcut cheatsheet | 3-4 | Low |
| Q17 | /vs-obsidian, /vs-notion pages | 4-6 | **HIGH** |
| Q18 | In-app changelog | 3-4 | Low-Med |
| Q19 | Template fork | 6-8 | **HIGH** |
| Q20 | API-key onboarding wizard | 6-8 | **HIGH** |

**Total Quick Win LOE: ~65-100 hours** — roughly 8-15 weekends of side-project time, distributed across the 6-month window. Doable.

## Medium bets (v1.1 – v1.3, multi-week each)

| # | Feature | LOE (weeks) | Impact | Flag |
|---|---|---|---|---|
| M1 | Local RAG (LanceDB + e5-small) | 2-3 | **V.HIGH** | 1 |
| M2 | @workspace + Ask my workspace | 1 | **V.HIGH** | 1 |
| M3 | Memory facts file | 1-2 | HIGH | 1 |
| M4 | Projelli MCP server + .mcpb | 2-3 | **V.HIGH** | 2 |
| M5 | Side-by-side AI editing | 2-3 | **V.HIGH** | 3 |
| M6 | Voice input (Parakeet) | 1-2 | HIGH | 4 |
| M7 | Template chaining | 1-2 | HIGH | — |
| M8 | Multi-interview synthesis | 1-2 | HIGH | — |

**Total Medium LOE: ~11-18 weeks** of side-project time. At 8 hr/week, that's ~12-20 weeks calendar. Realistic for v1.1-v1.3 across 5-6 months post-launch.

## Big Bets (v1.4+, post-launch)

| # | Feature | LOE (weeks) | Impact | Flag |
|---|---|---|---|---|
| B1 | User template editor | 4-6 | V.HIGH | — |
| B2 | Full MCP client + marketplace | 6-8 | V.HIGH | 2 |
| B3 | Scheduled template runs | 4-6 | HIGH | — |
| B4 | Local browser research agent | 6-8 | HIGH | — |
| B5 | Prompt library + parameterization | 4-6 | MED-HIGH | — |
| B6 | Founder-voice content engine | 4-6 | HIGH | — |

**Total Big Bet LOE: ~28-40 weeks** of side-project time. Pick 2-3 for the 6-12 month post-launch window.

---

## The bottom line: the highest-leverage path

If Projelli ships these 10 items in this approximate order over the next 6 months, the differentiation story is bulletproof:

1. **Q3** (cost meter) — pre-launch, anchors BYOK story
2. **Q10** (preview gallery) — pre-launch, fixes conversion
3. **Q20** (API-key wizard) — pre-launch, fixes drop-off
4. **Q7** (Ollama) — pre-launch or Week 1 post-launch, anchors privacy pitch
5. **M1** (local RAG) — months 1-2, foundation for Flag 1
6. **M2** (@workspace / Ask my workspace) — month 2, demo moment
7. **M4** (MCP server) — months 3-4, distribution multiplier for Flag 2
8. **M5** (side-by-side editing) — months 4-5, defining UX for Flag 3
9. **M3** (memory facts) — month 5, compounds with M1/M2
10. **M6** (voice + Ollama combined) — month 6, Flag 4 completion

This sequence is what `07-ROADMAP.md` codifies into a calendar view against Jameson's 5-10 hr/week pace.

---

## How to use this doc

- **Before committing to a feature:** check LOE, dependencies, and flag-alignment here
- **When fielding "can you add X?" from a PH/HN commenter:** reference the brainstorm + this triage to answer honestly
- **When writing a new BACKLOG ticket:** lift the WHAT / WHY / DEPENDENCIES structure
- **Each quarter:** re-audit by running `01-MARKET_LANDSCAPE.md` + `02-COMPETITIVE_DEEP_DIVE.md` freshly and updating what's been shipped, what's newly competitive, and what's no longer worth shipping
