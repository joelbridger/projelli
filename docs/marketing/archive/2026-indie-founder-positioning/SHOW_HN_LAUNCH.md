# Show HN Launch Package, Projelli

> **Status:** Draft, ready for Jameson to review and submit on launch day.
> **Target submission time:** 9:00 am Pacific (peak HN front-page window) on the same day as the Product Hunt launch.
> **HN account required:** Jameson should submit from his personal account, not a fresh account. Brand-new accounts get filtered automatically.

---

## Why HN is different from PH (read this first)

HN is not Product Hunt. The audience overlap is smaller than people think. Here's what HN expects that PH doesn't:

| Dimension | Product Hunt | Hacker News |
|---|---|---|
| **Tone** | Enthusiastic, founder-warm | Skeptical, technical, allergic to marketing |
| **Length** | Medium description + visuals | Short submission + long comment thread |
| **Visuals** | Required | Optional, sometimes harmful |
| **Comments** | "Congrats, looks great!" | "Have you considered X?" + "This is wrong because Y" |
| **Tolerance for hype** | Some hype is normal | Zero hype tolerance |
| **What gets upvoted** | Polish, design, clear story | Honesty, technical depth, novel approach |
| **Penalties** | Vote manipulation | Vote manipulation, hype words, "we" instead of "I" for solo projects |
| **Title rules** | Free-form | Strict format: "Show HN: Name – brief description" |

The single biggest mistake on Show HN is treating it like Product Hunt. Don't.

---

## Title (the most important field)

HN strips clickbait words from titles automatically. The format is:

**`Show HN: [name] – [one-line factual description]`**

Use a real em-dash (–), not a hyphen. HN moderators have been known to silently fix titles that don't follow the convention.

### Recommended

**`Show HN: Projelli – A local-first AI workspace where every chat becomes a real file`**

That's 81 characters. Within the safe zone. It contains:
- The product name
- The category (AI workspace)
- The differentiator (local-first, chats → files)
- No hype words

### Alternates (if the recommended one feels too long)

1. `Show HN: Projelli – Local-first AI workspace built on Tauri` (62 ch)
2. `Show HN: Projelli – BYOK desktop AI workspace, every chat becomes a file` (74 ch)
3. `Show HN: Projelli – I built a local-first AI workspace because my ChatGPT history was a mess` (95 ch, title is fine, slight HN risk for being too narrative)

**Don't use:** "I built", "introducing", "the best", "the future of", "transform your", "supercharge". HN punishes all of these.

---

## URL field

`https://projelli.com`

NOT `https://github.com/projelli/projelli`. Both work, but the homepage gives the AI demo, the pricing, and the screenshots in one place. The GitHub link belongs in the comment.

---

## Submission body (HN doesn't have a separate body field, this goes in the FIRST COMMENT, posted within 60 seconds of submitting)

The submitter's first comment is functionally the description. HN front-page algorithm does NOT factor it in directly, but every reader will read it before deciding to upvote. This is where you earn the upvote.

**Length target:** 250-400 words. No bullet lists. No headers. No emojis. Just paragraphs.

**Voice rules:**
- First-person singular always ("I built", never "we built")
- No marketing words. Replace "powerful" with the actual capability.
- Lead with the problem you had, not the product
- Mention the tech stack, HN cares
- Mention what's NOT done, HN respects honesty more than completeness
- End with an explicit question to invite comments

---

### Recommended draft

