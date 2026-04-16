# 04 — Feature Brainstorm (wide net)

> The unfiltered idea corpus. ~110 feature ideas across 15 categories. No triage yet, no LOE, no prioritization. Every idea is one sentence or less. Sister docs: `05-DIFFERENTIATION_STRATEGY.md` picks the 3-5 to plant a flag on; `06-RECOMMENDATIONS_BY_LOE.md` triages everything here into Quick Wins / Medium / Big Bets.
> Sources: the 4 parallel research agents (competitor, VOC, trends, codebase), existing BACKLOG.md, PRD.md, user memory, and fresh strategic additions flagged with (new).

---

## How to read this

Each idea is phrased "WHAT — short why." Annotations:
- **(anti-pattern)** — explicitly at risk of violating a guardrail; triage with care (see `08-RISKS_AND_ANTIPATTERNS.md`)
- **(partial)** — Projelli already has part of this, finish the job
- **(new)** — surfaced for the first time in this exercise
- **(from X)** — attributed to the research agent or source

No idea here is "approved." This is the brainstorm surface. The triage happens in `06-RECOMMENDATIONS_BY_LOE.md`.

---

## Category 1: AI / Chat / Model capabilities

Core LLM integration extensions.

1. **Add Ollama as a 4th provider** — local LLM, privacy-maximalist audience. Reference Tauri patterns solved by Handy / OpenPawz / Locally Uncensored. (from trends)
2. **Add LM Studio headless service integration** — alternate local path, LM Studio 0.4 shipped `llmster` headless service. (from trends)
3. **Add per-template model assignment** — "use Claude Opus for PitchDeck, local Llama for DailyReview."
4. **Add Claude Haiku to free tier as the default** — cheapest, fastest, makes BYOK approachable. (partial, trivial code change)
5. **Add real-time per-chat cost meter** — "$0.04 this conversation, $0.17 today." No major AI tool has this. Category-winning UX. (from VOC)
6. **Add monthly cost dashboard** — aggregate API spend per provider, per template, per month. Audit log already captures the data.
7. **Run-the-same-prompt-on-all-3 button** — multi-model comparison. Provider interface supports it already. (partial)
8. **Auto-fallback on rate limit** — if Claude hits rate limit, retry on OpenAI with same prompt. Uses BYOK keys user already has.
9. **"Cheapest for this task" auto-routing** — structured outputs → GPT mini, prose → Claude, reasoning → Gemini thinking. Pre-set, user-editable.
10. **Add thinking-mode toggle for reasoning models** — Claude Opus 4.7 thinking, GPT-5 xhigh reasoning, Gemini thinking_level. One visible toggle, not buried in settings.
11. **Add Anthropic 1M context window support** — stuff the entire workspace into one prompt for "ask my whole workspace" queries. Prompt caching makes this economical.
12. **Wire OpenAI Responses API** — server-side compaction handles long agent runs better than Chat Completions. (from trends)
13. **Wire Anthropic native Structured Outputs** — public beta in 2026, cleaner than current tool-based workaround. (from trends)
14. **Add Gemini 3 Pro + media_resolution parameter** — cheapest path for screenshot-in-chat. (from trends)
15. **Add Claude Code-style sub-agents** — one chat spawning sub-chats with scoped context, summarized returns. Stay ≤3 levels. (from trends)
16. **Configurable max-output-tokens per template** — some templates need 30-line briefings, others need 5000-line drafts.

---

## Category 2: Workflow / Templates

The founder-workflow core.

