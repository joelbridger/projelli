# 11: Pre-Launch Gap Analysis + Anticipated PH/HN Criticism

_Written: 2026-04-29 by Claude (CEO mode), in response to Jameson's question: "do a final pass on the project to identify any clearly embarrassing features we missed when compared to our competitors or compared to where the market is going."_
_Re-review: month 1 post-launch (after first 100 buyers + first PH/HN feedback cycle)._
_Companion doc: `~/projelli/docs/strategy/competitive-product-gaps-and-implementation.md` is the deeper product-engineering analysis (why each gap matters competitively, how to implement each fix, trade-offs, recommended roadmap by quarter). This doc is launch-focused (what gets criticized + reply preparation); the companion is product-roadmap focused._

This document is the honest pre-launch audit. The goal: walk into PH/HN/IH knowing the embarrassing gaps and either close them in the next 1-2 weeks OR pre-stage honest answers so we don't get blindsided.

The structure:

1. Critical reconciliation (what's actually shipped vs what stale docs say)
2. True product gaps relative to competitors (organized by severity)
3. Anticipated PH/HN criticism we ARE prepared for
4. Anticipated PH/HN criticism we are NOT prepared for (the dangerous list)
5. Marketing-surface gaps (where docs / FAQs / homepage lag the product)
6. Pre-launch fix priority (top 5 ranked by ROI)
7. Post-launch backlog (deliberate deferrals with public roadmap)
8. The embarrassing things hunters might call out, ranked

---

## 1. Critical reconciliation: what's actually shipped vs what FEATURES.md says

**`docs/reference/FEATURES.md` is from 2026-04-16 (v1.0.8 era) and is now badly stale.** v1.5 / v1.6 / v1.7.x have shipped 4 flags + 18 quick wins + 2 multi-model mediums + Mac notarization + trial system + telemetry. A future contributor / journalist / future Claude session reading FEATURES.md would believe Projelli is missing features that actually shipped.

**This is itself a gap that needs fixing pre-launch.** A press kit reader who clicks "view source / docs" and lands on FEATURES.md will think the product is half-done.

### What FEATURES.md (v1.0.8) claims is missing but DID ship in v1.5+

| Feature | FEATURES.md says | Actual state (per CHANGELOG) |
|---|---|---|
| Mermaid diagram rendering | Not mentioned | ✅ Shipped v1.5 (Quick Win #1) |
| KaTeX math rendering | Not mentioned | ✅ Shipped v1.5 (Quick Win #2) |
| Real-time API cost meter | Not mentioned | ✅ Shipped v1.5 (Quick Win #3) |
| Monthly cost dashboard | Not mentioned | ✅ Shipped v1.5 (Quick Win #4) |
| Local RAG over workspace | Not mentioned | ✅ Shipped v1.5 (Flag 1, M1) |
| `@workspace` chat command + per-chat toggle | Not mentioned | ✅ Shipped v1.5 (Flag 1, M2) |
| Memory facts file (always in system prompt) | Not mentioned | ✅ Shipped v1.5 (Flag 1, M3) |
| MCP server (workspace exposed to Claude Desktop / Cursor / Zed) | Not mentioned | ✅ Shipped v1.5 (Flag 2, M4) |
| Side-by-side AI editing (per-hunk accept/reject diff) | Not mentioned | ✅ Shipped v1.5 (Flag 3, M5) |
| Voice input via Parakeet.cpp / whisper.cpp sidecar | Not mentioned | ✅ Shipped v1.5 (Flag 4, M6) |
| Ollama as 4th provider | Not mentioned | ✅ Shipped v1.5 (Flag 4, Q7) |
| Mac notarization | Says "currently unnotarized" | ✅ Shipped v1.6 (Apple notary recovered) |
| Image paste in Markdown editor | Not mentioned | ✅ Shipped v1.5 (Q13) |
| Smart paste URL → link | Not mentioned | ✅ Shipped v1.5 (Q12) |
| Wiki-link autocomplete | Not mentioned | ✅ Shipped v1.5 |
| Run-on-all-3 multi-provider compare | Not mentioned | ✅ Shipped v1.5 (Q15) |
| Template fork / remix | Not mentioned | ✅ Shipped v1.5 |
| API-key onboarding wizard | Not mentioned | ✅ Shipped v1.5 |
| Template preview gallery | Not mentioned | ✅ Shipped v1.5 (Q10) |
| `/vs/` comparison pages | Not mentioned | ✅ Shipped v1.5 (Q17) |
| 30-day full-feature trial | Not mentioned | ✅ Shipped v1.7.0 |
| License activation | Not mentioned | ✅ Shipped v1.6 |
| Telemetry consent UI + privacy panel | Not mentioned | ✅ Shipped v1.7.2 |
| Public roadmap page | Not mentioned | ✅ Live at projelli.com/roadmap |

**FEATURES.md needs a full rewrite to v1.7.2 state.** This is a Tier-1 pre-launch fix (see § 6 below).

---

## 2. True product gaps relative to competitors (organized by severity)

These are genuine missing features in v1.7.2 that competitors have.

### Tier A: features competitors have that founders will EXPECT and call out

#### 2.1 Multimodal AI input (image / PDF as chat context)

**The gap:** Projelli supports image PASTE into the Markdown editor (saves to `media/` folder, inserts a Markdown image link). It does NOT support sending images TO THE AI for visual analysis. ChatGPT, Claude.ai, and Gemini all do this. Founders pasting a screenshot of a chart and asking "what does this show?" will get rejection or worse.

**Why it matters:** Multimodal is now baseline expectation in any AI tool. Indie founders specifically use this for: pasting competitor pricing screenshots, sharing whiteboard photos, debugging UI screenshots, analyzing data charts.

**Why it's missing:** v1.5 focused on the four flags (memory, MCP, side-by-side, voice + Ollama). Multimodal wasn't on the v1.5 plan because it's an inference-side feature (the model handles it; we just need to wire the API calls). It's relatively cheap to add (~3-5 days engineering) but wasn't prioritized.

**Severity: HIGH.** First Show HN comment will be "no image input?" and the answer "we plan to add it" lands acceptable but not great.

#### 2.2 PDF as chat context (extract text, send to AI for analysis)

**The gap:** Projelli has a PDF viewer (line 37 of FEATURES.md). PDFs sit in the workspace. But there is NO way to say "summarize this PDF" or "answer questions from this PDF." The PDF is a rendered file, not chat context.

**Why it matters:** Anthropic's Claude API supports PDF uploads natively. ChatGPT does too. Gemini does too. Founders use this constantly for: contract review, research papers, investor decks, marketing one-pagers. A founder uploading their pitch deck for AI feedback expects this to work.

**Why it's missing:** The RAG system (M1) indexes Markdown / text files. PDF text extraction → chunking → embedding wasn't on the v1.5 plan. Same engineering category as multimodal (mostly model-side handling).

**Severity: HIGH.** Direct competitor parity gap.

#### 2.3 No mobile / iPad / web access

**The gap:** Desktop only (Mac / Windows / Linux). No iOS app, no Android app, no iPad app, no web version. Per FEATURES.md line 279, "Mobile versions" is explicitly listed as "Not yet supported."

**Why it matters:** Indie founders are increasingly mobile-first. Reading a draft on the train, replying to a customer interview prompt at lunch, jotting an idea while walking — these moments live on phones. Notion, Obsidian (mobile sync), Reflect, Mem.ai, Bear, Things — all have mobile apps.

**Why it's missing:** Tauri 2 has experimental mobile but nothing close to production. Building mobile is a 6-12 month side track. The strategy doc explicitly defers this (cloud sync would be required, which compromises local-first).

**Severity: MEDIUM-HIGH.** Founders will ask. The honest answer is "desktop is the v1 product. Mobile is post-year-1." Some buyers will walk because of this.

#### 2.4 No web version

**The gap:** Desktop install required. No "try it in your browser" path. ChatGPT, Claude.ai, Gemini, Notion, Reflect, Mem.ai all have web entry points.

**Why it matters:** Friction tax on first-touch conversion. Someone who finds Projelli via PH at 2 AM might want to try it instantly without committing to an install.

**Why it's missing:** Local-first means files on disk. Browser File System Access API exists (`WebFSBackend.ts`) but it's an inferior UX (Chrome-only, permission prompts, no tray icon). Per the architecture, browser version was always a fallback for development, never a shipping product.

**Severity: MEDIUM.** Doesn't block buying, but is a friction point on demo. The 30-day free trial via download is the workaround.

### Tier B: gaps that exist but have legitimate "by design" answers

#### 2.5 Real-time collaboration

**Gap:** No multi-user editing. Out of scope per FEATURES.md line 278. Notion, Google Docs, Reflect have it.

**Honest framing:** "Local-first is the differentiator. If you want real-time collaboration, use Notion. If you want your data on YOUR machine, use Projelli." This is anti-pattern #1 in `07-anti-patterns.md` and we don't add it.

**FAQ status:** Covered in PH FAQ comment 8.

#### 2.6 Cloud sync built-in

**Gap:** No native sync. Users must use Dropbox / iCloud / Syncthing. Notion AI / Reflect / Mem.ai / Tana have native cloud.

**Honest framing:** "Your workspace folder works in any cloud sync. We don't build sync ourselves because that compromises 'no Projelli server in the data path.'"

**FAQ status:** Partially covered. Could be sharper.

#### 2.7 Plugin system / extension marketplace

**Gap:** No plugin system. Code-level extension only (per FEATURES.md line 242). Obsidian's plugin marketplace IS its product (~5,000 plugins).

**Honest framing:** "Obsidian's plugin model is amazing for power users; it also creates the version-fragmentation problem where 'install these 12 plugins to get my setup' becomes the on-ramp. Projelli ships the workflow gallery + AI integration in the box, no plugin assembly required. Different bet."

**FAQ status:** Not currently in PH/HN FAQ. Should add.

#### 2.8 Long-context handling beyond 200K tokens

**Gap:** Settings has Context Token Limit defaulting to 50K, max 200K (per FEATURES.md line 147). Claude 3.5 Sonnet supports 200K. But Anthropic + Google have shipped 1M-token context windows; OpenAI is rumored to follow. Founders running massive workspaces (50+ markdown files) will hit the cap.

**Why it matters:** Power users with rich workspaces want everything in context. The RAG system (M1) handles this for relevant retrieval, but a "shove it all in" mode would be more familiar.

**Severity: LOW-MEDIUM.** Most chats don't need 1M tokens. Power users will ask.

### Tier C: gaps that are basically irrelevant to our ICP

#### 2.9 Agentic workflows / autonomous multi-step AI

**Gap:** Cursor, Claude Code, Devin, ChatGPT Operator, Cline all have "AI does multiple steps autonomously." Projelli's tool use is single-step + user-approval per anti-pattern.

**Honest framing:** "Autonomous AI is a different product. Projelli's pillar is 'AI proposes, user decides.' It's an editor, not an agent. If you want an agent that touches your codebase, use Cursor. If you want every AI action approved by you, use Projelli."

**Severity: LOW.** Not most founders' priority for a writing/planning workspace.

#### 2.10 Voice OUTPUT (text-to-speech for AI responses)

**Gap:** Voice INPUT shipped in v1.5 (Parakeet.cpp / whisper.cpp). Voice OUTPUT (TTS) didn't. ChatGPT and Claude both have it.

**Severity: LOW.** Founders mostly read, not listen. Could be a nice-to-have.

#### 2.11 Internationalization (i18n) / multi-language UI

**Gap:** English only. Tauri supports it; we just haven't done it.

**Severity: LOW.** Indie founder ICP is heavily English-speaking.

#### 2.12 Templates marketplace / community templates

**Gap:** 15 baked-in templates. Can't import community templates. Notion's template gallery is huge.

**Severity: LOW-MEDIUM.** Some power users will ask. Template fork/remix shipped v1.5 (`docs/quality` mentioned this), so customization works; sharing doesn't.

#### 2.13 Formal accessibility audit / WCAG AA certification

**Gap:** ARIA grid semantics for spreadsheet (FEATURES.md line 66), keyboard shortcuts complete, but no formal WCAG AA audit. Most indie tools skip this.

**Severity: LOW** for indie ICP. Would matter for enterprise (which we're not chasing).

---

## 3. Anticipated PH/HN criticism we ARE prepared for

Per `channels/PRODUCT_HUNT_LAUNCH.md` § 12 anticipated comments + `channels/SHOW_HN_LAUNCH.md` § 15 anticipated comments — together, 27 pre-staged FAQ replies.

**Coverage check:**

| Criticism | PH FAQ | HN FAQ | Reply quality |
|---|---|---|---|
| "How is this different from Notion AI?" | ✅ | ✅ | Good |
| "How is this different from Obsidian + Smart Connections?" | ✅ | ✅ | Good |
| "Why one-time pricing?" | ✅ | ✅ | Good |
| "What about Linux?" | ✅ | — | Outdated (says "shipping today" but already shipped v1.5+) |
| "Why should I trust you not to upload data?" | ✅ | ✅ | Good |
| "What models does it support?" | ✅ | — | Outdated (says 3 providers, actually 4 with Ollama) |
| "Free tier crippled?" | ✅ | — | Needs update for trial system |
| "Will you do team accounts?" | ✅ | — | Good |
| "How long did this take?" | ✅ | ✅ | Good |
| "Source open?" | ✅ | ✅ | Good |
| "Why this not ChatGPT?" | ✅ | — | Good |
| "What if Projelli shuts down?" | ✅ | ✅ | Good |
| "What's your business model?" | — | ✅ | Good |
| "Why Tauri?" | — | ✅ | Good |
| "Have you tried Ollama?" | — | ✅ | **Outdated** (says "next on roadmap" — actually shipped v1.5) |
| "Prompt injection / jailbreaks?" | — | ✅ | Good |
| "API key privacy?" | — | ✅ | Good |
| "How big is the codebase?" | — | ✅ | Good |
| "Did you build this in 8 weeks?" | — | ✅ | Good |
| "Trust your code-signing certificate?" | — | ✅ | Good |
| "Why $49?" | — | ✅ | Good |
| "Will it still work in 5 years?" | — | ✅ | Good |
| "Talked to actual founders?" | — | ✅ | Good |
| "I use Claude Projects, works fine" | — | ✅ | Good |
| Skeptical "why does this need to exist?" | — | ✅ | Good |

**3 PH/HN FAQ replies are stale** (Linux, model count, Ollama roadmap status — all cite v1.0.8 era state, all need updating to v1.7.2).

---

## 4. Anticipated PH/HN criticism we are NOT prepared for (the dangerous list)

These will get asked. We have no pre-staged reply.

### 4.1 "Why can't I paste an image into the chat?" / "No multimodal?"
**Severity: HIGH.** First or second comment on Show HN. Honest reply needed: "Multimodal AI input is on the post-launch backlog. The Markdown editor accepts image paste (saves to your workspace folder). For chat-context image analysis, use Claude.ai / ChatGPT directly for now. We'll close this gap in the next ~30-45 days."

### 4.2 "Can the AI read my PDFs?" / "PDF chat?"
**Severity: HIGH.** Very common founder workflow (contract review, deck feedback, research). Reply: "PDF text extraction → chat context isn't shipped yet. PDFs render in the viewer. Workaround: copy-paste the relevant text into chat for now. Native PDF chat is on the post-launch backlog."

### 4.3 "Where's mobile / iPad / web?"
**Severity: MEDIUM-HIGH.** Reply: "Desktop is the v1 product. Mobile would require cloud sync, which compromises local-first. We may build a read-only mobile companion in 2026; full mobile is post-year-1. Web access is intentional non-goal."

### 4.4 "Does it integrate with Cursor / Claude Desktop / Zed via MCP?"
**Severity: MEDIUM.** Trick question — yes it does (M4 shipped v1.5: Projelli MCP server bundled as `.mcpb` Desktop Extension). But no FAQ reply explicitly says this. Reply: "Yes — Projelli ships an MCP server. One-click install from Settings → Integrations adds Projelli's workspace as a queryable tool inside Claude Desktop, Cursor, Zed, etc. Search / read / write to your Projelli workspace from any MCP client."

### 4.5 "Why no plugin system like Obsidian?"
**Severity: MEDIUM.** Reply: "Obsidian's plugin model is great for power users; it also creates the version-fragmentation problem where 'install these 12 plugins to get my setup' becomes the on-ramp. Projelli ships workflow templates + AI integration + memory + MCP in the box, no plugin assembly required. Different bet."

### 4.6 "What's your context window? Can it handle a 500K token workspace?"
**Severity: LOW-MEDIUM.** Reply: "Context Token Limit defaults to 50K, max 200K. The RAG system (Memory) handles larger workspaces by retrieving only relevant chunks. For 'shove everything in' use cases, set the limit higher or use the @workspace command to scope retrieval."

### 4.7 "What about Apple Intelligence / Microsoft Copilot integration?"
**Severity: LOW.** Reply: "Projelli is platform-agnostic. Apple Intelligence and Microsoft Copilot are bound to their OS. Projelli runs the same way on Mac, Windows, and Linux, with your choice of AI provider. The trade-off is more flexibility, less OS-deep integration."

### 4.8 "Trial system seems generous — what's the catch?"
**Severity: LOW.** Reply: "30 days, every feature, no card. After 30 days, AI chat sends + workflow runs are paused until license activation; existing files stay fully readable. We default to honest pricing, not nagware."

### 4.9 "Can I bring my Notion workspace / Obsidian vault into Projelli?"
**Severity: MEDIUM.** Reply: "Notion → Markdown export works (Notion's export creates Markdown, drop into your Projelli workspace folder, done). Obsidian vaults are already Markdown — just point Projelli at the vault folder. We don't have a one-click importer yet but the 'plain Markdown files in a folder' format means existing tools can hand off cleanly."

### 4.10 "Why does the Mac install / Windows install have any friction at all?"
**Severity: LOW-MEDIUM.** v1.6 Mac is signed + notarized — no right-click → Open required. Windows is Azure-signed (no SmartScreen warning). Reply: "First-launch UX is clean on both. If you see any warning, it's transient (build certs occasionally need reputation time)."

---

## 5. Marketing-surface gaps (where docs/FAQs/homepage lag the product)

### 5.1 FEATURES.md is from v1.0.8
**Action:** Full rewrite to v1.7.2 state. ~2 hours. Highest pre-launch priority on the docs side. (See § 6.1.)

### 5.2 PH FAQ replies are partially stale
**Action:** Update 3 outdated replies (Linux ✅shipped, models ✅4 not 3, Ollama ✅shipped not roadmap). 30 min. (See § 6.2.)

### 5.3 Show HN FAQ has same stale Ollama reply
**Action:** Same fix as 5.2. 10 min.

### 5.4 Homepage doesn't surface v1.5 features prominently enough
**Status:** v1.5 feature flags ARE on homepage ("AI workspace that learns you" lead, four-flag grid per CHANGELOG). But the PRESS KIT one-paragraph description (`website/press-kit/index.html` ~line 230) still emphasizes "every conversation produces a real Markdown file" without naming RAG, MCP, voice, or Ollama. Press kit could be updated to be more comprehensive.
**Action:** 30-min press kit refresh post-launch (low priority — homepage is fine).

### 5.5 No "What's new in v1.5/v1.6/v1.7" page on the website
**Status:** CHANGELOG.md exists in the repo but isn't surfaced on projelli.com. A `/changelog` or `/whats-new` page would help anyone evaluating the release cadence.
**Action:** 1 hour to add. (See § 6.4.)

### 5.6 The 4 flags (Memory, MCP, Canvas-edit, Voice+Ollama) aren't in the FAQ replies
**Status:** PH/HN FAQs were drafted for v1.0.8. They don't proactively name the v1.5 differentiators.
**Action:** Add 4 new FAQ replies, one per flag, that anticipate "What's RAG?" / "What's MCP?" / "How does side-by-side editing work?" / "How does voice input work offline?" (See § 6.3.)

---

## 6. Pre-launch fix priority (top 5, ranked by ROI)

### 6.1 ⚡ Update FEATURES.md to v1.7.2 state ⚡ (~2 hours)
**Why first:** This doc is the canonical "what does Projelli do?" reference. Future contributors, journalists, AI assistants reading the repo are misled by the v1.0.8 snapshot. Press kit links to documentation; documentation that says "currently unnotarized" when Mac is in fact notarized is embarrassing.
**Acceptance:** All v1.5 + v1.6 + v1.7.x features listed. "Not yet supported" section accurate to current state.

### 6.2 ⚡ Refresh stale FAQ replies (PH FAQ, HN FAQ) ⚡ (~30 min)
**Why second:** These are quoted directly into launch-day comments. Outdated content (Ollama as "roadmap" when it's shipped) makes us look like we don't know our own product.
**Acceptance:** Linux reply updated, model count updated to 4 with Ollama, Ollama reply confirms shipped status.

### 6.3 Add 9 new FAQ replies for the gaps in § 4 (~2 hours)
**Why third:** PH and HN comments will hit these. Pre-staged honest replies > scrambling at midnight.
- Multimodal (4.1)
- PDF chat context (4.2)
- Mobile (4.3)
- MCP integration (4.4) — turn the "trick question" into a brag
- Plugin system (4.5)
- Long context (4.6)
- Notion / Obsidian import (4.9)
- Trial system (4.8)
- "Why install required" (4.10)
**Acceptance:** Add to PH and HN FAQ docs. All voice-clean, no em dashes.

### 6.4 Surface CHANGELOG / "What's New" on website (~1 hour)
**Why fourth:** Anyone evaluating release cadence will look. Currently CHANGELOG is GitHub-only. Most savvy buyers expect a `/changelog` page.
**Acceptance:** `/whats-new` or `/changelog` page on projelli.com with formatted v1.7.2, v1.7.1, v1.7.0, v1.6.0, v1.5.0 entries.

### 6.5 Update press kit one-paragraph description (~30 min)
**Why fifth:** Press kit gets quoted in journalist articles. Current copy doesn't mention RAG, MCP, voice + Ollama. Small but meaningful refresh.
**Acceptance:** One-paragraph description includes all 4 flags (Memory, MCP, Side-by-side AI editing, Voice + Ollama) as named features.

### 6.6 (Stretch, post-launch) Ship multimodal AI input (3-5 days engineering)
Not pre-launch. But if there's a Phase 4 engineering window, this is the highest-leverage product fix. Closes one of the two TIER-A gaps (§ 2.1).

---

## 7. Post-launch backlog (deliberate deferrals — surface on public roadmap)

These are intentional not-yet-shipped features. They should appear on `projelli.com/roadmap` so PH/HN visitors can see what's coming and don't feel they're investing in a stagnant tool.

| Feature | Public-roadmap timeframe | Why deferred |
|---|---|---|
| Multimodal AI input (image / PDF) | 30-60 days post-launch | Wasn't on v1.5 plan; high ROI to add early |
| PDF text extraction → chat context | 30-60 days post-launch | Same engineering category as multimodal |
| Notion → Projelli importer | 60-90 days | Helps migration but not blocking |
| Obsidian vault auto-detect / one-click open | 60-90 days | Vaults work today, just not optimized |
| Read-only mobile companion (iOS/Android) | 6-12 months | Cloud sync is the prerequisite (or local-network sync) |
| Templates marketplace / sharing | 9-12 months | Wait for buyer-driven demand |
| Voice OUTPUT (TTS) | 3-6 months | Low priority |
| Long-context > 200K | When models support it broadly | Anthropic's 1M context window is the trigger |
| Internationalization (i18n) | Year 2 | English ICP first |

**Things explicitly NOT on roadmap (out of scope):**
- Real-time collaboration
- Cloud sync (built-in)
- Plugin marketplace
- Web app (browser-only product)
- Agentic / autonomous multi-step AI
- Mass-market subscription tier

These are deliberate "we don't do this" — not laziness. Per `strategy/00-master-strategy.md` § 7 (eight non-goals).

---

## 8. The embarrassing things hunters might call out, ranked by likelihood

This is the candid section. What WILL get said in the comments?

### Probability HIGH (>70% chance someone says it)

1. **"No image input? Even ChatGPT has this."** (Multimodal gap, § 2.1)
2. **"How do I import my Notion workspace?"** (No importer, § 4.9)
3. **"$49 once when ChatGPT Plus is $20/mo? Doing the math wrong unless I use AI a lot."** (Pricing perception, addressed in HN FAQ #11)
4. **"Why is FEATURES.md from April 16 if you've been shipping?"** (If they dig into the repo, § 5.1)
5. **"Source-available isn't open-source. Why not just MIT?"** (Licensing, addressed in PH FAQ #10 and HN FAQ #3)

### Probability MEDIUM (30-70% chance)

6. **"What's the AI doing under the hood with my data? Are providers training on it?"** (Privacy depth — partially covered, could be sharper)
7. **"Can I run this without ANY internet? Even for AI?"** (Yes, with Ollama — but this isn't FAQ'd)
8. **"Where's mobile?"** (§ 4.3)
9. **"Will it scale to 10K notes? My Obsidian vault has 5K."** (Scale claims need data — not FAQ'd)
10. **"Have you considered being acquired by Notion?"** (Strategic / acquisition speculation — won't necessarily come up but if it does, the answer is honest "not for sale, here for the long haul")
11. **"What's your retention rate? How many trial users buy?"** (Day-1 question we won't have data for. Honest reply: "Trial just shipped this week. Real numbers in 30 days.")

### Probability LOW (<30% but high impact if it happens)

12. **"Can you show me one customer who's using this for real founder work?"** (Testimonial gap — beta cohort needs to be in PH comments at launch with substantive observations. Per `02-launch-fuel.md` Day 1 strategy.)
13. **"Have you done a security audit?"** (No formal audit. Honest reply: "Source visible; tested in production; informal threat model documented.")
14. **"What if Anthropic / OpenAI / Google change pricing or APIs?"** (Honest reply: "BYOK means you absorb it directly, no Projelli markup. Provider-API instability is a risk for any BYOK tool.")
15. **"You shipped 5 versions in 2 weeks — is this stable?"** (Trust question. Honest reply: "v1.5 was the big release. v1.6 / v1.7.x are polish + commercial layer. The product surface area is mature.")

---

## 9. The single best pre-launch decision

If you do ONE thing from this audit before launch: **§ 6.1 (rewrite FEATURES.md to v1.7.2 state).** Two hours of work. Closes 80% of the embarrassment risk because:

- It eliminates the "your own docs say you don't have this feature" flag
- It surfaces the 18 quick wins + 4 flags + trial system + telemetry consent UI in the canonical repo doc
- Future Claude sessions will have accurate context
- Journalists clicking through to docs see a current product, not a 6-week-old snapshot

If you do TWO: add § 6.2 (refresh stale FAQ replies). Another 30 min. Stops the launch-day "they don't know their own product is shipped" embarrassment.

If you do THREE: add § 6.3 (add 9 new FAQ replies for the gaps in § 4). 2 more hours. Pre-stages honest replies for the gaps that WILL get called out.

Total: ~5 hours of pre-launch work to close the embarrassment risk to near-zero.

---

## 10. References

- `~/projelli/docs/reference/FEATURES.md` (NEEDS UPDATE — currently v1.0.8 / 2026-04-16)
- `~/projelli/docs/reference/COMPETITIVE_LANDSCAPE.md` (canonical per-competitor analysis)
- `~/projelli/CHANGELOG.md` (the actual shipped state — source of truth)
- `~/projelli/docs/marketing/channels/PRODUCT_HUNT_LAUNCH.md` § 12 anticipated comments
- `~/projelli/docs/marketing/channels/SHOW_HN_LAUNCH.md` § 15 anticipated comments
- `~/projelli/website/press-kit/index.html` (description blocks need refresh)
- `~/projelli/docs/marketing/strategy/07-anti-patterns.md` (the things we explicitly DON'T do, with reasons — useful for "no real-time collab" / "no cloud sync" honest replies)