> Hi HN. I'm Jameson. I built Projelli because I was using ChatGPT for everything and losing all of it. I'd have a 2-hour conversation with Claude about pricing strategy for one of my side projects, and a week later I couldn't find the conversation, or I'd find it mixed in with three other unrelated threads, and the document that came out of it lived in some other tool. The friction was the copy-paste between the chat history and the files.
>
> Projelli is a desktop app where the AI chat and a real Markdown editor share the same screen, and every conversation produces actual files in a folder on your hard drive. Not a proprietary database. Not someone else's cloud. Plain `.md` files in a folder you choose, that work in any other tool (Obsidian, VS Code, Notepad) the day Projelli stops existing.
>
> Stack: Tauri 2 (Rust + WebView) for the desktop shell, React 18 + TypeScript + Zustand for the UI, CodeMirror 6 for the editor, sql.js for the audit log and version history, Ed25519 for license JWTs, OS keychain for API key storage. The whole binary is ~12MB. Source is at github.com/projelli/projelli. It's source-available, not open source.
>
> The model is BYOK, you bring your own API key for Claude, OpenAI, or Gemini, and AI requests go from your machine directly to the provider. There's no Projelli endpoint in the request path. The only thing my server ever sees is your license key on activation.
>
> Things I want to flag honestly. Windows has been live since February. Mac just got cross-platform CI working two weeks ago and the first signed Mac build is shipping this week, if you're on Mac and this doesn't work for you yet, that's why. Linux is post-launch. Pricing is one-time, not subscription: $49 Pro, $99 Lifetime, with the first 100 launch buyers getting Lifetime for $29.
>
> The pieces I'm least sure about: (1) whether the per-template "interview workflow" model is the right shape for AI-driven document creation, or whether I should just have free-form chat plus a "save this as a doc" button; (2) whether founders actually want a desktop app in 2026 or whether the local-first thing is mostly nostalgia. Honest takes welcome on either.
>
> projelli.com, happy to answer anything.

---

## Anticipated comments + draft replies

These are the actual comment patterns HN throws at every Show HN post in this category. Pre-drafted replies, ready to copy-paste.

### 1. "How is this different from [existing tool]?"

**Comment:** "How is this different from Cursor? / Obsidian? / Notion AI? / Logseq? / Reflect?"

**Reply:**
> Different scope. Cursor is for code, Projelli is for everything around the code (business plan, GTM, pitch deck, customer interviews). Most solo founders end up using both. vs Obsidian: philosophically very close, both store plain Markdown on disk. The difference is that Obsidian's AI features are community plugins you assemble yourself; in Projelli the AI is the primary input method with three native providers. vs Notion AI: cloud vs local, subscription vs one-time, proprietary DB vs Markdown files on your hard drive. Happy to go deeper on any specific comparison.

### 2. "What's your business model going to be when AI providers commoditize?"

**Reply:**
> BYOK insulates me from that. I don't make money on AI inference, so it doesn't matter to me if Claude becomes cheap or Llama matches GPT-4. The product is the workspace and the workflow templates. The business model is one-time software pricing, $49 Pro, $99 Lifetime, same model that worked for Sublime Text, BBEdit, and Things. If I'm wrong about that I'll learn quickly.

### 3. "Why not open-source?"

**Reply:**
> Source-available, not open. The source is on GitHub so you can read it, audit the network behavior, check that I'm not exfiltrating your data, but you can't redistribute or build a competing product from it. Honest tradeoff: I want to be able to charge for it without someone shipping a free clone, but I also don't want to ask people to trust me on faith. Source-available is the middle ground I landed on. Reasonable people will disagree.

### 4. "Why Tauri instead of Electron / native / web?"

**Reply:**
> Tauri because (1) the binary is ~12MB instead of 100MB+, (2) the WebView is system-provided so I don't ship a Chromium copy, (3) Rust + IPC gives me a clean security boundary for filesystem access, (4) I already knew Rust well enough to be productive. The downside is the smaller community and slower-moving plugin ecosystem vs Electron, I've hit a few rough edges, especially around code signing and notarization. Worth it for the size and the security model. Native (Swift / WinUI) was the alternative but a 2-platform solo project couldn't justify two codebases.

### 5. "Have you tried [LM Studio / Ollama / local LLM]?"

**Reply:**
> Ollama shipped in v1.5 as a first-class fourth provider. Auto-detects your local Ollama daemon (`http://127.0.0.1:11434`), lists installed models, drops them into the same model picker alongside Claude / GPT / Gemini. Cost is always $0 for Ollama. Streaming via NDJSON. Same chat surface, same workflow templates, same `@workspace` RAG retrieval. If you want fully-offline, set Ollama as your default provider and never paste an API key. LM Studio isn't supported directly but you can point Ollama at the same local-models folder.

