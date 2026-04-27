---
name: Marketing Asset Capture System
description: Reproducible Playwright pipeline that produces a full library of macOS-styled product screenshots and videos for Projelli
type: design-spec
status: shipped (v1 + video expansion)
date: 2026-04-27
---

> **NOTE for the next reader:** this is the original design spec, captured before implementation began. The actual library that shipped includes 7 additional videos (V02-V08) on top of the 10 stills + V01 documented here. **For the current state of what exists and how to operate it, read `RUNBOOK.md` in this folder first.** This SPEC.md remains as the historical design record.

# Marketing Asset Capture System — Design Spec

## Goal

Produce a full library of marketing assets (screenshots + videos) that look like Projelli is being used on macOS, generated reproducibly from the React dev server, with a single command.

The library covers:

- The 6 press-kit slots already defined in `docs/marketing/action-packs/JAMESON_ACTION_PACK.md` (Item D)
- The 30-second demo video defined in the same action pack (Item E)
- Launch-channel assets: OG cards, LinkedIn cards, square crops, document-suite shot, "local-first" diagram

Tier 3 (Product Hunt gallery reframes) and Tier 4 (short social video clips) are explicitly **out of scope for v1** of this system. They will be added in a second pass once Tier 1 + 2 ship and the pipeline is proven.

## Why this approach

Projelli's UI is a React + Tailwind app served by Vite. Every supported platform (macOS native WebKit, Windows WebView2, Linux webkit2gtk) renders the same React tree. Capturing that React tree directly in **headless Chromium via Playwright**, then compositing macOS chrome around it in post, gives:

- The highest-fidelity rendering (Chromium ≥ webkit2gtk for text, GPU compositing, transitions)
- Pixel-perfect reproducibility (seeded state + canned AI replay = identical output every run)
- Full library produced in one command, on this Linux server, no developer hands required for re-shoots

Running the actual Tauri Linux build under Xvfb was rejected: it produces a worse base image (webkit2gtk rendering), captures Linux-only UI artifacts (scrollbars, focus rings, fonts) that we'd then need to scrub anyway, and gives us nothing the Playwright path doesn't.

## Scope — what gets produced

### Tier 1 — Press kit + demo video (in scope, v1)

| ID | File | Resolution | Description |
|----|------|-----------:|-------------|
| S01 | `screenshot-01-workspace.png` | 2560×1600 @2x | 3-pane hero: file tree, editor open on `Launch Plan.md`, AI chat sidebar idle. Press-kit cover + homepage hero. |
| S02 | `screenshot-02-ai-chat.png` | 2560×1600 @2x | AI mid-stream, partial response visible in chat panel, file `Brand Voice.md` newly appearing in tree (highlighted). |
| S03 | `screenshot-03-wikilinks.png` | 2560×1600 @2x | Editor on `Vision.md` with three `[[wiki-links]]` highlighted, backlinks panel open at bottom showing inbound links. |
| S04 | `screenshot-04-templates.png` | 2560×1600 @2x | Templates gallery view, "Customer Discovery Interview" template active mid-flow at "Question 4 of 10". |
| S05 | `screenshot-05-multi-model.png` | 2560×1600 @2x | Multi-model side-by-side view, same prompt, Claude on left + GPT on right, both responses fully rendered. |
| S06 | `screenshot-06-api-keys.png` | 2560×1600 @2x | Settings → API Keys, three providers listed, Anthropic key shown as `sk-ant-•••••••••3xQ`. |
| V01 | `demo-30s.mp4` | 1920×1080, H.264, 30fps | 30-second deterministic demo: type prompt → AI streams response → file appears in tree → editor switches to new file. No audio. |

### Tier 2 — Launch channels (in scope, v1)

| ID | File | Resolution | Description |
|----|------|-----------:|-------------|
| S07 | `og-twitter-card.png` | 1200×675 | Workspace shot reframed with overlaid tagline "Obsidian for the AI era." |
| S08 | `og-linkedin-card.png` | 1200×627 | Same content as S07, reframed for LinkedIn aspect. |
| S09 | `social-square.png` | 1080×1080 | Workspace shot reframed for IG / LinkedIn carousel cover. |
| S10 | `feature-document-suite.png` | 2560×1600 @2x | Document suite tabs visible (xlsx/docx/pptx). Highlights v1.0.8 differentiator. |
| S11 | `feature-local-first.png` | 2560×1600 @2x | Workspace + native macOS Finder window overlay showing the same files on disk. Reinforces "your data stays here." |

