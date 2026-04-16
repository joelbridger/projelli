# 05 — Differentiation Strategy (where to plant Projelli's flag)

> The big question: of the 110 feature ideas in `04-FEATURE_BRAINSTORM.md` and the gaps in `02-COMPETITIVE_DEEP_DIVE.md`, which 3-5 differentiators should Projelli double down on to own a defensible position? This doc picks the hill. `06-RECOMMENDATIONS_BY_LOE.md` maps individual features to that hill.

---

## The decision framework

A good Projelli differentiator must satisfy all five of:

1. **Aligns with a structural guardrail** (local-first, BYOK, single-user, desktop-only, one-time pricing). If a feature only works when a guardrail breaks, it's the wrong feature.
2. **A major competitor STRUCTURALLY cannot ship it** (not just "hasn't yet"). Notion can't ship files-on-disk without breaking their data moat. ChatGPT can't ship BYOK-to-Claude without breaking their identity. That's the kind of cannot-ship that matters.
3. **Solves a named, vocalized founder pain** from `03-USER_INSIGHTS.md`, not a generic "nice to have."
4. **Has an obvious demo moment** — you can record a 20-second Loom of it and someone on HN goes "oh, I want that."
5. **Compounds with the other differentiators** — not a standalone feature, but a feature that makes the other differentiators more valuable.

Measured against these five, here are the Projelli flags to plant.

---

## The 4 flags (in rank order)

### Flag 1: "The AI workspace that remembers your stuff"

**What it means:** A local RAG + memory layer that makes every chat context-aware of your entire workspace AND a persistent "facts file" that knows the long-lived truths about you (company, goals, voice, constraints). Plus the ability to cite where a claim came from (which file, which paragraph).

**Concretely, this is:**
- Local vector index over every workspace file (LanceDB + e5-small + fastembed-rs)
- `@workspace` command in chat → retrieves top-K chunks with citations
- "Ask my workspace" mode that answers questions by retrieving + citing
- Local memory facts file pre-pended to system prompts
- Fact extraction with user approval ("save this as a fact")
- Optional interop with Claude Memory / ChatGPT Memory APIs

**Why it qualifies:**

1. **Guardrail-aligned:** All data stays local. Embeddings run on-device (e5-small is ~80MB, <30ms per doc). Facts file is local JSON. Zero cloud dependency.
2. **Structurally unavailable to competitors:** 
   - ChatGPT / Claude / Gemini Memory are cloud-hosted — can't work with files they don't have.
   - Obsidian's Smart Connections + Copilot are plugins; inconsistent UX and you assemble it yourself.
   - Notion's "ask your workspace" is cloud Notion DB, not your files.
   - NotebookLM is closest but it's research-synthesis, not drafting / memory.
3. **Named founder pain:** Pain #2 "Context loss / memory amnesia." Vendor stat cited: *"Professionals waste 5+ hours per week re-explaining the same information to AI tools."* Pain #1-C in VOC: *"Persistent, portable cross-tool memory."*
4. **Demo moment:** "Ask Projelli: what did I decide about pricing three months ago?" → citation → open the exact paragraph. Twenty seconds.
5. **Compounds:** This is the foundation for Flag 2 (MCP server exposes the vector index), Flag 3 (Canvas-style editing uses the memory for context), and Flag 4 (voice commands become useful because "find my notes about X" actually works).

**Tagline:** *"The AI workspace that remembers your stuff."*

**Positioning:** Not "another note app with AI search." The promise is specifically: *the AI you talk to today knows everything you've written in Projelli, and cites where the answer came from.*

---

### Flag 2: "Your workspace, available in every AI tool you use"

**What it means:** Projelli exposes an MCP server bundled as a `.mcpb` one-click install. Claude Code, Cursor, ChatGPT Desktop, Anthropic Computer Use — everywhere MCP lives, Projelli's workspace is accessible. Plus Projelli *consumes* MCP servers so founders can wire Linear, GitHub, Stripe, Notion, Postgres into their chat.

**Concretely, this is:**
- A Projelli MCP server (in Rust or bundled Node) that exposes read/write of the user's workspace
- Distributed as a signed `.mcpb` Desktop Extension bundle — one-click install in Claude Desktop
- In-app MCP client that consumes the Official MCP Registry (~2,000 servers)
- OAuth flows for Linear / GitHub / Stripe / Notion connections
- Tool-call execution engine (the stub in the codebase → actually execute the calls)

**Why it qualifies:**

1. **Guardrail-aligned:** MCP is a local process. Projelli's server runs on the user's machine, serves the local workspace files. Everything stays local; external connections use the user's OAuth credentials.
2. **Structurally unavailable:** 
   - Notion cloud DB can expose MCP, but not your files-on-disk (Projelli only).
   - Obsidian doesn't have a first-party MCP server; community plugins approximate it.
   - Granola's MCP server exposes Granola-cloud data, not your files.
   - ChatGPT / Claude / Gemini are MCP *clients*, they don't expose themselves.