### 6. "How do you handle prompt injection / jailbreaks if AI can write files?"

**Reply:**
> Real concern. The AI doesn't write files autonomously, every file write is a tool call that either writes to a path the workflow already knows about, or asks the user before creating something new. Path traversal is blocked at the WorkspaceService layer (no `../`, no symlinks escaping the workspace root). There's an append-only audit log of every AI action, and an undo stack for everything. The prompt injection attack surface is "AI writes a file with malicious content", which is the same risk as any AI writing tool, but the destination is constrained. I've written tests for the `../etc/passwd` and `~/.ssh/id_rsa` cases. Not perfect, but bounded.

### 7. "What's your privacy story for the API keys?"

**Reply:**
> API keys live in your OS keychain, Keychain on Mac, Credential Manager on Windows, Secret Service on Linux. Never written to a plain file, never logged, never sent anywhere except directly to the provider when you make a request. If you uninstall the app, the keychain entry goes with it. Same model that 1Password uses.

### 8. "How big is the codebase?"

**Reply:**
> ~25,000 lines of TypeScript across 64 React components, 41 modules, and 5 Zustand stores, plus a few hundred lines of Rust in the Tauri commands. 13 spec files (Vitest + Playwright + a security suite that probes the path traversal cases). It's not trivial but it's not enormous, most of the code is in the editor extensions, the workflow engine, and the per-provider AI adapters.

### 9. "Did you actually build this in 8 weeks?"

**Reply:**
> The product itself is more like 18 months of weekend/evening work. The "8 weeks" number is the commercial launch, going from "an app exists" to "people pay money for it." That's legal docs, payment integration, cross-platform code signing, CI, the website, the pricing tiers, the license validation service, all of that. Documented the whole launch process publicly if anyone wants the details.

### 10. "What if I don't trust your code-signing certificate?"

**Reply:**
> Reasonable. Two answers. (1) Source is on GitHub, you can read it and build from source if you don't trust binaries. (2) The Windows cert is via Azure Trusted Signing (Microsoft is the issuing CA, not me) and the Mac cert is a standard Developer ID via Apple. Both certificates are tied to my legal identity, not Projelli's. If you don't trust those CAs, you don't trust most software you've installed in the last 10 years.

### 11. "Why $49 instead of free / cheaper / more expensive?"