### Out of scope (deferred to v2)

- **S05 Multi-model side-by-side** — deferred 2026-04-27. Confirmed absent: `grep -rE "MultiModel|multiModel|side-by-side" src/components/ src/stores/` returns no matches. The product does not yet have a multi-model comparison UI. When shipped, the shot can be captured via `shots/05-multi-model.ts` against the new store/component.
- **5-frame carousel story** (originally proposed as Tier 2 item but cut from v1 — high scripting cost, marginal lift over the static OG cards)
- Tier 3: Product Hunt gallery (1240×760 reframes of S01–S06)
- Tier 4: Short social videos (V02–V05, 9:16 + 1:1 derivatives, 60-second master walkthrough)
- Press-kit `index.html` updates (the page already references the file paths above; nothing to change)
- LemonSqueezy listing assets (LemonSqueezy spec not yet finalized)

## Architecture

```
~/projelli/scripts/marketing-capture/
├── fixtures/
│   ├── linterly-workspace.ts     # seed state object
│   └── ai-replays/
│       ├── launch-plan-stream.json
│       └── multi-model-claude.json
│       └── multi-model-gpt.json
├── lib/
│   ├── inject-mac-styles.ts      # CSS overlay (fonts, scrollbars, accents)
│   ├── seed-state.ts             # applies fixture into localStorage / Zustand
│   ├── mock-ai.ts                # Playwright route handler for AI APIs
│   └── compose-chrome.ts         # wraps PNG in macOS Sequoia frame
├── shots/
│   ├── 01-workspace-hero.ts
│   ├── 02-ai-chat.ts
│   ├── 03-wikilinks.ts
│   ├── 04-templates.ts
│   ├── 05-multi-model.ts
│   ├── 06-api-keys.ts
│   ├── 07-og-twitter.ts
│   ├── 08-og-linkedin.ts
│   ├── 09-social-square.ts
│   ├── 10-document-suite.ts
│   └── 11-local-first.ts
├── videos/
│   └── 01-demo-30s.ts
├── chrome-template/
│   └── sequoia-window.html       # rendered to PNG once, reused
└── run-all.ts                    # orchestrator
```

Each unit is independently testable and replaceable. The fixture builder is a pure function. The CSS injector returns a string. The chrome compositor takes a PNG buffer and returns a PNG buffer. The shot scripts are thin orchestration on top.

### Data flow per shot

```
fixture (TS) ──► seed-state (page.evaluate) ──► page state populated
                                                       │
                                                       ▼
inject-mac-styles (page.addStyleTag) ──► page restyled to look macOS
                                                       │
                                                       ▼
mock-ai (page.route) ──► AI endpoints serve canned chunks
                                                       │
                                                       ▼
shot script navigates / interacts / waits ──► page in target state
                                                       │
                                                       ▼
page.screenshot({ fullPage: false, clip: viewport }) ──► raw PNG
                                                       │
                                                       ▼
compose-chrome wraps in macOS frame ──► final PNG
                                                       │
                                                       ▼
write to ~/projelli/Assets/marketing/ + press-kit/assets/
```

### Output destinations

- **Press-kit slots (S01–S06)** → `~/projelli/website/press-kit/assets/` (matches existing slot filenames)
- **All Tier 1 + Tier 2 originals** → `~/projelli/Assets/marketing/`
- **Demo video V01** → both `~/projelli/Assets/marketing/demo-30s.mp4` and `~/projelli/website/press-kit/assets/demo-30s.mp4`
- All output paths gitignored if too large; otherwise committed. Decided per-asset at implementation time (PNGs commit, MP4 likely external).

## The Mac-styling layer (detailed)

### 1. Fonts

Install Apple's free SF Pro family on this server:

- Source: `https://developer.apple.com/fonts/` (publicly downloadable, license permits use in product screenshots and mockups)
- Files: `SF-Pro.dmg` → extract OTFs → `/usr/share/fonts/opentype/sf-pro/`
- Mono: `SF-Mono.dmg` → `/usr/share/fonts/opentype/sf-mono/`
- Run `fc-cache -fv` after install. Verify with `fc-list | grep -i "SF Pro"`.