17. **Template chaining** — `CompetitorAnalysis` output → `PricingStrategy` input without copy-paste. (from VOC #4, Greg Isenberg)
18. **User-created templates via UI** — template editor (drag-drop steps, question builder). Big lift but unlocks long tail. (partial — code-only today)
19. **Template fork / remix** — duplicate existing template, edit, save locally. Low lift, huge UX win.
20. **Template marketplace / sharing** — users post `.projelli-prompt` JSON files to X / GitHub. Like Cursor Rules become viral.
21. **Schedule a template run** — "run WeeklyReview every Sunday at 9 AM." Not an agent; a cron. (from trends)
22. **Trigger a template run from hotkey** — global hotkey to fire a specific template.
23. **Template versioning + A/B testing** — keep version history of system prompts, compare quality.
24. **Per-template "voice profile"** — system prompt overlay that ensures output matches user's voice.
25. **Template-level structured output schema** — pitch deck returns `{tagline, audiences[], milestones[], risks[]}`, render as form. (from trends #8)
26. **Template progress / resume** — half-filled interview form saves state, resume later.
27. **Batch-run same template on multiple inputs** — 12 customer interviews run through UserInterviews template, results aggregated. (from VOC #7)
28. **New template: CustomerSimulation** — test landing copy / features on N simulated personas. (from VOC #9, Rally-style)
29. **New template: WeeklyMetricsVisual** — "my numbers vs last month" auto-generated. Build-in-public specific. (from VOC)
30. **New template: LandingPageCopywriter with voice learning** — reads your published content → generates variants in your voice. (from VOC #8)
31. **New template: DailyBriefing** — reads recent commits + calendar + last review → 3-bullet morning plan. (from VOC #C)
32. **New template: RefundOrKeepThisCustomer** — analyze customer context + situation → suggest response. Niche but loved.
33. **New template: InvestorUpdateFromActivity** — ingests Stripe / Linear / Slack / GitHub → draft. (from VOC #3)
34. **Template gallery categories + tags** — browse by use-case-phase (Idea / Validation / Build / Launch / Scale). Already a tag system.
35. **"Remix this generated doc with a different template"** — one-click: take FinancialModel output and pipe through PricingStrategy.

---

## Category 3: Editor / Content creation

Upgrade the markdown editor to close visible gaps.

36. **Mermaid diagram rendering in preview** — CLAUDE.md says it exists, code says no. Ship it. (partial, doc/code mismatch)
37. **KaTeX math rendering** — same story, claimed but not loaded.
38. **Side-by-side AI editing (Canvas / Artifacts pattern)** — highlight paragraph, ask "tighten this," streaming diff in place with accept/reject. Highest-value UX pattern 2024-2026. (from trends #9)
39. **Whiteboard → doc converter (AI)** — same direction AFFiNE did in Edgeless Mode. Let Projelli's whiteboard auto-summarize to a doc. (partial: whiteboard exists)
40. **Doc → whiteboard converter (AI)** — "draw a system diagram of this prose." Pairs with 39.
41. **YAML frontmatter parsing + UI** — metadata fields, tags, status surfaced in side panel. Obsidian parity. (partial)
42. **Per-language code block syntax highlighting** — currently just Markdown default. Small CodeMirror extension.
43. **Inline table editor (WYSIWYG)** — Markdown tables are painful to edit raw. Bring shadcn Table inline.
44. **Minimap / overview bar** — code-editor pattern applied to long docs.
45. **Focus mode / typewriter scrolling** — iA Writer has this, Bear has this, deep-work users want it.
46. **Image paste / drag-drop with auto-save** — paste screenshot, auto-saves to workspace/media/ and inserts `![](...)`.
47. **Paste-from-ChatGPT detection** — visually mark pasted AI content like iA Writer does (but as an option, not a stick). (from competitor)
48. **Text-to-diagram** — type "user signs up, then logs in" → Mermaid flow auto-generated below.
49. **Wiki-link autocomplete while typing `[[`** — already have wiki-links, probably already have this, verify and polish.
50. **Backlinks panel with preview-on-hover** — hover a backlink, see the referring paragraph.
51. **Document outline view with drag-reorder** — reorder H2 sections by dragging in outline panel; rewrites doc.
52. **Smart paste: URL → link with title** — paste a URL, auto-fetches title and inserts `[title](url)`.
53. **Structured cards view for frontmatter'd docs** — folder of customer personas → kanban-style card view. Obsidian Bases parity.
54. **Inline checkboxes with task awareness** — `- [ ]` items become a tracked task list, aggregated to a "My Tasks" view.
55. **Document stats in status bar** — word count, read time, sentence length distribution. Writer-friendly.

---

## Category 4: Memory / RAG / Search

Answer "why can't my AI see my notes?"

56. **Local vector index with LanceDB + fastembed-rs + e5-small** — embed every file, retrieve top-K for chat. Tauri-friendly stack. (from trends #6)
57. **"@workspace" command in chat** — retrieves relevant chunks from your files, cites them inline.
58. **"Ask my workspace" chat mode** — dedicated chat that auto-retrieves + cites, NotebookLM-style. (from trends #11)
59. **Incremental indexing on file save** — index updates within 1-2 seconds, no rebuild needed.
60. **Semantic-aware search** — alongside FlexSearch text search, add semantic. User toggles between them.
61. **Local memory / facts file** — `~/.projelli-memory.json` with user's long-lived facts. Pre-pended to system prompts. (from trends #4)
62. **Fact-extraction agent** — every conversation, AI proposes 1–3 new facts to save ("you mentioned your company is Wheel Health..."). User approves.
63. **Memory-layer interop with Claude Memory / ChatGPT Memory** — export/import JSON shape that maps to Anthropic's Memory API.
64. **Time-based memory ("when did I write this")** — query "what was my pricing strategy as of February?" → time-scoped search.
65. **Per-project memory** — separate facts files per workspace, AI only sees the relevant one.
66. **"Summarize this file on save"** — DocSummaryService exists in code, isn't wired to UI. Auto-summary as an opt-in. (partial, hidden capability)
67. **Cross-file contradiction detection** — ContradictionDetector module exists, isn't wired. Flag when a claim in one file conflicts with another. (partial)
68. **"Find similar docs to this one"** — semantic search variant; embeddings first-class use.

---

## Category 5: Integrations / MCP / Connectivity

Projelli as a citizen of the broader AI ecosystem.

69. **Expose a Projelli MCP server** — Claude Code / Cursor / ChatGPT Desktop can read Projelli workspace files. Biggest distribution lever. (from trends #1)
70. **Distribute Projelli MCP server as a .mcpb bundle** — one-click install in Claude Desktop, no JSON config. (from trends — Anthropic DXT/MCPB)
71. **Consume MCP servers inside Projelli** — add Linear / GitHub / Stripe / Notion / Postgres as chat-callable tools.
72. **MCP server marketplace inside Projelli** — "install the Linear MCP" with OAuth. Official Registry has ~2,000 entries to mirror.
73. **Tool-call execution engine** — the `toolCall()` interface exists but execution is a stub per codebase audit. Wire it up. (partial)
74. **Web search tool (Tavily / Brave / Perplexity API via BYOK)** — research workflows can hit the web without leaving Projelli.
75. **Web fetch tool** — BYOK scrape-and-summarize without needing a full browser agent. Read-only, safe.
76. **GitHub integration (via MCP)** — "summarize my last week of commits" for investor updates.
77. **Stripe integration (via MCP or direct)** — pull MRR for BoardMeetingPrep / InvestorUpdate templates.
78. **Linear integration (via MCP)** — current sprint + shipped items → weekly recap template.
79. **Calendar integration (CalDAV / Google Calendar)** — "what's on my calendar this week" into DailyBriefing template.
80. **Email / IMAP integration** — "summarize my customer support inbox" — must be read-only, BYOK, local.
81. **Obsidian vault compatibility** — open an Obsidian vault as a Projelli workspace (it's all `.md` anyway). Migration wedge.
82. **Export to Obsidian / Notion / Logseq** — for users who want to take their data elsewhere. Local-first pitch demands it.
83. **Raycast extension** — summon Projelli templates from the Raycast command bar. Founder-community-loved launcher.

---

## Category 6: Voice / Multi-modal

Voice input, images, multi-modal chat.

84. **Press-to-talk voice input via Parakeet.cpp** — 96x faster than CPU Whisper, native Apple Silicon Metal. Reference: Handy. (from trends #5)
85. **Voice-to-note quick capture** — global hotkey, record 30s, transcribe, save to Inbox/.md.
86. **Voice memos with searchable transcripts** — audio recording already exists; add transcription by default. (partial)
87. **Voice-driven template runs** — "run WeeklyReview from Monday" via voice.
88. **Screenshot-to-chat** — paste screenshot, AI can see it via vision models. Gemini media_resolution makes it cheap. (from trends #7)
89. **Image OCR for source cards** — snap a receipt or slide, auto-extract text as a quote.
90. **AI image generation for drafts** — BYOK to OpenAI `gpt-image-1`, auto-save to workspace/images/.
91. **Diagram interpretation** — drop a whiteboard photo, AI extracts the structure into Mermaid.
92. **PDF parsing + chat** — open a PDF in Projelli, "ask questions about it" with retrieval. NotebookLM parity.
93. **Inline audio playback for AI responses** — ElevenLabs / OpenAI TTS via BYOK. Listen while commuting. (Lower priority.)

---

## Category 7: Collaboration-adjacent (within single-user guardrails)

Async-only, no real-time, no Projelli-hosted collab.

94. **Export a workflow run as a shareable HTML file** — self-contained, no Projelli servers. Post-purchase sharing.
95. **Static-site generator for a workspace folder** — "share my customer research with a co-founder." Uses user's own hosting.
96. **Read-only view of a file over a local network** — spin up `localhost:3000`, share with adjacent desk / LAN. Not cloud.
97. **Git-aware workspace** — if the user `git init`s their workspace, Projelli shows commit history alongside version history. Hybrid power-user feature.
98. **Export to PDF with branding** — investor updates need polish. Pandoc sidecar.
99. **Copy-as-prompt** — any doc → "copy this in a shape ChatGPT/Claude/Cursor can consume." Acknowledges that users use multiple AIs.

---

## Category 8: UX / Onboarding / Conversion

Reduce friction, raise conversion.

100. **One-page API key onboarding** — screenshots for Claude / OpenAI / Gemini. "Where do I get a key" is the #1 drop point. (from VOC)
101. **Sample workspace at first-run** — demo workspace with 3 pre-populated files so the app isn't empty. (partial: wizard exists)
102. **"Run your first template in 60 seconds" tutorial** — single guided path, end at a deliverable.
103. **In-app what's new changelog** — show release notes on first launch after update.
104. **Command palette quick actions** — Cmd-K: run template, switch model, new workspace, etc. Already exists, expand actions. (partial)
105. **Keyboard shortcut cheatsheet overlay** — `?` shows all shortcuts.
106. **"Buy Projelli" in-app** — Pro users see "Upgrade to Lifetime" banner subtly. No begging.
107. **Progressive feature unlock on signup** — Free unlocks templates incrementally as user completes onboarding. Habit hook.
108. **First-run cost estimator** — "with typical use you'll spend $2-5/mo on API calls." Preempts BYOK cost anxiety.
109. **Template preview gallery** — show *filled-out examples* of each template's output, not just blank interview forms. (critical marketing gap)
110. **Empty-state copy that teaches** — every empty view has a short "here's what lives here" explainer.

---

## Category 9: Privacy / Trust / Transparency

The architectural features that make the pitch believable.

111. **Network inspector** — visible panel showing every outbound API call with provider + cost. Audit-visible.
112. **"Offline mode" toggle** — disable all network calls, visible at all times. Privacy-maximalist users will love.
113. **Local encryption of workspace** — optional password-protect workspace folder. macOS FileVault / BitLocker covers most, but a Projelli-level option reassures.
114. **Audit log export (CSV / JSON)** — AuditService logs are structured; just add export. (partial, easy)
115. **Audit log filtering UI** — by date, model, action type. Currently read-only.
116. **Compliance report generator** — "HIPAA-adjacent audit PDF" for regulated founders (healthcare, legal).
117. **Zero-knowledge positioning page** — `/security` page explaining exactly where data lives. Trust-builder. Site page, not product feature.
118. **Key rotation reminder** — "Your API keys are 90 days old, rotate?" Best-practice hygiene.

---

## Category 10: Commercial / Distribution

Revenue and go-to-market features.

119. **Affiliate program via LemonSqueezy** — built-in $10 per sale. Post-launch, after 100 paying customers. (in BACKLOG)
120. **Team / company license** — $199 one-time for up to 5 seats. NOT a subscription. Addresses "my co-founder wants one too."
121. **Educational discount** — 50% off for students. Easy goodwill.
122. **Open-source "Projelli Lite"** — stripped-down free version as marketing funnel. Deferred per BACKLOG but keep eyes on it.
123. **Founder's Launch counter on homepage** — "23/100 lifetime licenses remaining." Scarcity as honest signal.
124. **"Powered by Projelli" badge on exported docs** — optional, off-by-default, small link at bottom of exported PDFs.
125. **Referral bonus: 1 month of provider credits** — BYOK-friendly incentive. Gift cards to Anthropic / OpenAI.
126. **Bundle with Projelli Lifetime: a free domain hand-holding** — "help me actually start my business" upsell. Probably too service-y; flag.

---

## Category 11: Platform-specific

Mac, Windows, Linux optimizations.

127. **Mac menu bar mini-chat** — summon Projelli AI from anywhere on Mac. Raycast-adjacent.
128. **Windows system tray equivalent** — same pattern for Windows.
129. **Spotlight / Alfred / Raycast integration** — global command to search Projelli workspace.
130. **Notification Center support** — scheduled template run completes, OS notification.
131. **Apple Intelligence interop (post-WWDC)** — if Apple ships document intelligence, expose Projelli files as a source. Wait for WWDC.
132. **Windows Snipping Tool clipboard interop** — screenshot → Projelli.
133. **Dock / Taskbar jump lists** — quick-launch specific templates.
134. **Linux AppImage / Flatpak** — deferred per BACKLOG but unblocks a slice of the founder community.
135. **Auto-update via Tauri's built-in updater** — seamless patch delivery. (in BACKLOG)

---

## Category 12: Power-user / Pro features

The $99 Lifetime justification.

136. **Advanced diff viewer with inline AI edits** — see what the AI changed between runs, approve selectively.
137. **Branch-like versioning** — "create branch from this version" for exploratory edits. VersionService already stores snapshots.
138. **Prompt library with versioning** — markdown files in `prompts/` folder, versioned like docs. (from trends #10)
139. **Prompt parameterization (`{{variables}}`)** — reusable prompt templates with fillable slots.
140. **Macros (keyboard-triggered multi-step workflows)** — "record a sequence, replay with Cmd-Shift-M."
141. **Regex search across workspace** — power user feature, low lift.
142. **File protection / read-only** — Lock key docs (investor memos) so AI can't overwrite. (in PRD US-2.5.1)
143. **Plugin / extension system (post-v2)** — risky. Flagged here for completeness; probably siren song. (anti-pattern candidate)
144. **API for scripting Projelli from the CLI** — `projelli run PitchDeck --input ./input.md`. Dev-adjacent founders will love.
145. **Local JSON-export of every file + run record + audit** — full data portability. One click, everything in your hands.

---

## Category 13: Marketing-product fit features

Features built to support launch & growth.

146. **Demo mode / sandbox** — Try Projelli without installing by visiting projelli.com/try — pre-loaded Chromium with a limited tour. (big lift)
147. **Shareable workflow runs** — user publishes an anonymized InvestorUpdate run as a public URL. Viral potential. (see #94 collaboration-adjacent)
148. **Template-of-the-week blog series** — ship a new publicly-visible template per week. Content engine with SEO hooks.
149. **"Built with Projelli" case studies** — friends' testimonials on landing page. Post-launch.
150. **Public roadmap** — users vote on next features. Post-launch. (in BACKLOG)
151. **Community Discord or forum** — contentious because adds support burden. Flag, don't commit.
152. **Screencast library on projelli.com** — 30-second Loom per template. SEO + demo double-duty.
153. **Comparison page vs Obsidian + Notion** — `/vs-obsidian`, `/vs-notion`. Already have the material in COMPETITIVE_LANDSCAPE.md.
154. **"Why local-first" blog post** — high-intent landing page for the privacy-aware crowd.

---

## Category 14: Observability / Analytics / Self-reflection

Help the user see their own patterns.

155. **Usage insights: "you use Claude 70% of the time"** — Let users SEE their stack. Meta-awareness is sticky.
156. **Most-used templates dashboard** — surface WeeklyReview is #1, PitchDeck ran 3x this month. Enables the next feature:
157. **Auto-suggest templates based on history** — "you've written 4 launch posts this month; save as LaunchPostTemplate?" (from trends #13)
158. **Workspace health score** — unused files, broken links, stale docs. Gentle nudge to declutter.
159. **Monthly reflection auto-report** — last month's activity → what you shipped, what you wrote. Shareable. Feels good.
160. **Writing velocity tracker** — words per day, per week. Gamifies deep work (tastefully).

---

## Category 15: Founder-workflow-specific

Opinionated features that only make sense for the founder ICP.

161. **"Is this in my niche" competitor-spotter** — paste a URL, AI flags overlap with your product. Periodic spot check.
162. **Stripe payment → celebration** — new payment comes in, Projelli generates a draft X post with the milestone. Post-BuildInPublic-decision feature.
163. **"How much have I actually shipped this month"** — GitHub-connected retrospective.
164. **Runway calculator + forecast workflow** — plug in MRR trajectory, burn rate, AI warns you X weeks before runway ends.
165. **Customer interview calendar-to-doc** — calendar event ending, AI prompts "ready to log the interview notes?" Goes through UserInterviews template.
166. **Legal doc first-drafts** — Privacy / Terms / EULA boilerplate via template. Every founder writes these.
167. **AI deputy for support email replies** — founder's voice + memory-layer + BYOK. Drafts, founder approves. (anti-pattern candidate: "AI acting for me" risk)
168. **Pricing A/B copy generator** — "write 3 variants of this tier description." ContentStrategy template variant.
169. **Launch day timeline generator** — builds a per-hour checklist for PH / HN launch day.
170. **"What to do next" decision assistant** — given context, AI proposes the next 3 highest-leverage tasks. Flagged as anti-pattern candidate (therapy positioning).

---

## Wildcards / Experimental / Not obviously buckets

Not in a neat category but worth capturing.

171. **Figma plugin / integration** — founder designs → Projelli copy. Niche but differentiated.
172. **Apple Watch complication** — voice-capture from wrist, syncs to workspace. Probably overkill.
173. **Printable workflow outputs as postcards** — "mail me my PitchDeck in a booklet." Jameson has access to Snail Mail Club infrastructure. Novelty but memorable.
174. **AI personality presets** — "respond like a senior PM who values brevity." System prompt overlay, not a Character.AI thing. (from trends bonus)
175. **Gamification of template streaks** — you ran WeeklyReview 4 weeks in a row. Tasteful.
176. **"Dumb" mode: hide AI entirely** — for deep-work blocks, just the editor. Writer-aesthetic.
177. **Projelli for kids / students** — deferred, but the educational market is huge if pricing matches.
178. **White-label deployment for accelerators** — Techstars / YC branded fork for their cohorts. B2B spin, future.
179. **Projelli as an MCP server offered as a service** — too cloud-y for v1. (anti-pattern)
180. **AI-assisted migration from Notion / Obsidian / Evernote** — parse export, generate Projelli workspace.

---

## Summary of the brainstorm

~110+ distinct ideas across 15 categories. Rough bucketing of expected triage (for a sense of scale, actually triaged in `06-RECOMMENDATIONS_BY_LOE.md`):

- **Quick Wins (≤1 day)**: ~30 ideas. Including Ollama provider, cost meter, audit log export, sample workspace, per-template model, smart paste URL→link, Mermaid rendering fix, wiki-link autocomplete polish, hidden-capability surfacing, etc.
- **Medium (~1 week)**: ~40 ideas. Including local RAG + vector search, memory facts file, MCP server expose, template chaining, side-by-side editing, voice input (Parakeet), template fork/remix, multi-interview synthesis, cost dashboard.
- **Big Bets (~1 month+)**: ~15 ideas. Including template editor UI, browser-automation research agent, full MCP client + marketplace, prompt library + parameterization, scheduled runs.
- **Siren songs (don't build)**: ~10 ideas. Including multi-agent swarm, cloud sync, team collab, AI co-founder emotional, generic Notion-replacement positioning, fully autonomous agents. Explicitly flagged in `08-RISKS_AND_ANTIPATTERNS.md`.
- **Defer / watch**: ~15 ideas. Including Linux builds, Apple Intelligence interop (wait for WWDC), plugin system, community Discord, Raycast extension.

The cost-weighted set that compounds best — in rough order of expected leverage — is:

1. **Local RAG + "ask my workspace"** (Category 4)
2. **MCP server expose + .mcpb bundle** (Category 5)
3. **Memory facts file + interop** (Category 4)
4. **Canvas / side-by-side editing** (Category 3, #38)
5. **Real-time cost meter** (Category 1, #5)
6. **Voice input via Parakeet** (Category 6, #84-86)
7. **Ollama as 4th provider** (Category 1, #1)
8. **Template chaining** (Category 2, #17)
9. **Scheduled template runs** (Category 2, #21)
10. **Sample-workspace onboarding + template preview gallery** (Category 8, #101, #109)

`05-DIFFERENTIATION_STRATEGY.md` picks the hill to plant the flag on. `06-RECOMMENDATIONS_BY_LOE.md` triages everything here into a concrete ship list. `07-ROADMAP.md` sequences them.