**Reply:**
> $49 is in the impulse-buy zone for indie tools (typically $20-60). Above $60 needs a sales conversation; below $30 trains people to expect the next thing for $9. $49 gives me room to raise to $59 later as the brand strengthens. There's a 30-day full-feature trial first (no card required) so you get every feature unlocked before you decide. After 30 days, AI sends + workflow runs pause until license activation; existing files stay readable forever. There's also a $99 Lifetime tier (and a $29 Founder's Launch tier capped at the first 100 buyers).

### 12. "Will this still work in 5 years if you stop maintaining it?"

**Reply:**
> Yes. Your files are plain Markdown in a folder on your hard drive. The day Projelli stops getting updates, your files keep working in any other Markdown editor. That's the whole point of local-first. The Software might rot eventually (electron-style API breakage etc.) but your data is yours, in a format that has outlived every proprietary alternative.

### 13. "Have you talked to actual indie founders about whether they want this?"

**Reply:**
> Yes, that's where the founder template list came from. The 15 templates aren't speculation, they're the documents I and the founders I interviewed for Projelli kept saying they needed and didn't have a good place for. New Business Kickoff, Pricing Strategy, GTM Plan, Pitch Deck, Customer Persona, Investor Update, every one came from a conversation that started "the thing I wish I had a template for is…" If the templates don't match what you'd want, that's the most useful comment you could leave.

### 14. "I use Claude Projects and it works fine."

**Reply:**
> Claude Projects is the closest managed-cloud comparison and for a lot of people it's the right answer. The specific moment Projelli wins is when (a) you want the documents to live on your hard drive instead of in Anthropic's cloud, (b) you want to use Claude AND GPT AND Gemini in the same workspace and pick per-task, and (c) you want a real Markdown editor with wiki-links and backlinks alongside the chat. If none of those bother you, Claude Projects is great.

### 15. The skeptical "why does this need to exist" comment

**Reply (don't get defensive):**
> Honest answer: maybe it doesn't, for you. The market I'm building for is the founder who already has six tabs of ChatGPT open, can't find anything, and is starting to feel like the AI conversations are slipping through their fingers. If you're not in that position, you don't need this. I'm not trying to convert everyone, I'm trying to be the right answer for a specific use case.

### 16. "No image input? Multimodal is table stakes."

**Reply:**
> Image PASTE in the editor works (saves to media folder, drops a Markdown image link). Image as multimodal AI input doesn't ship in v1.7.2 — it's on the post-launch roadmap, ~30-45 days. Engineering-wise it's mostly wiring `image_url` content blocks for Claude / OpenAI / Gemini. I'd rather ship it correctly across all four providers than half-ship it for one. For chart screenshots / UI feedback today, use Claude.ai or ChatGPT directly.

### 17. "Can the AI read my PDFs?"

**Reply:**
> PDFs render in the in-app viewer but text isn't extracted into chat context yet. PDF chat (chunking + embedding + retrieval, or the Claude API native PDF upload path) is on the post-launch roadmap. For now: copy-paste relevant sections into chat. The RAG system already indexes Markdown / text content so anything text-extracted is queryable via `@workspace`.

### 18. "Where's mobile / iPad / Android?"

**Reply:**
> Desktop only. Mobile would require either cloud sync (compromises local-first) or local-network sync (a meaningful product on its own). Read-only mobile companion is plausible in 2026; full mobile is post-year-1. Tauri 2 has experimental mobile support but it's not production-ready. If mobile-first matters, Notion or Bear are better fits today; if local-first matters more than mobile, Projelli.

### 19. "Long context? My workspace has 5K notes."

**Reply:**
> Context Token Limit defaults to 50K, max 200K. RAG (Memory) handles larger workspaces by retrieving only relevant chunks at query time — index lives in `<workspace>/.projelli/vectors/` (LanceDB + fastembed-rs, 384-dim e5-small embeddings). For "shove everything in" use cases, set the context limit higher or be selective. Will lift the 200K cap when Anthropic / Google's 1M-token context becomes broadly stable.

### 20. "Does it work with Claude Desktop / Cursor / Zed via MCP?"

**Reply:**
> Yes — Projelli ships its own MCP server, packaged as a `.mcpb` Desktop Extension. One-click install from Settings → Integrations. Five tools exposed: list_workspace_files, read_workspace_file, search_workspace (uses the same RAG retrieval as in-app), write_workspace_file (with confirmation), get_memory_facts. So Claude Desktop can ask "what did I write about pricing in /Projects/Acme/?" and get the answer back via Projelli. Path safety: rejects `..` traversal, absolute paths, symlinks escaping workspace. Cap 5 MiB per read.

### 21. "Why no plugin system like Obsidian?"

**Reply:**
> Different bet. Obsidian's 5,000-plugin ecosystem IS its product; the on-ramp for new users is "install these 12 plugins to get a working setup." Projelli ships workflows + AI integration + RAG + memory + MCP in the box. Code-level extension is documented (new file type, new setting, new shortcut, new workflow template, new AI provider). If your Obsidian setup with N plugins is dialed, don't switch. If you want a coherent app that does the AI workspace stuff out-of-the-box, Projelli.

### 22. "Can I import my Notion / Obsidian content?"

**Reply:**
> Notion → Projelli: Notion's built-in Markdown export → drop the export folder into your Projelli workspace, done. Obsidian → Projelli: vaults are already plain Markdown in folders, point Projelli at the vault folder. No "fancy one-click importer" yet (post-launch backlog) but the "plain Markdown in folders" format means existing tools hand off cleanly without a custom importer. Mem / Reflect / Roam require their export flow first; varies by tool.

### 23. "Mac install requires right-click → Open?"

**Reply:**
> Not since v1.6 — Mac builds are signed with Developer ID AND notarized by Apple. Standard Gatekeeper "Apple checked it" prompt on first launch, no right-click dance. Earlier builds (pre-v1.6) had to ship unnotarized because Apple's notary service was degraded for ~2 weeks; that's resolved.

---

## HN-specific anti-patterns

1. **Never reply with "thanks!" alone**, adds nothing and clutters the thread
2. **Never use "we" for a solo project**, HN will call it out within 5 minutes
3. **Never link to other products in your replies**, it reads as desperate cross-promotion
4. **Never argue with downvoted comments**, let them sink, the system works
5. **Never post a follow-up comment that's just a marketing recap**, HN penalizes this
6. **Never apologize for the post being on HN**, confidence without arrogance
7. **Never reply to your own submission with an upvote-bait comment**, it's transparent

## HN-specific positive moves

1. **Reply within 5 minutes of every comment for the first 4 hours**, comment density is a ranking factor
2. **Be specific about technical tradeoffs**, HN respects engineers who understand the cost of their decisions
3. **Admit limitations early in the comment**, "this is wrong / missing because..." earns trust
4. **Link to specific source files for technical questions**, "the path validation lives in `src/modules/workspace/PathValidator.ts`" reads as someone who knows their codebase
5. **Use the show-the-work voice**, describe what you tried that didn't work before describing what did

---

## Submission timing

| Day | Submit time (PT) | Why |
|---|---|---|
| **Tuesday** | 9:00 am | Best HN day, peak office hours East Coast, full visibility window |
| **Wednesday** | 9:00 am | Almost as good as Tuesday |
| **Monday** | 8:30 am | Slightly worse, weekend backlog still on front page |
| **Thursday** | 9:00 am | Decent but the front page turns over slower |
| **Friday** | NEVER | HN traffic drops 40% Friday onward |
| **Weekend** | NEVER | Weekend HN is dominated by article-style posts, Show HN gets buried |

**Recommended:** Same day as the Product Hunt launch (Tuesday or Wednesday). Submit Show HN at 9:00 am PT after the PH listing has been live for ~9 hours and has its own social proof. Do NOT submit Show HN before PH, if Show HN front-pages first, you've blown the synergy.

---

## What success looks like

| Metric | Floor (acceptable) | Target | Stretch |
|---|---|---|---|
| Front page (top 30) | Yes for 1+ hour | Yes for 4+ hours | Top 10 for 6+ hours |
| Total points | 30+ | 80+ | 200+ |
| Comments | 15+ | 50+ | 100+ |
| Click-through to projelli.com | 500+ | 2,000+ | 8,000+ |
| Email signups within 24 hr | 20+ | 100+ | 400+ |
| Paying customers within 24 hr | 2+ | 10+ | 30+ |

The "stretch" numbers are 99th-percentile Show HN outcomes for a tool in this category. Don't aim for them, aim for the target column and treat anything above as a bonus.

---

## What to do if it dies on the second page

1. **Don't repost.** HN will penalize you and the post will be filtered.
2. **Keep replying to comments for 24 hours.** Even a 12-point post can climb back if the comment thread stays active.
3. **Don't ask anyone to upvote.** Vote manipulation is the only thing that gets you account-banned.
4. **Take the lessons and move on.** A flat Show HN is one channel of many. The PH launch, the IndieHackers post, the blog, and the email list all do their own work.
5. **Consider a re-submit with a new angle in 3-4 months.** A "Show HN: I shipped 3 months later, here's what changed" post is allowed and often does better than the original launch.

---

*This document is the launch-day playbook. Print it (or open it on a second screen) and follow it line by line.*
