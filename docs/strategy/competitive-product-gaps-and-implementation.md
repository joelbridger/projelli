# Keepance Competitive Product Gap Analysis + Implementation Roadmap

_Written: 2026-04-29 by Claude (CEO mode), in response to Jameson's request for a thorough capture of the gap assessment with implementation details._
_Companion to `docs/marketing/strategy/11-pre-launch-gap-analysis.md` (which is launch-focused). This doc is product-engineering focused: why each gap matters competitively, how it would be implemented, what trade-offs each path involves, and what the recommended roadmap looks like to remain competitive._
_Re-review: month 1 post-launch (after first buyer cohort feedback), then quarterly._

---

## Table of contents

1. Executive summary
2. Methodology
3. The competitive landscape Keepance sits in
4. The gaps, prioritized by competitive impact
   - 4.1 Multimodal AI input (HIGH)
   - 4.2 PDF as chat context (HIGH)
   - 4.3 Mobile / iPad / Android (MEDIUM-HIGH)
   - 4.4 Web version (MEDIUM)
   - 4.5 Long context > 200K tokens (MEDIUM)
   - 4.6 Voice OUTPUT (TTS) (LOW-MEDIUM)
   - 4.7 Plugin system / extensions marketplace (LOW)
   - 4.8 Internationalization / i18n (LOW)
   - 4.9 Templates marketplace / community sharing (LOW-MEDIUM)
   - 4.10 Cloud sync built-in (deliberate non-goal)
   - 4.11 Real-time collaboration (deliberate non-goal)
   - 4.12 Agentic / autonomous AI workflows (deliberate non-goal)
5. Where the AI market is heading (forward-looking, 12-24 months)
6. Recommended product roadmap by quarter
7. Decision points requiring board input
8. References

---

## 1. Executive summary

Keepance's v1.7.2 product is meaningfully more substantial than its docs/FAQs claim — v1.5 shipped four headline flags (Memory/RAG, MCP server, Side-by-side AI editing, Voice + Ollama) and 18 quality-of-life features that were previously listed as "missing" in stale documentation. That gap has been closed (FEATURES.md rewritten 2026-04-29).

The TRUE remaining product gaps relative to competitors are smaller than feared but real:

**The two HIGH-severity gaps:** multimodal AI input (sending images to AI for analysis) and PDF as chat context. These are now table stakes in the AI tool category — ChatGPT, Claude.ai, Gemini, and most modern AI workspaces support both. Keepance supports image PASTE in the editor (saves to media folder) but does not send images to AI. PDFs render in the viewer but text isn't extracted into chat context. Both gaps are closeable in a single 5-7 day engineering sprint each. Both should ship within 30-45 days post-launch.

**The MEDIUM-severity gaps:** mobile companion (any form), web version (browser-based), long context (>200K tokens). These are deferrable to year 2 with honest "we made this trade-off because…" answers. The existence of plain-Markdown-on-disk + iCloud-Drive workarounds gives Keepance credible Year-1 answers without major engineering investment.

**The deliberate non-goals:** real-time collaboration, cloud sync built-in, plugin marketplace, agentic AI workflows, mass-market subscription tier. These are documented anti-patterns in `strategy/07-anti-patterns.md`. Keepance's competitive position depends on NOT building these.

**The bottom line:** Keepance is more competitive in v1.7.2 than competitors realize. Closing the two HIGH-severity gaps (multimodal + PDF) within 45 days post-launch puts Keepance at functional parity with ChatGPT/Claude.ai/Gemini on input modality while retaining its differentiators (local-first, BYOK, MCP server, founder workflow templates). The remaining gaps are MEDIUM-priority year-2 work or deliberate non-goals.

---

## 2. Methodology

This audit was performed by:

1. **Reading the actual shipped state.** `~/keepance/CHANGELOG.md` is the source of truth (v1.0.8 → v1.5.0 → v1.6.0 → v1.7.0 → v1.7.1 → v1.7.2). Cross-referenced against `~/keepance/docs/reference/FEATURES.md` (rewritten 2026-04-29 to v1.7.2 state).

2. **Reading the competitive landscape doc.** `~/keepance/docs/reference/COMPETITIVE_LANDSCAPE.md` per-competitor analysis: Notion AI, Obsidian + Smart Connections, ChatGPT, Claude.ai (Projects), Reflect, Tana, Logseq, Mem.ai, Cursor, Continue.dev.

3. **Reading the market assessment.** `~/keepance/docs/strategy/market-assessment-2026-04/` (40K-word, 9-doc assessment from April 2026). Quick-Wins recommendations Q1-Q20 + four-flag M1-M10 plan informed what was supposed to ship vs what actually shipped.

4. **Cross-referencing competitor docs.** Public documentation for each competitor was reviewed for: feature surface area, recent release notes, pricing, distribution model, AI provider integration patterns.

5. **Forward-looking research.** AI industry direction inferred from: model release cadence (Anthropic 200K → 1M context, OpenAI multimodal expansion, Google 1M → 2M Gemini context), MCP ecosystem growth, EU AI Act regulatory direction, Apple Intelligence / Microsoft Copilot encroachment.

6. **Honest priority calibration.** Severity ratings (HIGH / MEDIUM / LOW) are based on: (a) how often the gap will be raised by buyers/critics, (b) how strongly it impacts conversion, (c) how it shapes competitive perception, (d) how feasible it is to close given Keepance's 5-10 hr/week budget and architectural constraints.

The output (this doc) is honest — gaps are described as gaps even when they're hard to fix or out-of-scope. No defensive framing. Trade-offs are surfaced.

---

## 3. The competitive landscape Keepance sits in

To evaluate gaps fairly, we need to know what we're being compared against. Keepance operates in a category that includes:

| Category | Examples | Where Keepance wins | Where they win |
|---|---|---|---|
| **Cloud-first AI workspaces** | Notion AI, Reflect, Mem.ai, Tana, NotebookLM | Local-first (data on user's machine), BYOK (no AI markup), one-time pricing, MCP server, voice + Ollama, founder workflow templates | Real-time collaboration, polished mobile, web access, larger ecosystems, brand recognition |
| **Local-first knowledge tools** | Obsidian + Smart Connections, Logseq | Native AI integration (no plugin assembly), 4 providers + Ollama in box, founder workflow templates, MCP server, side-by-side AI editing | Plugin ecosystem (Obsidian's 5K+ plugins), open-source license (Logseq), larger user base |
| **Cloud-first AI chat tools** | ChatGPT, Claude.ai, Gemini, Perplexity | Files on disk (vs locked in cloud), workspace context (RAG), founder workflow templates, MCP server, Ollama for offline | Multimodal input, PDF chat, brand trust, mobile apps, established brands |
| **AI-first code/writing tools** | Cursor, Continue.dev, Codeium, Cline | Workspace + chat as files (vs code-only), founder templates, MCP server | Code-specific features, autonomous agents, IDE integration, larger funding |

**Keepance's competitive position:** the only tool that combines **(local-first + BYOK + 4 AI providers + MCP server + workflow templates + side-by-side AI editing + voice)**. No competitor has this exact stack. The combination is the moat.

**Keepance's competitive vulnerability:** the multimodal/PDF gap is the one thing where Keepance is below baseline. Casual users discovering Keepance will assume "any AI tool can read images" and be surprised when it can't. This is the single most fixable competitive vulnerability.

---

## 4. The gaps, prioritized by competitive impact

### 4.1 Multimodal AI input (image / PDF / file as chat context) — HIGH SEVERITY

#### What it is

The ability to send an image (screenshot, photo, chart, UI mockup, whiteboard photo) to the AI for visual analysis. The AI sees the image and responds based on what's in it. Examples: "What does this chart show?", "Critique this UI mockup", "Extract the table from this screenshot", "Translate this menu photo".

Closely related: file attachments more broadly — PDFs, .docx, .csv as direct chat context (handled in 4.2 below).

#### Who has it

| Competitor | Multimodal status |
|---|---|
| ChatGPT | Native, since GPT-4V (2023). Drag-drop images, paste from clipboard. |
| Claude.ai | Native since Claude 3 (early 2024). Native PDF support too. |
| Gemini | Native since Gemini 1.5. Image, video, audio. |
| Notion AI | Limited — embeds work but AI doesn't analyze image content. |
| Reflect | No native multimodal AI input. |
| Mem.ai | Image storage in notes, no AI analysis. |
| Obsidian (with plugins) | Some plugins offer it, inconsistent quality. |
| Cursor | Image input for code review (recent addition). |
| Logseq | No native multimodal. |

**Conclusion:** ChatGPT, Claude.ai, Gemini, Cursor all have it. Most local-first tools don't. Keepance being local-first BUT also AI-native means buyers will compare it more to ChatGPT/Claude than to Obsidian — and find the gap.

#### Why it matters for Keepance specifically

Indie founder workflows that need multimodal:

- **Pricing screenshots** ("here's what Notion AI charges, what should I do?") — pasted from competitor websites
- **Pitch deck visuals** ("review this slide for clarity") — single-slide screenshots
- **UI/UX feedback** ("how could this signup form be better?") — Figma exports, app screenshots
- **Whiteboard photos** ("digitize what we wrote in the standup") — phone photos
- **Chart analysis** ("what trend does this show?") — analytics dashboards
- **Receipt / contract photos** ("extract the line items") — phone photos
- **Logo mockups** ("which of these works better?") — branding feedback
- **Social media post drafts** ("does this look professional?") — graphic design

These are HIGH-frequency founder use cases. Founders WILL try multimodal in the first 24 hours of using Keepance. When it doesn't work, they'll either work around it (paste-and-describe) or churn.

#### How it would be implemented

The work is mostly provider-side message formatting. Each provider has a different but well-documented API for image content:

**Claude (Anthropic API):**
```typescript
{
  role: "user",
  content: [
    { type: "text", text: "What does this chart show?" },
    {
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: "<base64-encoded-bytes>"
      }
    }
  ]
}
```

**OpenAI (Chat Completions API):**
```typescript
{
  role: "user",
  content: [
    { type: "text", text: "What does this chart show?" },
    {
      type: "image_url",
      image_url: {
        url: "data:image/png;base64,<base64-encoded-bytes>"
      }
    }
  ]
}
```

**Gemini (generateContent API):**
```typescript
{
  parts: [
    { text: "What does this chart show?" },
    {
      inlineData: {
        mimeType: "image/png",
        data: "<base64-encoded-bytes>"
      }
    }
  ]
}
```

**Ollama:** Model-dependent. `llama3.2-vision`, `llava`, `qwen2.5-vl` support images via `images: [base64Data]` in the message.

#### Implementation plan (5 days)

**Day 1: Provider message formatting**
- Extend each `Provider` (Claude, OpenAI, Gemini, Ollama) to accept a `images?: ImageAttachment[]` field on `sendMessage` / `sendMessageStreaming`
- Convert images to provider-specific content blocks
- Add per-provider model capability detection (which models actually support vision):
  - Claude: 3.5 Sonnet, 3 Opus, 3 Haiku — yes; 3.5 Haiku — text only
  - OpenAI: gpt-4o, gpt-4o-mini, o1 — yes; older models — no
  - Gemini: 1.5 Flash, 1.5 Pro, 2.0 — yes
  - Ollama: detect via model name (llava / vision suffix) or model probe

**Day 2: Chat UI image upload**
- Add paperclip icon to chat input (next to send button)
- Click → file picker filtered to image MIME types
- Drag-drop image onto chat input → preview tile appears below input
- Paste image from clipboard → preview tile appears
- Inline preview tiles before send (with "remove" X)
- 20 MB per-image cap (matching Markdown editor cap), with toast on overflow

**Day 3: Save-to-workspace + audit trail**
- When image is sent in chat, also save to `<workspace>/media/YYYY-MM/chat-image-<hash>.<ext>` (matches existing image-paste pattern)
- Audit log entry: `image_attached` with file path, target chat, provider, model
- Image preview in chat history (not just current message)
- Re-send image from history possible (don't re-upload, reference existing path)

**Day 4: Provider capability + model picker UX**
- If user attaches an image and selected model is text-only, show inline warning: "Selected model doesn't support images. Switch to GPT-4o, Claude 3.5 Sonnet, Gemini, or a vision-enabled Ollama model?"
- Auto-suggest alternative model from same provider
- Block send until user resolves (don't silently strip the image)

**Day 5: Tests + polish**
- Unit tests per provider's image formatting (4 provider × 3-5 cases each)
- Integration test: paste image into chat → fires correct API call shape
- Cost-meter integration: image bytes count toward token usage (Claude: ~85 tokens for 512×512, per Anthropic docs)
- E2E test in Playwright: send image, get response, verify chat history persists with image

#### Trade-offs

- **Cost transparency:** images cost real tokens (Claude ~85 tokens per 512×512, OpenAI ~85-170 tokens per image, varies). Cost-meter (already shipped v1.5) handles this transparently.
- **Workspace storage:** every chat-attached image saves to `media/` (could grow large). Mitigation: configurable retention (auto-cleanup after N days), or "embed reference only" option.
- **Provider variance:** Ollama vision models are weaker than cloud. Be honest in UX ("Ollama vision models work but quality varies; for best results use Claude or GPT-4o").
- **Privacy:** image bytes go to AI provider. Audit log entry captures this. BYOK still applies (image goes direct from user → provider, never via Keepance server).

#### Recommended priority and timing

**SHIP IN v1.8 (30-45 days post-launch, May-June 2026).** This is the highest-priority post-launch product fix. Closes the single most fixable competitive vulnerability. Effort is bounded (~5 days). Demo quality is high (image input is visually obvious in screenshots).

---

### 4.2 PDF as chat context — HIGH SEVERITY

#### What it is

The ability to attach a PDF to a chat and have the AI read its contents. Examples: "Summarize this contract", "What are the key terms?", "Critique this pitch deck", "Extract the financials from this 10-K", "Compare these two research papers".

#### Who has it

| Competitor | PDF chat status |
|---|---|
| Claude.ai | Native PDF upload (Anthropic supports it as a `document` content block — sends PDF directly to model, model handles parsing) |
| ChatGPT | Native PDF + Word + Excel + CSV upload |
| Gemini | Native PDF (and many other file types) |
| Notion AI | Limited — works on Notion-imported PDFs |
| Mem.ai | Limited |
| Other local-first | Inconsistent or absent |

**Conclusion:** Same shape as multimodal — cloud AI tools all have it; local-first tools mostly don't. Same competitive vulnerability.

#### Why it matters for Keepance specifically

PDF is THE format for serious documents indie founders interact with:

- **Contract review** ("does this NDA have a non-compete clause?")
- **Investor deck feedback** ("what's missing from this deck?")
- **Vendor agreement parsing** ("what's the cancellation policy?")
- **Research paper synthesis** ("what's the methodology?")
- **Legal filing analysis** ("summarize the patent claims")
- **Marketing one-pager critique** ("how could this be clearer?")
- **Financial document analysis** ("walk me through this cap table")
- **Regulatory document review** ("what compliance steps does this require?")

**This is arguably more important than multimodal images** for the founder ICP specifically. Founders deal with PDFs constantly.

#### How it would be implemented

Two distinct paths, both viable:

**Path A: Native PDF API (Claude only, currently)**

Anthropic's API accepts PDFs as a content block (similar to images):

```typescript
{
  role: "user",
  content: [
    { type: "text", text: "Summarize this contract" },
    {
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: "<base64-encoded-pdf-bytes>"
      }
    }
  ]
}
```

Claude does the PDF parsing internally. Sees the actual page layout (figures, tables, forms). Best quality. Works only with Claude, not OpenAI/Gemini/Ollama.

**Path B: Local PDF text extraction → text-as-context (any provider)**

Use `pdfjs-dist` (PDF.js) to extract text client-side, then send as a regular text message:

```typescript
import { getDocument } from 'pdfjs-dist';
const pdf = await getDocument({ data: pdfBytes }).promise;
const text = [];
for (let i = 1; i <= pdf.numPages; i++) {
  const page = await pdf.getPage(i);
  const content = await page.getTextContent();
  text.push(content.items.map(item => item.str).join(' '));
}
const fullText = text.join('\n\n');
```

Then send `fullText` as part of the message context. Works for Claude, OpenAI, Gemini, Ollama uniformly. Loses figures and complex layouts (text-only).

**Path C: Hybrid (recommended)**

Detect provider:
- If Claude → use native API (Path A)
- If anything else → use text extraction (Path B)
- Show user which path was used: "Sent as native PDF (full quality)" or "Sent as extracted text (figures/tables omitted)"

#### Implementation plan (6 days)

**Day 1: PDF.js bundling + text extraction**
- Add `pdfjs-dist` as dependency (~500 KB minified, lazy-loaded)
- Set up worker script (PDF.js requires a separate worker file)
- Build `extractPdfText(pdfBytes): Promise<string[]>` returning array of page texts
- Test against ~10 real PDFs (contracts, decks, papers)

**Day 2: Native Claude PDF support**
- Extend `ClaudeProvider.sendMessage` to accept `pdfs?: PdfAttachment[]`
- Format as `{type: "document", source: {...}}` content blocks
- Test with real contracts / decks against Claude API
- Verify cost calculation (Claude charges ~3000 tokens per A4 page, varies)

**Day 3: Provider routing + UX**
- In chat handler, detect PDF attachment + check provider
- Claude → use native; Other → use text extraction (Path C hybrid)
- Show inline indicator: "📄 contract.pdf (12 pages, sent as native PDF)" or "📄 deck.pdf (8 pages, sent as extracted text — figures omitted)"
- For text-extraction path, show preview of first 200 chars of extracted text so user can verify nothing weird happened

**Day 4: Workspace integration**
- PDFs attached to chat save to workspace `media/` folder (matches image pattern)
- In file tree, PDF icon shows badge if it's been chat-referenced
- Click PDF → opens viewer; right-click → "Use as chat context"
- Audit log entry: `pdf_attached` with file path, page count, provider, extraction-mode

**Day 5: RAG indexing (bonus)**
- Extend the M1 RAG indexer to extract text from PDFs in the workspace
- PDFs become @workspace-queryable (currently only Markdown / text files are)
- This makes "what did we decide in the Q1 contract review?" work for PDF files
- Embedding still happens locally (no PDF text leaves device)

**Day 6: Tests + polish**
- Per-provider tests (mock APIs)
- Integration test: attach 12-page PDF → fires correct API shape
- Edge cases: encrypted PDF (refuse with message), 100+ page PDF (warn about cost), scanned-PDF / image-only PDF (Path B fails — fallback path?)
- Cost preview before send: "This 28-page PDF will cost ~$0.27 with Claude Sonnet"

#### Trade-offs

- **Native vs text-extraction:** Path A (native Claude) preserves figures/tables/forms; Path B (text extraction) is universal but loses non-text content. Hybrid handles this gracefully.
- **Scanned PDFs:** PDF.js can't extract text from image-only PDFs. Future enhancement: OCR via Tesseract.js (lazy-load only when needed).
- **Cost:** large PDFs are expensive. 50-page PDF in Claude = ~150K tokens = ~$0.45 in Sonnet pricing. Cost preview before send prevents bill shock.
- **RAG indexing of all workspace PDFs:** opt-in via Settings → Memory → Include PDFs in workspace index. Default off initially (CPU cost during indexing).

#### Recommended priority and timing

**SHIP IN v1.8 ALONGSIDE MULTIMODAL** (May-June 2026). Same launch window. Together they close the two HIGH-severity gaps and bring Keepance to functional input-modality parity with ChatGPT/Claude/Gemini.

---

### 4.3 Mobile / iPad / Android — MEDIUM-HIGH SEVERITY

#### What it is

A mobile companion app for reading + light editing Keepance workspaces from iOS / iPadOS / Android.

#### Who has it

| Competitor | Mobile status |
|---|---|
| Notion | Full-featured iOS + Android apps (read + write + AI) |
| Obsidian | Native iOS + Android apps (paid, requires sync) |
| Bear | Native iOS + iPadOS + Mac (cult favorite) |
| Things | iOS + iPadOS + Mac |
| Reflect | iOS + Android web wrapper |
| Mem.ai | iOS + Android |
| Tana | iOS app |
| Logseq | Mobile app (limited) |
| Cursor | Desktop only (similar position to Keepance) |
| Continue.dev | Desktop only |
| Heptabase | Desktop only |

**Conclusion:** Mixed bag. The cloud-first competitors all have mobile (it's free with their cloud architecture). Local-first tools struggle (sync is the prerequisite). Desktop-only AI workspaces (Cursor, Continue, Heptabase, Keepance) are actually a coherent category — but Notion and Obsidian set the expectation that "AI workspace" includes mobile.

#### Why it matters for Keepance specifically

Founder workflows that need mobile:

- **Reading on the go** (commute, lunch, between meetings) — passive consumption of own notes
- **Capturing ideas immediately** ("just remembered something" → quick note)
- **Replying to investor / customer emails referenced in workspace** ("what did I decide about pricing?" → look up notes)
- **Reviewing during travel** (airplane, train, Uber)
- **Voice-recording on phone, processing on desktop** (voice input on phone is more natural than desktop)
- **Sharing workspace content with co-founder via Messages** (often happens on phone)

Note: many of these are PASSIVE READ workflows, not active editing. Mobile READ-ONLY would solve 70-80% of demand. Full mobile (editing + AI) is more complex.

#### How it would be implemented (4 viable paths)

**Path A: Full mobile app via Tauri 2 mobile (or Capacitor / React Native)**

Tauri 2 has experimental mobile support. Could build a native mobile app sharing UI with desktop. But:
- Tauri 2 mobile is not production-ready as of mid-2026
- React Native or Capacitor would require significant codebase fork
- Filesystem access on mobile is sandboxed (very different from desktop)
- AI provider keys would need to be re-entered on each device (or synced — back to the cloud problem)

**Estimated effort:** 6-12 months full-time. Not viable for a 5-10 hr/week side project.

**Path B: Cloud-synced mobile (compromises local-first)**

Add optional cloud sync (S3-compatible, end-to-end encrypted). Build mobile app that pulls from cloud.

- Pro: clean architecture
- Con: introduces a Keepance-managed sync service (operational burden + violates "no Keepance server in the path")
- Con: cloud sync is anti-pattern #1 in `strategy/07-anti-patterns.md`

**Recommendation:** Skip. Compromises the differentiator.

**Path C: Local-network sync (no cloud)**

Mobile + desktop sync over local Wi-Fi via Bonjour/mDNS. Files only on user's devices.

- Pro: respects local-first
- Pro: no cloud infrastructure
- Con: requires both devices on same network at sync time
- Con: building local-network sync is its own meaningful product (~3-6 months)
- Con: doesn't help when away from home network

**Estimated effort:** 3-6 months.

**Path D: iCloud Drive / Dropbox / Google Drive sync (user-managed)**

User puts workspace folder in iCloud Drive (or Dropbox / Google Drive). Mobile app reads from the cloud-synced folder.

iOS Files app already lets users browse markdown in iCloud Drive. So:

**Path D1 (zero engineering):** Document the workflow. "Put your workspace in iCloud Drive on desktop. Read it from iOS Files on your phone." Users get read-only mobile access without us building anything.

**Path D2 (one mobile app):** Build a thin mobile reader app using Tauri 2 mobile experimental. App reads from a chosen cloud-folder location. Read-only initially, no AI features. Just markdown rendering + wiki-link navigation + search.

#### Implementation plan (Path D2, recommended)

**4-week sprint for a Tauri 2 mobile reader app:**

**Week 1: Project bootstrap**
- Set up Tauri 2 mobile build (iOS first, Android second)
- Figure out filesystem permissions on iOS (Files app access via UIDocumentPickerViewController)
- Get a "hello world" iOS app on TestFlight

**Week 2: Markdown rendering**
- Reuse CodeMirror 6 or use a simpler mobile-optimized renderer
- Markdown rendering with syntax highlighting
- Wiki-link click → navigate to linked file
- Basic UI: file list (sidebar), file view (main), search

**Week 3: Workspace navigation**
- Folder tree navigation
- Search across workspace (reuse MiniSearch index from desktop)
- Recent files
- Star/bookmark for offline-cached files

**Week 4: Polish + ship**
- iOS App Store submission (initial review can take 1-2 weeks)
- Free download (no in-app purchase initially — just a companion to Keepance desktop)
- TestFlight beta first

**Estimated total effort:** 4 weeks for read-only iOS app. Android later (similar pattern).

#### Trade-offs

- **Read-only first:** simpler scope, faster to ship, addresses 70-80% of mobile use cases
- **No AI on mobile:** keys are on desktop; mobile is just a reader. Honest framing.
- **Tauri 2 mobile risk:** still experimental. Capacitor or React Native are more mature alternatives if Tauri mobile doesn't work
- **iCloud Drive friction:** non-Mac users can't use iCloud. Dropbox is more universal

#### Recommended priority and timing

**Path D1 (document iCloud Drive workflow): SHIP NOW (~1 hour to add to docs).** Free, immediate, addresses 30% of mobile demand.

**Path D2 (mobile reader app): Q3-Q4 2026, gated on M2 ($1K+ MRR sustained 30 days).** Don't invest 4 weeks of engineering until paid buyers signal demand. Track "mobile" mentions in support email and PH/HN comments as the demand signal.

**Honest framing for buyers:** "Desktop is the v1 product. Mobile is a year-2 focus. iCloud Drive workaround works today (link to docs). Full mobile app comes when buyer demand justifies the investment."

---

### 4.4 Web version (browser-based) — MEDIUM SEVERITY

#### What it is

A version of Keepance that runs in a web browser without requiring desktop install. Could be: (a) a try-it sandbox demo, (b) a full production browser app.

#### Who has it

| Competitor | Web status |
|---|---|
| Notion | Web-first (mobile + desktop apps wrap the web app) |
| Reflect | Web-first |
| Mem.ai | Web-first |
| Tana | Web-first |
| ChatGPT | Web-primary |
| Claude.ai | Web-primary |
| Gemini | Web-primary |
| Obsidian | Desktop only (no web) |
| Logseq | Web version exists but limited |
| Cursor | Desktop only |
| Bear | Desktop + iOS only |

**Conclusion:** Cloud-first competitors all have web; local-first competitors mostly don't. Same pattern as mobile — Keepance is in the local-first camp.

#### Why it matters for Keepance specifically

The friction tax: someone discovering Keepance on Product Hunt at 2 AM wants to TRY it without committing to a 50 MB desktop install + restart. Lowers conversion at the demo step.

Specific use cases:
- **Try-before-you-install** (most important)
- **Access from a work computer** (no install permissions)
- **Quick lookups** (don't want to launch a heavy desktop app for one note)
- **Sharing** (send a workspace URL to a co-founder for review)

#### How it would be implemented

Keepance already has `WebFSBackend.ts` for browser File System Access API. The architecture supports browser. But:

- Browser FS API only works in Chromium-based browsers (Chrome, Edge, Brave) — not Safari or Firefox
- Browser permission prompts are intrusive ("Allow Keepance to access this folder?")
- Tauri-specific features (OS keychain, voice sidecar, MCP server, RAG via Rust) don't work in browser
- Performance differs (no native filesystem, slower IO)

Two paths:

**Path A: Polished production browser version**
- Promote `WebFSBackend` from "dev fallback" to "first-class shipping target"
- Build separate "Keepance Web" landing experience
- Document Chrome-only requirement
- Disable features that don't work in browser (RAG, voice, MCP server) with clear UX
- API keys stored in browser localStorage (less secure than OS keychain)

**Estimated effort:** 2-3 weeks to polish to production quality.

**Path B: Demo-only browser version**
- "Try Keepance in your browser" mode = sandbox demo
- Pre-loaded sample workspace (15 founder template examples + a few demo files)
- Sandboxed: no real save (or save to localStorage only, ephemeral)
- AI chat works (BYOK or shared-demo-key with rate limit)
- Click "Download for full version" CTA after 5 messages or 10 minutes

**Estimated effort:** 1 week.

#### Trade-offs

**Path A risks:**
- Splits product surface area (every feature now needs browser-compat consideration)
- Two codepaths = bug surface area
- Mediocre browser experience hurts brand vs polished desktop
- Browser users might not convert to desktop (cannibalizes paid)

**Path B risks:**
- Sandbox demo can feel hollow (real workspaces are the magic)
- "Demo doesn't reflect real product" complaints
- Adding fake-but-realistic content takes design effort

#### Recommended priority and timing

**Path B (demo-only): Year 2.** Lowest priority of all gaps. Most users will install rather than try in browser. The 30-day free trial via download already covers the "try before you buy" use case.

**Path A (full browser): Don't ship in year 1 or year 2.** Splits surface area without strong demand signal. Re-evaluate at year 3 if a clear majority of buyers ask.

**Honest framing for buyers:** "Keepance is a desktop product. The 30-day free trial is no-card-required and gives you the full app. If install isn't viable for you (work computer, etc.), the desktop app runs from a USB drive on Windows; Mac requires copying to /Applications. Web version is intentional non-goal because the local-first features (your data on disk, OS keychain for keys, local RAG) require desktop architecture."

---

### 4.5 Long context > 200K tokens — MEDIUM SEVERITY

#### What it is

The ability to send very large amounts of text (workspace dumps, multiple long documents, full codebases) as chat context. Current cap in Keepance: 200K tokens (configurable in Settings → AI → Context Token Limit).

#### Who has it

| Competitor | Max context |
|---|---|
| Claude (Anthropic API) | 200K standard, 1M experimental (Tier 2+) |
| Gemini (Google API) | 1M standard, 2M experimental |
| OpenAI (gpt-4-turbo) | 128K |
| OpenAI (gpt-4o) | 128K |
| OpenAI (o1) | 200K |
| Ollama (local) | Model-dependent, typically 8K-128K |

**Conclusion:** Anthropic and Google have shipped 1M-token windows; OpenAI is rumored to follow. Within 6-12 months, 1M context will be the new standard for top-tier models.

#### Why it matters for Keepance specifically

Founders with rich workspaces (50+ markdown files, multi-thousand-word strategy docs, contract libraries) want the AI to consider EVERYTHING simultaneously. Current 200K cap means workspace-wide queries get truncated.

Specific use cases:
- **"Review my entire 18-month workspace and tell me what themes emerge"**
- **"Compare all my customer interview transcripts at once"**
- **"Find every contradiction across my pitch deck, vision doc, and pricing page"**
- **"Summarize 6 months of strategy decisions"**

Note: the RAG system (M1) already handles the "big workspace" use case via chunked retrieval. But power users want to opt out of retrieval and just shove everything in.

#### How it would be implemented

This is mostly a config + provider-validation change:

**Day 1: Provider tier detection**
- For Claude, detect if the API key has Tier 2+ access (which unlocks 1M context)
- For Gemini, detect if the model supports 1M (1.5 Pro does)
- Show capability in model picker: "Claude Sonnet (200K)" vs "Claude Sonnet 1M (Tier 2+)"

**Day 2: UI — lift the cap**
- Settings → AI → Context Token Limit: change max from 200K to 1M
- Show warning if user sets >200K but selected model doesn't support it: "Selected model maxes at 200K. Switch to Gemini 1.5 Pro or Claude Sonnet 1M to use this limit."
- Show estimated cost as user approaches high limits ("~$2.50 per query at 800K tokens with Claude Sonnet")

**Day 3: Context window UX**
- Visualization of current context utilization in chat panel: "127K of 200K used"
- Auto-detect when approaching limit and warn before send
- Option to compress with summarization if over limit (use a fast model to summarize older context)

**Estimated effort:** 3-4 days.

#### Trade-offs

- **Cost:** 1M-token queries are EXPENSIVE. ~$3-15 per query depending on provider. Need cost-warning UX.
- **Latency:** 1M-token queries take 30-60 seconds vs 2-5 seconds for normal queries. Need progress indication.
- **Provider availability:** 1M is experimental on most platforms. Set the UI as forward-looking; it'll just work as providers stabilize.

#### Recommended priority and timing

**SHIP IN v1.9 (mid-2026, when Anthropic stabilizes 1M API for Tier 1+ users).** Low engineering effort, useful for power users, no rush since RAG already handles the use case for 95% of queries.

---

### 4.6 Voice OUTPUT (text-to-speech for AI responses) — LOW-MEDIUM SEVERITY

#### What it is

The AI's responses are spoken back as audio. Useful for: hands-free workflows (driving, cooking, walking), accessibility, casual passive consumption.

#### Who has it

| Competitor | TTS status |
|---|---|
| ChatGPT | Native, multiple voices |
| Claude.ai | Limited (web-only experimental) |
| Gemini | Native |
| Most other AI workspaces | No |

#### Why it matters for Keepance specifically

Lower priority than INPUT voice (which Keepance already has, v1.5). Most users prefer reading AI responses (faster, scannable). TTS is a nice-to-have, not a competitive necessity.

#### How it would be implemented

Two paths:

**Path A: Cloud TTS (OpenAI tts-1 / Google Cloud TTS / ElevenLabs)**
- Add a "Read aloud" button to AI responses
- Send response text to TTS API, get audio back, play in browser
- Pro: high quality
- Con: requires another API key, not local-first

**Path B: Local TTS (system TTS / Coqui TTS / Piper)**
- Use OS-provided TTS (Mac `say` command, Windows SAPI, Linux espeak)
- Or bundle a local TTS engine (Coqui, Piper)
- Pro: local-first, no extra API key
- Con: lower quality than cloud TTS

**Recommended:** Path B (Piper). Modern local TTS quality is acceptable. Aligns with local-first.

#### Implementation effort

3-4 days. Bundle Piper as a sidecar (similar to Parakeet for voice input). Add "Read aloud" button.

#### Recommended priority and timing

**Year 2.** Low priority. Re-evaluate if accessibility becomes a buyer ask.

---

### 4.7 Plugin system / extensions marketplace — LOW SEVERITY (deliberate)

#### What it is

Third-party extensions that users can install to add custom features, similar to Obsidian's 5,000+ plugin ecosystem.

#### Who has it

Obsidian (5,000+ plugins) is the canonical example. VS Code has its massive marketplace. Raycast has extensions.

#### Why it matters

For some users, the plugin ecosystem IS the product. Obsidian users often have 12+ plugins installed.

#### Why we don't (deliberate)

Per `strategy/00-master-strategy.md` and `strategy/07-anti-patterns.md`:

> Obsidian's plugin model is amazing for power users; it also creates the version-fragmentation problem where "install these 12 plugins to get my setup" becomes the on-ramp. Keepance ships workflow templates + AI integration + RAG + memory + MCP in the box, no plugin assembly required. Different bet.

Building a plugin marketplace would:
- Take 3-6 months of engineering
- Create a security review burden
- Require ongoing maintenance of plugin API stability
- Compete with the "out-of-the-box completeness" pillar

#### How it would be implemented (if we changed our mind)

1. Define plugin API surface: filesystem access, UI hooks (sidebar panels, toolbar buttons, settings), AI tool registration, command palette entries
2. Build sandboxed plugin runner (web worker isolation)
3. Build plugin marketplace UI (search, install, update, manage)
4. Build plugin developer docs + scaffolding
5. Build review/approval process (manual for v1, automated for v2)

**Estimated effort:** 3-6 months minimum.

#### Recommended priority and timing

**Don't build in year 1 or year 2.** Re-evaluate at year 3 if buyer demand surfaces. Strong default: stay in our lane (workflows + AI + memory + MCP, in the box).

---

### 4.8 Internationalization / i18n — LOW SEVERITY

#### What it is

UI translated into multiple languages. Currently English only.

#### Who has it

Notion, Obsidian, ChatGPT, Claude, Gemini all support major languages.

#### Why it matters

The indie founder ICP is heavily English-speaking (US, UK, AU, Canada, EU English speakers, India English speakers). i18n would expand TAM but with high engineering cost.

#### How it would be implemented

1. Extract all UI strings into a translation framework (react-i18next or similar)
2. Translate to top 5 languages (Spanish, French, German, Portuguese, Japanese)
3. Set up community translation workflow
4. Detect user locale, default to matched language
5. Add language picker in Settings

**Estimated effort:** 1-2 months for initial 5 languages, ongoing maintenance.

#### Recommended priority and timing

**Year 2 at earliest.** English ICP first. Re-evaluate when buyer demand from non-English markets becomes >10% of total signups.

---

### 4.9 Templates marketplace / community sharing — LOW-MEDIUM SEVERITY

#### What it is

Users can share custom workflow templates with the community, browse/install templates from others. Currently 15 founder templates baked in; users can fork/remix locally (v1.5) but can't share.

#### Who has it

Notion has a robust template marketplace. Obsidian has community vaults.

#### Why it matters

- Power users want to share (network effect)
- Niche use cases get covered by community (e.g., "Keepance for therapists" templates without us building it)
- Marketing: every shared template is a backlink + discovery moment

#### How it would be implemented

**Path A: Centralized marketplace (web)**
- Build a `templates.keepance.com` site
- Users submit templates via web form
- Curation queue (manual approval for v1)
- Install button: "Add to my Keepance" → deep-links into desktop app

**Path B: GitHub-based marketplace**
- Templates live in a public GitHub repo (`keepance/community-templates`)
- Users PR templates
- Keepance desktop app fetches list from GitHub on startup
- Lower engineering cost; community-managed

**Recommended:** Path B (GitHub-based). Simpler, community-driven, no curation burden.

**Estimated effort:** 2-3 weeks for Path B, including the desktop UI for "Browse community templates → Install".

#### Recommended priority and timing

**Year 2.** Wait for buyer-driven demand signal. The 15 baked-in templates cover most founder needs.

---

### 4.10 Cloud sync built-in — DELIBERATE NON-GOAL

Per `strategy/07-anti-patterns.md` § 1: "Adding cloud sync because buyers ask."

> The buyers who ask for sync are a small minority; the buyers who came specifically because there's no cloud are the larger group, and they will leave if we add cloud.

**Workaround documented:** "Put your workspace folder in Dropbox / iCloud Drive / Syncthing. Keepance works the same way against any synced folder."

Don't build. Decision is final unless full strategy retrospective.

---

### 4.11 Real-time collaboration — DELIBERATE NON-GOAL

Real-time multi-user editing (Google Docs / Notion / Reflect style).

Per FEATURES.md § "Not yet supported":

> Real-time collaboration. Out of scope. Local-first means single-user. If you want collab, use Notion. If you want your data on YOUR machine, use Keepance.

Don't build. Different product entirely.

---

### 4.12 Agentic / autonomous AI workflows — DELIBERATE NON-GOAL

Multi-step autonomous AI (Cursor's Composer, Claude Code, Devin, Cline). AI does multiple things in sequence without per-step approval.

Per Keepance's pillar in `CLAUDE.md`: **"AI proposes, user decides; destructive ops need confirmation."**

Don't build. Autonomous AI is a different product category. Keepance's bet is "every AI action is approved by you."

If a buyer asks: "Keepance is an editor, not an agent. If you want autonomous multi-step AI, use Cursor (for code) or Claude Code (for code) or ChatGPT Operator (for browsing). Keepance is for the workspace where you want every change reviewed before it lands."

---

## 5. Where the AI market is heading (forward-looking, 12-24 months)

Trends Keepance should anticipate:

### 5.1 Multimodal as default (2026)

Every AI tool will assume image+text input by end of 2026. Voice input is becoming standard too. Keepance must ship multimodal in v1.8 to stay current.

### 5.2 Long context everywhere (2026-2027)

1M+ tokens become standard. By Q4 2026, all major models will support it. Keepance's RAG advantage erodes if competitors can just shove the whole workspace into context. Counter: RAG is still cheaper + faster + more privacy-preserving (no data leaves the model boundary).

### 5.3 Agentic AI surge (2026-2027)

Cursor, Claude Code, Devin, Cline are moving toward "AI does everything autonomously." Keepance's "AI proposes, user decides" position becomes a deliberate counter-positioning. Frame as: "If you want fast and don't care about review, use an agent. If you want every change reviewed, use Keepance."

### 5.4 Local model explosion (2026-2027)

Llama 4, Qwen 3, and others continue to close the gap with cloud models. Ollama support becomes more important. Keepance's "Ollama as 4th provider" lead matters more.

### 5.5 MCP ecosystem expansion (2026)

Model Context Protocol is emerging as the standard for AI tool interop. More servers (Linear, GitHub, Stripe, Notion already exist; more coming). Keepance's "we serve MCP, not just consume it" position is unique. Push this advantage.

### 5.6 Voice-first interfaces (2026-2027)

OpenAI's voice mode, Apple Intelligence voice, Google's voice — voice as input becomes more common. Keepance's local voice input (v1.5) is well-positioned.

### 5.7 AI memory standards (2026)

Claude Memory, ChatGPT Memory, OpenAI's persistent context — every provider is shipping their own memory layer. Keepance's local memory (v1.5) is the privacy-preserving alternative. As cloud memory becomes ubiquitous, "your memory on your machine" becomes a sharper distinction.

### 5.8 Privacy regulation pressure (2026-2027)

EU AI Act enforcement begins 2026. US state laws follow. "Local-first" becomes regulatory advantage, not just philosophy. Keepance is well-positioned.

### 5.9 Apple Intelligence / Microsoft Copilot encroachment (2026-2027)

OS-level AI is getting more capable. Threat: "I just use Apple Intelligence, why install Keepance?" Counter: Keepance is platform-agnostic (Mac/Win/Linux), works with multiple AI providers (not just one OS-bundled model), stores files in your folder (not buried in OS state).

### 5.10 Apple intelligence + ChatGPT integration (2025+)

Apple Intelligence calls ChatGPT for hard queries. Sets expectation that "AI is just there, baked into the OS." Counter-position: Keepance is what you use when you want to KEEP your AI conversations as files you own, not have them disappear into the OS.

---

## 6. Recommended product roadmap by quarter

### v1.8 (May-June 2026, ~30-45 days post-launch)

**Theme: Close the multimodal gap.**

- ✅ Multimodal AI input (images in chat) — all 4 providers (§ 4.1)
- ✅ PDF as chat context — Claude native + text-extraction fallback (§ 4.2)
- ✅ PDF added to RAG indexing pipeline (bonus)

**Engineering effort:** ~10-12 days
**Strategic impact:** closes both HIGH-severity gaps; achieves input-modality parity with ChatGPT/Claude/Gemini.

### v1.9 (June-August 2026)

**Theme: Polish + power user features.**

- Voice OUTPUT (TTS) for AI responses via Piper sidecar (§ 4.6)
- Long context cap lifted to 1M when Anthropic stabilizes (§ 4.5)
- Mobile companion (iOS read-only, via iCloud Drive workaround documented; Tauri 2 mobile reader if buyer demand) (§ 4.3 Path D2)

**Engineering effort:** ~3-5 weeks
**Strategic impact:** addresses the "where's mobile" question without committing to year-long mobile roadmap.

### v2.0 (Q3-Q4 2026)

**Theme: Ecosystem + community.**

- Templates marketplace via GitHub-based community repo (§ 4.9)
- Notion → Keepance one-click importer
- Obsidian → Keepance one-click importer
- Web demo experience (sandbox try-it) (§ 4.4 Path B)
- First v1.x retrospective + 6-month roadmap update

**Engineering effort:** ~6-8 weeks
**Strategic impact:** opens distribution channels (importers reduce switching cost, community templates create network effect).

### v2.1+ (Year 2)

**Theme: Expand surface area as buyer demand justifies.**

- Full mobile (read + write, iOS + Android) — IF M3 ($5K MRR) and demand is loud
- i18n (top 5 languages) — IF non-English signups exceed 10%
- Plugin system (sandboxed extensions API) — IF buyer demand is sustained
- Web app (production browser version) — IF mobile pressure converges with web demand

**Engineering effort:** months per item
**Strategic impact:** these are M3+ decisions with real engineering weight. Don't pre-commit; let buyer signals drive prioritization.

### NEVER (deliberate non-goals — re-examine only on full strategy retrospective)

- Real-time collaboration (anti-pattern)
- Cloud sync (built-in) (anti-pattern)
- Agentic / autonomous multi-step AI (anti-pattern)
- Mass-market subscription tier (anti-pattern)
- Verticalization ("Keepance for therapists / writers") (anti-pattern)

---

## 7. Decision points requiring board input

These need Jameson's call before engineering proceeds. Listed in suggested decision order.

### 7.1 Confirm v1.8 scope (multimodal + PDF chat) for the post-launch window

**Recommendation:** Yes. These are the two HIGH-severity gaps. Closing them in 30-45 days post-launch puts Keepance at functional parity with the cloud AI tools on input modality. Both fits in a single ~10-day engineering sprint.

**What you're agreeing to:** ~10 days of engineering time post-launch (in the Phase 4-5 window per strategy doc 02).

**Decision deadline:** Day 7 post-launch (so engineering can start in Phase 4 / week 2).

### 7.2 Mobile path: Document iCloud Drive workaround now (Path D1) vs build mobile reader app (Path D2) at M2

**Recommendation:** Path D1 immediately (~1 hour to add to docs); plan Path D2 for Q3-Q4 2026 contingent on buyer demand signal.

**What you're agreeing to:** "Mobile is a year-2 focus, here's the workaround for now" framing.

**Decision deadline:** Pre-launch (so the FAQ + docs surface the workaround on launch day).

### 7.3 Long context: ship at 1M when Anthropic Tier 1+ supports it, or wait?

**Recommendation:** Ship when Anthropic Tier 1 stabilizes (~mid-2026). Low engineering effort, useful for power users.

**Decision deadline:** Trigger when Anthropic announces 1M for Tier 1+ users.

### 7.4 Plugin system: revisit at year 2, or commit now?

**Recommendation:** Don't commit. Re-evaluate at year 2.

**What you're agreeing to:** Stay in the "in-the-box" lane vs Obsidian's "infinite-extensibility" lane.

**Decision deadline:** No urgency. Anti-pattern as default.

### 7.5 Web version: build a sandbox demo, full browser app, or neither?

**Recommendation:** Neither in year 1. Sandbox demo (Path B) at year 2 if friction-on-demo becomes a clear signal in conversion data.

**Decision deadline:** No urgency. Re-evaluate at month 6 when there's conversion data.

---

## 8. References

- `~/keepance/CHANGELOG.md` — actual shipped state (source of truth)
- `~/keepance/docs/reference/FEATURES.md` — canonical "what does Keepance do" reference (rewritten 2026-04-29 to v1.7.2 state)
- `~/keepance/docs/reference/COMPETITIVE_LANDSCAPE.md` — per-competitor analysis
- `~/keepance/docs/marketing/strategy/11-pre-launch-gap-analysis.md` — companion launch-focused gap analysis
- `~/keepance/docs/marketing/strategy/00-master-strategy.md` — strategic spine
- `~/keepance/docs/marketing/strategy/07-anti-patterns.md` — 22 deliberate non-goals
- `~/keepance/docs/marketing/strategy/08-market-sizing-and-growth-paths.md` — TAM analysis + wide-market scenario
- `~/keepance/docs/strategy/market-assessment-2026-04/` — 40K-word market assessment from April 2026 (9 docs)
- `~/keepance/website/changelog/index.html` — public-facing changelog
- `~/keepance/website/roadmap/index.html` — public-facing roadmap (this doc informs what shows up there)
- Anthropic docs (multimodal, PDF, 1M context API)
- OpenAI docs (vision API, file uploads)
- Google Gemini docs (multimodal, 1M context)
- Tauri 2 mobile experimental docs
- Model Context Protocol specification