CSS injection forces the stack everywhere:

```css
* {
  font-family: -apple-system, "SF Pro Text", "SF Pro Display", "Inter", system-ui, sans-serif !important;
}
code, pre, .font-mono {
  font-family: "SF Mono", ui-monospace, "Menlo", monospace !important;
}
```

### 2. Scrollbars

Replace Linux/webkit defaults with macOS Sequoia overlay style:

```css
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.25);
  border-radius: 4px;
  border: 2px solid transparent;
  background-clip: content-box;
}
::-webkit-scrollbar-thumb:hover { background: rgba(0, 0, 0, 0.4); }
```

### 3. Focus rings + accents

Force macOS blue (`#0A84FF` dark, `#007AFF` light) on focus rings, primary buttons that use system color tokens, and selection highlights:

```css
::selection { background: rgba(0, 122, 255, 0.25); }
:focus-visible { outline-color: #007AFF !important; }
```

### 4. macOS window chrome composite

Render a window-frame template once at build time:

- Top bar 28px tall, gradient `#E8E8E8` → `#D9D9D9`, bottom 1px border `rgba(0,0,0,0.12)`
- Three traffic-light buttons at 12px diameter, 8px spacing, 10px from left, 10px from top:
  - Close: `#FF5F57` with `#E0443E` border
  - Min: `#FEBC2E` with `#DEA123` border
  - Max: `#28C840` with `#1AAB29` border
- Window content area: 12px corner radius, the page screenshot composited inside
- Drop shadow: `0 24px 48px rgba(0,0,0,0.18), 0 8px 16px rgba(0,0,0,0.10)`
- Background canvas: subtle gradient (`#F5F5F7` → `#EAEAEC`) for breathing room

Implemented by rendering a single Playwright page from `chrome-template/sequoia-window.html` with the screenshot URL substituted in, then capturing that compose page. `sharp` could do this purely from buffers, but the HTML approach is more maintainable — the chrome template is just CSS.

## State seeding — the Linterly workspace

Linterly is a fictional founder shipping an AI grammar coach for non-native English founders. Believable, niche enough nobody assumes it's a real competitor, gives realistic content for every shot.

### Files (8)

| File | Contents (summary) | Wiki-links |
|------|--------------------|------------|
| `Vision.md` | One-paragraph mission statement | `[[Customers]]`, `[[Pricing]]`, `[[Brand Voice]]` |
| `Pricing.md` | $19/mo individual, $49/mo team, free 14-day trial, founder discount table | `[[Customers]]`, `[[Q1 Goals]]` |
| `Customers.md` | 3 ICP profiles (engineer, indie hacker, exec writing investor updates) | `[[Brand Voice]]`, `[[Launch Plan]]` |
| `Launch Plan.md` | 8-week launch table, channels, key milestones | `[[Pricing]]`, `[[Customers]]`, `[[Q1 Goals]]` |
| `Competitive Analysis.md` | Notes on Grammarly, ProWritingAid, LanguageTool | `[[Vision]]`, `[[Pricing]]` |
| `Brand Voice.md` | Voice principles, banned words, reference passages | `[[Customers]]`, `[[Vision]]` |
| `Q1 Goals.md` | OKRs with metrics | `[[Launch Plan]]`, `[[Pricing]]` |
| `Founder Notes.md` | Stream-of-consciousness daily notes | `[[Q1 Goals]]`, `[[Vision]]` |

`Launch Plan.md` is the editor-default (open in shots S01, S02). `Vision.md` is open in S03 (wikilinks shot). The wiki-link graph is dense enough that the backlinks panel always has 2+ inbound links to show.

### Chat history

Three completed conversations stored, plus one "in progress" for shot S02:

- "Help me write a vision statement" → produced `Vision.md` (linked artifact in chat)
- "Customer interview script for indie hackers" → produced template flow
- "Pricing tiers for AI grammar tool" → produced `Pricing.md`
- IN PROGRESS for S02: "Draft a brand voice doc based on Vision.md and Customers.md" → mid-stream when captured, target file `Brand Voice.md` appearing in tree

### Settings