3. **Named founder pain:** Pain #9 (tool sprawl, decision fatigue). VOC #4 ("remix three or four AI tools into new vertical workflows" — Greg Isenberg). VOC #5 (local-first chat with mixable cloud + local models).
4. **Demo moment:** "I install Projelli's MCP bundle in Claude Desktop with one click. Now when I ask Claude a question in Claude Desktop, Claude can read my Projelli workspace AND my Linear tickets AND my Stripe revenue." Twenty seconds, mind-blowing.
5. **Compounds:** Projelli's MCP server is useful because of Flag 1 (vector index makes "ask workspace" queries from outside Claude Desktop work). Flag 3 (Canvas editing) and Flag 4 (voice) all rely on tool-calling, which the MCP client infrastructure establishes.

**Tagline:** *"Your workspace, available in every AI tool you use."*

**Positioning:** Not "Projelli is a closed app." The promise: *wherever AI lives, your Projelli workspace is a first-class citizen.* This is a surprising reframe from "AI workspace app" to "AI workspace protocol."

---

### Flag 3: "AI edits your doc side-by-side with you"

**What it means:** The Canvas / Artifacts UX pattern, but local. Highlight a paragraph, ask "tighten this," see the AI's revision stream in-place with diff highlighting, click accept or reject per change. Version history captures every edit with attribution (human or AI).

**Concretely, this is:**
- Inline chat anchored to the active document
- Streaming text replacement with diff visualization
- Per-change accept / reject UI
- Version history integration (who/what authored each paragraph)
- Works in any editor pane (left or right split)

**Why it qualifies:**

1. **Guardrail-aligned:** Everything happens in the local editor. AI calls use BYOK. No cloud canvas to hydrate.
2. **Structurally unavailable:**
   - ChatGPT Canvas is cloud-bound to OpenAI's chat and can't edit files on your disk.
   - Claude Artifacts are ephemeral, cloud-hosted, and don't persist to your file system.
   - Obsidian plugins approximate this but feel like plugins — inconsistent UX.
   - Microsoft Copilot Pages require M365 subscription + cloud docs.
3. **Named founder pain:** Pain #5 (vibe-coding cognitive exhaustion — "chasing the horse"). Founders want AI editing in-place, not as a separate tab they context-switch to. VOC #4 (workflow templates with named outputs — the output is the doc being edited).
4. **Demo moment:** "I type a paragraph. I highlight it. I say 'tighten this to 3 sentences.' Three sentences appear, diffed against the original, click accept." Five seconds. Proven by ChatGPT Canvas's popularity.
5. **Compounds:** This is THE defining UX moment for an AI workspace. Flag 1 (memory) makes the "tighten" call aware of the doc's broader context. Flag 2 (MCP) means the same pattern works when an external MCP client edits your files. Flag 4 (voice) means "say the edit instead of typing it."

**Tagline:** *"AI edits your doc side-by-side with you."* (or: *"Your doc, your cursor, your AI."*)

**Positioning:** Not "we added Canvas-like features." The promise: *the chat is never separate from the doc. They're the same surface. AI suggests, you approve, the version history remembers both contributions.*

---

### Flag 4: "Talk to your AI like it's already caught up"

**What it means:** Local voice input via Parakeet.cpp (96x faster than Whisper, offline) + Ollama as a 4th provider for complete-offline operation + the memory layer from Flag 1 making the AI actually responsive to "where were we yesterday?"

**Concretely, this is:**
- Press-to-talk hotkey: hold key, speak, release, transcription drops into chat input
- Parakeet.cpp or whisper.cpp sidecar binary (bundled)
- Voice-to-file quick capture: record voice memo, auto-transcribed, saved to workspace/Inbox
- Ollama integration as a 4th provider for "all of this stays on my disk" mode
- The memory layer from Flag 1 means speaking "where were we on the pricing plan?" actually resolves

**Why it qualifies:**

1. **Guardrail-aligned:** Parakeet / whisper.cpp run locally. Ollama runs locally. No voice data to any server. Pure local-first.
2. **Structurally unavailable:**
   - ChatGPT Voice Mode is cloud, OpenAI-only, and doesn't understand your files.
   - Claude Voice Mode same — Anthropic-only, cloud.
   - Wispr Flow is adjacent (dictation layer) but doesn't have memory of your work.
   - Granola is meeting-centric voice.
   - Notion 3.4 has voice input but to Notion's cloud.
3. **Named founder pain:** Pain #2 (context loss — voice can't bypass this without memory). VOC #5 (local-first chat mixed with cloud). Opinion leader voice (simonw quote: *"chasing it around trying to keep it pointed forward. It's so tiring"* — voice + memory is the rest from that).
4. **Demo moment:** "I hit Shift-Space, say 'what did we decide about Week 3 of the launch?' I release. Projelli responds with the answer, offline, citing my BACKLOG.md." Ten seconds. The Parakeet-vs-Whisper speed difference is dramatic on screen.
5. **Compounds:** Voice is the *access method*. It only matters because of Flag 1 (memory makes it useful), Flag 2 (MCP can be invoked by voice), Flag 3 (voice can trigger "tighten this paragraph").