- Anthropic key: `sk-ant-api03-xxxxxxxxxxxxxxxxxxxx3xQ` (last 3 chars visible, rest masked) — never a real key, generated for display
- OpenAI key: similarly masked
- Gemini: blank (shows "Add key" CTA — demonstrates BYOK story)
- Default model: Claude Opus 4.7
- Workspace path: `/Users/jameson/Projelli/Linterly` (matches macOS path conventions for visual consistency)

### Templates

- Customer Discovery Interview — 4/10 questions answered, partial output visible
- New Business Kickoff — completed
- Pricing Strategy Workshop — not started
- Plus 12 others listed in gallery (pulled from real template list)

### Implementation strategy

Fixture is a single TS object exported from `linterly-workspace.ts`:

```ts
export const linterlyFixture = {
  files: [...],          // markdown contents + paths
  chats: [...],          // conversation array
  settings: {...},
  templates: {...},
  ui: {                  // per-shot overrides
    activeFile: "Launch Plan.md",
    activeView: "editor",
    backlinksOpen: false,
    ...
  }
}
```

`seed-state.ts` applies the fixture by calling `page.evaluate()` to write directly into the Zustand stores (or localStorage keys, depending on how Projelli persists state — verified at implementation start). Per-shot overrides are merged on top.

## Canned AI streaming

Real AI calls are forbidden during capture. Reasons:

- Burns API credits (small, but unnecessary)
- Adds nondeterminism: response wording changes between runs, breaks subsequent shots that reference it
- Adds flake risk: rate limits, network blips
- Defeats reproducibility: rerun the script, get different results

Instead, every AI endpoint is intercepted by Playwright `page.route()` and answered from a pre-recorded fixture file:

```jsonc
// ai-replays/launch-plan-stream.json
{
  "model": "claude-opus-4-7",
  "chunks": [
    { "delayMs": 0,    "text": "Here's a draft" },
    { "delayMs": 80,   "text": " launch plan" },
    { "delayMs": 60,   "text": " for Linterly:" },
    { "delayMs": 200,  "text": "\n\n## Week 1" },
    ...
  ]
}
```

`mock-ai.ts` registers route handlers for `api.anthropic.com/*` and `api.openai.com/*`, reads the fixture, and streams chunks via `route.fulfill()` with `Content-Type: text/event-stream` and a manually-constructed body that emits chunks at the recorded cadence using `setTimeout`.

Replays are recorded once by running real prompts in dev, capturing the network response, hand-editing for clarity, and committing the JSON.

## Video pipeline

V01 is a 30-second deterministic demo. Production sequence:

1. Open the page with fixture seeded, mac-styles injected, AI mocked.
2. Start `page.context().tracing.startScreencast()` OR start Playwright `recordVideo` (configured in browser context options at 1920×1080, 30fps).
3. Run the scripted action sequence with explicit timing markers:
   - **t=0–2s**: Page idle, Linterly workspace visible, `Launch Plan.md` open in editor
   - **t=2–4s**: Cursor moves to chat input (synthesized via `page.mouse.move`), types prompt char-by-char with realistic 80–120ms inter-key delays via `page.keyboard.type`
   - **t=4–22s**: AI replay streams response into chat panel; at t=14s, new file `Brand Voice.md` slides into the file tree (animated by app's existing transition); chat continues streaming to t=22s
   - **t=22–25s**: Cursor moves to file tree, clicks the new file
   - **t=25–28s**: Editor switches to `Brand Voice.md`, content visible
   - **t=28–30s**: Hold final state for 2 seconds (good thumbnail frame)
4. Stop recording → `.webm` written.
5. Post-process via ffmpeg single command:
   - Convert webm → H.264 mp4 (`-c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p`)
   - Composite macOS chrome via overlay filter (chrome PNG with alpha, fixed position)
   - Output: `demo-30s.mp4`, ~3-5 MB at 1080p / H.264

ffmpeg must be installed on the server (`apt install ffmpeg`). Check at script start; fail loudly if absent.

Hard ceiling: 35 seconds. If the natural cadence pushes past, re-cut the script.

## Run-all orchestrator

`run-all.ts` is the single entry point. Sequence:

1. Verify dependencies: `node`, `npx playwright`, `ffmpeg`, SF Pro fonts installed
2. Verify fixture validity (TS compile check)
3. Start `npm run dev` as a child process, wait for `localhost:5173` to respond healthy
4. Render `chrome-template/sequoia-window.html` once → cached PNG buffer for compositing
5. For each shot 01–11: run shot script in fresh browser context, write output to both `Assets/marketing/` and (for S01–S06) `website/press-kit/assets/`
6. Run video script V01, ffmpeg post-process
7. Print summary: file paths, byte sizes, total runtime
8. Tear down dev server

Total expected runtime: ~3–5 minutes for the full library.

Failure modes handled explicitly:

- Dev server fails to start → fail fast with diagnostic
- Fixture mismatch (e.g. Zustand store key changed) → fail per-shot with clear "fixture key X not found in store" error, continue with remaining shots
- Font check fails → fail fast (without SF Pro the entire library is wrong)
- ffmpeg missing → skip video, finish stills, exit non-zero with note

## Testing strategy

This is a generation tool, not production code, so testing is pragmatic:

- **Unit tests:** `compose-chrome.ts` and `inject-mac-styles.ts` get unit tests since they're pure transforms with deterministic output. Snapshot-test the output PNG buffer hash and the CSS string.
- **Integration:** the orchestrator `run-all.ts` is the integration test. It either produces all 11 + 1 outputs cleanly or it fails. CI runs it on a Linux runner with the same font setup.
- **Visual regression:** the produced PNGs are committed (small, ~200KB each at 2x). Re-running the pipeline and getting a non-zero diff against committed output is a signal something drifted (UI change, fixture change, font version). The diff is reviewed manually; assets re-committed when intentional.
- **No tests for the fixture content itself** — the fixture is data, reviewed by eye in PR.

## Risks and unknowns

### Known unknowns (to verify at implementation start, not design time)

1. **Tauri-only features in dev server.** The React app likely depends on some Tauri runtime APIs (real filesystem for file tree, OS keychain for settings, native dialogs). Need to grep the codebase for `@tauri-apps/api` usage and confirm what fails in browser mode. Likely outcome: add a `MARKETING_CAPTURE=1` env var that swaps in mock implementations of the Tauri shims (file tree reads from fixture, settings reads from fixture, dialogs are no-ops). Estimated 30–60 min of unknown work; flagged for implementation plan.

2. **Zustand store key shape.** Need to read the actual store to know how to seed it. Possibilities: the app already exposes a debug method for state injection; we add one behind `MARKETING_CAPTURE=1`; we drive everything through localStorage hydration. Decision deferred to plan.

3. **Editor cursor visibility in screenshots.** CodeMirror 6 hides the cursor when the editor isn't focused. We may need to keep it focused during capture or fake the cursor visibly. Tested at implementation.

### Accepted risks

- **Chromium-rendered ≠ macOS WebKit-rendered.** Real macOS users see Safari-engine rendering; we ship Chromium-rendered images. Differences are minimal for HTML/CSS as written; if subtle text antialiasing differences are detectable in the wild, we accept it.
- **Font license edge cases.** Apple's SF Pro license permits use in product mockups and screenshots. We're not redistributing the font, just installing locally. Reviewed and accepted.
- **No real Tauri shell in stills.** Press-kit purists could argue we should capture real Tauri output. Industry standard says no — every Tauri/Electron product composites desktop chrome in post.

## Acceptance criteria

The project is "done" (v1) when:

1. `~/projelli/scripts/marketing-capture/run-all.ts` runs end-to-end on this server with no human input.
2. All 11 PNGs and 1 MP4 land at the documented output paths.
3. Each PNG matches the description in the Scope table (verified by Jameson by eye).
4. The 6 press-kit slot files (`screenshot-01-workspace.png` through `screenshot-06-api-keys.png`) appear at `projelli.com/press-kit/` after `infra/deploy.sh` runs.
5. The pipeline is reproducible: re-running `run-all.ts` produces byte-identical PNGs (or near-identical, allowing for browser PNG encoder nondeterminism within a small tolerance) and a byte-identical MP4.

## Open question for the plan phase

Whether to commit produced PNGs to the repo (small, makes the press kit self-contained) or gitignore them and produce on demand. Default recommendation: **commit them** — total size <3 MB, makes deploys deterministic. Decided in plan.

---

**Status:** approved 2026-04-27. Plan to be written next via `superpowers:writing-plans`.