**Tagline:** *"Talk to your AI like it's already caught up."*

**Positioning:** Not "we added voice input." The promise: *you can ask the AI out loud, offline if you want, and it already knows what you're working on.*

---

## The arc across the 4 flags

The four flags compound into a single narrative that no competitor can replicate:

> **Projelli is the AI workspace that remembers your stuff, is available in every other AI tool you use, edits with you side-by-side, and you can talk to like it's already caught up.**

Each flag reinforces the others:

| Flag | Requires | Reinforces |
|---|---|---|
| 1. Memory | — | Makes all other flags more capable |
| 2. MCP | Flag 1 (exposes the vector index) | Distributes flags 1, 3, 4 beyond Projelli's UI |
| 3. Side-by-side | Flag 1 (context for edits), Tool-calling (from Flag 2) | The defining UX moment for the product |
| 4. Voice | Flag 1 (voice queries need memory) | The access method that makes all three feel magical |

The order also happens to be the right build order:

- **Flag 1 must ship first** (foundation). Roughly 3-4 weeks of work.
- **Flag 2 ships next** (distribution multiplier). Roughly 3-4 weeks.
- **Flag 3 ships third** (defining UX). Roughly 2-3 weeks.
- **Flag 4 ships last** (polish + novelty). Roughly 2 weeks.

Total: ~12-14 weeks for all four — approximately the 6-month window this plan anticipates, with buffer.

---

## What we're NOT planting a flag on (and why that's okay)

Explicitly not in the differentiator set:

### Real-time collaboration

*"Notion has more. So does AFFiNE. So does Logseq RTC."* Intentionally out of scope. The founder ICP is single-user; collab is a different product for a different buyer. Including it as a flag would require abandoning single-user and inviting Notion / AFFiNE head-to-head.

### Lowest price

*"Logseq is free. Bear is $2.99."* Projelli isn't winning on price. It's winning on "designed for the job."

### Most features

*"Tana has more. Notion has more."* Projelli has the *right* features for a founder. Feature count is not the moat.

### Slickest design

*"Reflect is prettier. Craft is prettier."* Projelli is functional and fast. Beautiful is a future investment, not a launch differentiator.

### Biggest ecosystem / community

*"Obsidian has hundreds of thousands of users."* Projelli is new. Community grows from delighted users, not from day-one launch marketing.

### Mobile

*"Notion is on mobile."* Desktop-only is intentional. Mobile is a different product.

### Multi-agent / autonomous workflows

*"Notion shipped Custom Agents. Cursor 3 has parallel agents. Devin, Manus, Replit Agent 4 all do this."* Agents are a siren song for Projelli (see `08-RISKS_AND_ANTIPATTERNS.md`). Structured workflows with a "scheduled run" feature cover 80% of the user-visible benefit without the hallucination tarpit.

---

## Marketing implications

The four-flag narrative rewrites parts of the current launch copy. The homepage hero ("Big, annoying project? Put it in one place.") is fine as-is — it sets up the emotional appeal. But the "3 features cards" section and the Product Hunt / Show HN pitches should reflect the four flags.

Revised draft hero for post-launch iteration (not a rewrite, an option):

> **The AI workspace that remembers your stuff.** Projelli is a desktop AI workspace for indie founders. Your files, your keys, your machine. The AI knows what you've already written. It edits with you, not at you. And it's available in every other AI tool you use.

Revised draft Show HN title:

> **Show HN: Projelli – Desktop AI workspace where Claude / GPT / Gemini can read your local files (BYOK, one-time price)**

Revised draft Product Hunt tagline:

> **15 founder workflows that use your Claude / GPT / Gemini keys and save the output to your own hard drive.**

These aren't final copy. They're alignment checks — if the launch copy doesn't implicitly hit at least two of the four flags, it's underselling the differentiation.

---

## What if we can't build all four by Q4 2026?

Realistic scenario: side-project pace means we might only ship 2-3 of the four in six months. Priority order if forced to pick:

1. **Flag 1 (memory)** — ship first, non-negotiable. Without it, none of the others are as useful.
2. **Flag 2 (MCP)** — ship second for the distribution multiplier. Every week Projelli isn't in the MCP Registry is a week of missed discovery.
3. **Flag 3 (side-by-side editing)** — ship third for the defining UX demo. Critical for video marketing.
4. **Flag 4 (voice + Ollama)** — ship last. Novelty that matters, but memory + MCP + Canvas together already make Projelli defensible.

If only one flag ships before the hard launch on Product Hunt, pick Flag 1. The "AI workspace that remembers your stuff" is the single cleanest differentiator story.

---

## Bottom line

Four differentiators, one narrative, 12-14 weeks of focused build. Each flag satisfies all five test criteria. Each compounds with the others. Each speaks to a specific founder pain. Each has a demo moment. And critically: each is something the major competitors CAN'T ship without breaking their own business model.

`06-RECOMMENDATIONS_BY_LOE.md` translates these flags into specific tickets with LOE estimates and dependencies. `07-ROADMAP.md` sequences them against the 8-week launch ramp and the 6-month horizon.
