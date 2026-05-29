# Marketing Asset Capture — Runbook & Handoff

**Status:** v1 shipped 2026-04-27. Reproducible via `npm run capture:all`.
**Branch:** `feat/marketing-asset-capture` (37 commits ahead of `release/v1.6`, **not yet merged**).
**Spec:** `SPEC.md` (the design). **Plan:** `PLAN.md` (the build plan). **This file:** what actually exists and how to operate it.

---

## TL;DR for the next Claude / next human

The pipeline is a self-contained Node project at `scripts/marketing-capture/` that drives `npm run dev` (the React app) via headless Chromium and produces a deterministic library of marketing assets. **It runs entirely on this Linux server.** No human-in-the-loop required. One command rebuilds everything:

```
cd ~/keepance && npm run capture:all
```

Total runtime: 5–10 minutes. Output lands in `Assets/marketing/` and (for press-kit slots + videos) `website/press-kit/assets/`.

If something is broken, the fastest path is to look at `scripts/marketing-capture/run-all.ts` to find which shot/video crashed, then run that one in isolation:

```
cd ~/keepance/scripts/marketing-capture && npx tsx shots/01-workspace-hero.ts
```

The dev server must be running on `localhost:5173` with `VITE_MARKETING_CAPTURE=1` for any shot/video to work. The orchestrator starts it automatically; for manual runs, start it yourself first.

---

## What's in the library

**18 assets total:** 10 stills + 8 videos. S05 (multi-model) deferred — UI absent in product.

### Stills (10)

| ID | File | Resolution | Tier | Notes |
|----|------|-----------|------|-------|
| S01 | `screenshot-01-workspace.png` | 5440×3578 | press kit | 3-pane workspace hero |
| S02 | `screenshot-02-ai-chat.png` | 5440×3578 | press kit | AI mid-stream + new file in tree |
| S03 | `screenshot-03-wikilinks.png` | 5440×3578 | press kit | Editor + backlinks panel |
| S04 | `screenshot-04-templates.png` | 5440×3578 | press kit | Workflow gallery + DOM-injected "Current Run" card |
| S05 | — | — | — | **DEFERRED** — multi-model UI not yet in product |
| S06 | `screenshot-06-api-keys.png` | 5440×3578 | press kit | Settings → API keys |
| S07 | `og-twitter-card.png` | 1200×675 | launch | Crop of S01 + tagline overlay |
| S08 | `og-linkedin-card.png` | 1200×627 | launch | Crop of S01 + tagline overlay |
| S09 | `social-square.png` | 1080×1080 | launch | Crop of S01 |
| S10 | `feature-document-suite.png` | 5440×3578 | launch | xlsx/docx/pptx tabs visible |
| S11 | `feature-local-first.png` | 5440×3578 | launch | Workspace + Sequoia Finder window overlay |

### Videos (8)

| ID | File | Length | Notes |
|----|------|-------|-------|
| V01 | `demo-30s.mp4` | 30s | Original "magic moment" — type → AI streams → file appears → editor switches |
| V02 | `workspace-tour.mp4` | 25s | File tree → switch tabs → split-pane |
| V03 | `wiki-links.mp4` | 15s | DOM-injected autocompletion (real CodeMirror autocomplete is hard to drive) |
| V04 | `workflow-templates.mp4` | 30s | Heavy DOM injection — workflow execution UI is React-local |
| V05 | `feature-document-suite-15s.mp4` | 15s | Tab switching across .md / .xlsx / .pptx |
| V06 | `byok-setup.mp4` | 15s | Settings → API keys → typed key animation |
| V07 | `local-first.mp4` | 12s | File appears in Keepance, then reveals in Sequoia Finder mockup |
| V08 | `version-history.mp4` | 18s | DOM-injected history panel — version history UI may not be wired up in browser mode |

---

## File map

```
~/keepance/
├── docs/marketing/asset-capture/      # this folder
│   ├── SPEC.md                        # original design spec (v1 scope)
│   ├── PLAN.md                        # 21-task implementation plan
│   └── RUNBOOK.md                     # this file — handoff doc
│
├── scripts/marketing-capture/         # the pipeline
│   ├── package.json                   # deps: playwright, sharp, tsx, vitest
│   ├── tsconfig.json                  # ESM + bundler resolution
│   ├── vitest.config.ts               # local test discovery (parent config doesn't reach here)
│   ├── README.md                      # quickstart
│   │
│   ├── fixtures/
│   │   ├── linterly-workspace.ts      # the seed state — 8 markdown files, 3 chats, settings, per-shot UI overrides
│   │   └── ai-replays/
│   │       ├── launch-plan-stream.json
│   │       ├── multi-model-claude.json
│   │       └── multi-model-gpt.json
│   │
│   ├── lib/
│   │   ├── compose-chrome.ts          # wraps a PNG in macOS Sequoia chrome via Playwright + sharp
│   │   ├── compose-chrome.test.ts     # vitest
│   │   ├── inject-mac-styles.ts       # CSS overlay (SF Pro fonts, scrollbars, accents)
│   │   ├── inject-mac-styles.test.ts
│   │   ├── seed-state.ts              # writes Linterly fixture into Zustand stores via the bridge
│   │   ├── mock-ai.ts                 # local HTTP SSE proxy (Option B from plan — Playwright stream fulfill hangs)
│   │   └── capture-still.ts           # the still-shot orchestrator: launch → mock → goto → seed → inject → screenshot → compose chrome → write
│   │
│   ├── chrome-template/
│   │   ├── sequoia-window.html        # used by compose-chrome.ts for stills
│   │   ├── sequoia-chrome-1920x1080.png  # precomputed video chrome overlay (alpha PNG)
│   │   └── finder-overlay.html        # Sequoia Finder mockup for S11 + V07
│   │
│   ├── shots/                         # 11 still scripts (S05 not present)
│   │   ├── 01-workspace-hero.ts
│   │   ├── 02-ai-chat.ts
│   │   ├── 03-wikilinks.ts
│   │   ├── 04-templates.ts
│   │   ├── 06-api-keys.ts
│   │   ├── 07-09-social-reframes.ts   # the 3 launch crops in one script
│   │   ├── 10-document-suite.ts
│   │   └── 11-local-first.ts
│   │
│   ├── videos/                        # 8 video scripts
│   │   ├── 01-demo-30s.ts             # V01 magic moment
│   │   ├── 02-workspace-tour.ts       # V02
│   │   ├── 03-wikilinks.ts            # V03
│   │   ├── 04-workflow-templates.ts   # V04
│   │   ├── 05-document-suite.ts       # V05
│   │   ├── 06-byok-setup.ts           # V06
│   │   ├── 07-local-first.ts          # V07
│   │   └── 08-version-history.ts      # V08
│   │
│   └── run-all.ts                     # orchestrator — preflight, dev server, all shots, all videos, teardown
│
├── src/
│   ├── dev/marketing-capture-bridge.ts   # the only production code touched: window.__keepance_seed bridge
│   └── main.tsx                          # async bootstrap that conditionally mounts the bridge
├── vite.config.ts                        # has a `define` entry that lets Rollup tree-shake the bridge in prod builds
│
├── Assets/marketing/                  # OUTPUT — the asset library (all PNGs + MP4s)
│   └── index.html                     # local preview gallery (gitignored, regenerate locally)
│
└── website/press-kit/assets/          # OUTPUT — press-kit copies (committed)
    ├── screenshot-01..06.png          # the 5 press-kit stills (S05 deferred)
    └── *.mp4                          # all 8 videos
```

---

## How to regenerate the library

### Full library (5–10 min)

```
cd ~/keepance && npm run capture:all
```

This invokes `scripts/marketing-capture/run-all.ts`, which:

1. Verifies SF Pro fonts and ffmpeg are present (preflight)
2. Starts `npm run dev` with `VITE_MARKETING_CAPTURE=1` if not already running
3. Runs all 9 still shots (S01–S04, S06, S07–S09, S10, S11) in sequence
4. Runs all 8 videos (V01–V08) in sequence
5. Tears down the dev server

### One shot or one video at a time (faster)

```
cd ~/keepance && VITE_MARKETING_CAPTURE=1 npm run dev    # in one terminal, leave running
cd ~/keepance/scripts/marketing-capture && npx tsx shots/01-workspace-hero.ts
cd ~/keepance/scripts/marketing-capture && npx tsx videos/02-workspace-tour.ts
```

### Just the social reframes (no Playwright needed)

```
cd ~/keepance/scripts/marketing-capture && npx tsx shots/07-09-social-reframes.ts
```

This is pure `sharp` cropping of `screenshot-01-workspace.png` → 3 social crops. Doesn't need a dev server.

---

## Critical gotchas & patterns (read before editing)

### 1. The `?testMode=true` URL param is mandatory

Every navigation in the pipeline goes to `http://localhost:5173/?testMode=true`. Without `?testMode=true`, the WorkspaceSelector blocks the workspace UI and you'll get a "Welcome / Choose folder" screen instead of the workspace.

This is enforced inside `lib/capture-still.ts`. New shot scripts that bypass `captureStill` (like the videos) MUST set this themselves. Search for `testMode=true` to find every callsite.

### 2. State seeding > UI interaction (when possible)

The bridge at `src/dev/marketing-capture-bridge.ts` exposes `window.__keepance_seed(payload)` which writes directly into Zustand stores. This is faster, more deterministic, and doesn't need testids.

But: not everything is in Zustand. Some UI states are React-local. We worked around this with **DOM injection** in S04, V03, V04, V07, V08 — `page.evaluate` writes synthetic DOM that looks like the real component.

When you add new shots, prefer this order:
1. State seeding (extend `lib/seed-state.ts` with a per-shot branch)
2. localStorage seeding (use `addInitScript` if data must be available before React mount — see V06)
3. UI interaction (click testids, type)
4. **DOM injection** as last resort

### 3. Store shapes don't always match the fixture

The Linterly fixture (`fixtures/linterly-workspace.ts`) is the canonical "what we want to show." The seeder (`lib/seed-state.ts`) maps fixture fields to actual Zustand store fields, which sometimes differ:

- `editorStore` uses `openTabs`, NOT `tabs`
- `aiChatStore.sessions` is a `Record<string, ChatSession>`, not an array
- `expandedPaths` is a `Set<string>` and **cannot cross Playwright's structured-clone boundary** — must be passed as an array and reconstructed inside `page.evaluate`
- `settingsStore` is a generic key-value bag; settings seeding for S06 uses `localStorage` instead of direct setState

If you change a Zustand store, **update the seeder, not the fixture**. The fixture is data; the seeder is the adapter.

### 4. The bridge is gated by `import.meta.env.VITE_MARKETING_CAPTURE === '1'`

This is enforced two ways:

1. **Build-time:** `vite.config.ts` has a `define` entry that replaces `import.meta.env.VITE_MARKETING_CAPTURE` with the literal value at build time. When unset, the value is `''`, so the conditional dead-codes and Rollup tree-shakes the bridge out of `dist/`.
2. **Runtime:** the bridge mounts only when the var is exactly `'1'`.

Verified: `npm run build` produces a `dist/` with no references to `__keepance_seed` or `marketing-capture-bridge`. **Don't break this.** If you add features to the bridge, keep them inside `mountMarketingCaptureBridge()` so they're behind the gate.

### 5. AI mocking has a buffering quirk

`lib/mock-ai.ts` uses Option B from the plan (local HTTP SSE proxy on a random port) because Playwright 1.59.1's `route.fulfill({ body: stream })` hangs permanently. The HTTP proxy works for **wall-clock pacing** — chunks arrive over time on the wire — but Playwright's `route.fetch()` buffers the full response before delivering it to the browser, so the browser sees all events at once at the end.

Implications:
- Static screenshots: fine, we don't rely on visible streaming
- V01 demo video: works because we drive streaming animation by **directly seeding the chat store progressively** instead of using the AI mock at all

If you build a new video that needs visible streaming, do it the V01 way: seed empty assistant message, then mutate the message's content field on a timer.

### 6. ffmpeg is invoked via `execFileSync` with array args

Per the security hook in this codebase: never use `execSync` with composed strings. The video scripts use `execFileSync('ffmpeg', [...args])` so there's no shell interpretation. This is the same pattern as `src/utils/execFileNoThrow.ts`.

### 7. `Assets/` is gitignored but already-tracked files are not

Some `Assets/marketing/*.png` files are tracked in git from when they were first force-added. The .gitignore prevents NEW additions to `Assets/`, but it doesn't un-track files that are already there.

When you produce a new asset, it lands at `Assets/marketing/`. The same file lands at `website/press-kit/assets/` (which is NOT gitignored) — that's the canonical committed copy. The `Assets/marketing/` copy is a working-directory convenience.

If you write `Assets/marketing/index.html` (the local preview gallery), it's gitignored — fine, regenerate it from this runbook's example or from the existing local copy.

---

## Known limitations & ideas for v2

- **S05 (multi-model side-by-side)** — deferred because the multi-model UI doesn't exist yet. When it ships, write `shots/05-multi-model.ts` against the new store. The fixture's `multiModel` shot config is already there.
- **DOM-injected videos** — V03, V04, V08 fake their UIs because the real product UIs are React-local. When/if those features get Zustand-backed state, replace the fakes with real seeding. The visual result will be more authentic.
- **Vertical (9:16) and square (1:1) crops of videos** — explicitly out of scope for v1 per Jameson's call. Add a derive-crops step in `run-all.ts` once we know which videos perform on TikTok / Reels / IG.
- **2x DPI compose-chrome over an already-2x screenshot** — produces 5440×3578 PNGs instead of 2880×1788. Files are larger than necessary but visually correct. Can be optimized in `compose-chrome.ts` by setting `deviceScaleFactor: 1` on the compose page when the input is already 2x.
- **Playwright 1.59 video record at 1x DPI** — videos are 1920×1080 not 3840×2160. Text is legible but not Retina-crisp. Playwright's `recordVideo` doesn't support deviceScaleFactor > 1. If a future Playwright version adds it, bump and re-encode.
- **macOS chrome is composited, not native** — the Tauri shell is Linux webkit2gtk on this server, so we don't capture real macOS Tauri. The composited chrome looks like macOS but isn't. Industry standard; not a blocker.

---

## Open follow-ups (not blocking the library)

| Item | Status | Notes |
|------|--------|-------|
| Action pack Item D (6 product screenshots) | ✅ shipped | Marked done in JAMESON_ACTION_PACK.md (S05 deferred to v2) |
| Action pack Item E (30s demo video) | ✅ shipped | Marked done in JAMESON_ACTION_PACK.md |
| Press-kit page deploy | ⏳ pending | `bash infra/deploy.sh` to push assets to keepance.com/press-kit/ — REQUIRES JAMESON APPROVAL before running |
| Branch merge | ⏳ pending | `feat/marketing-asset-capture` not yet merged into `release/v1.6` |
| LicenseSettings bug fix (commit `fef1f9d`) | ⚠️ verify | Implementer rolled in a fix to the Settings modal during V06 work. Independent verification recommended — the commit message says "wire LicenseSettings into the Settings modal" but it's worth a separate review since it's not part of the original capture scope. |
| Clean up subagent test mode flag | low priority | The `?testMode=true` URL param relies on `IS_TEST_MODE` in `App.tsx`. If that's also exposed for E2E tests, it's fine. If not, consider renaming to `?marketingCapture=1` for clarity. |

---

## Where Jameson lives in this

Jameson is a senior product designer (NOT a developer per CLAUDE.md). For him:

- **Review the gallery first.** The local preview server at `Assets/marketing/index.html` is the fastest way. Start it with `cd ~/keepance/Assets/marketing && python3 -m http.server 8765 --bind 0.0.0.0` and open `http://100.68.20.52:8765/` in any browser. (You can regenerate `index.html` from this runbook if it's missing — it's just a static gallery wrapping each .png and .mp4 in a card.)
- **Don't ask him to read code.** Ask in plain language about visual quality (does it look authentic? does the streaming animation feel natural?). Take notes; iterate.
- **Production deploy is a manual step.** Don't push to keepance.com without his explicit ask.
- **He's a Wheel Health employee** — don't assume infinite session bandwidth. Wrap conversations cleanly so the next session can pick up cold from `RUNBOOK.md`.

---

## Branch state at handoff

- **On:** `feat/marketing-asset-capture`
- **Commits ahead of `release/v1.6`:** 38 (37 marketing-capture + 1 incidental LicenseSettings fix)
- **Not yet pushed to remote.** Local only.
- **Not yet merged.** Awaiting Jameson's review and merge call.
- **Press-kit pages on keepance.com still serve the OLD assets.** Deploy is pending Jameson approval.

To revert to a clean v1.6 state at any point: `git checkout release/v1.6`. The `feat/marketing-asset-capture` branch keeps all the work safe.

To inspect what changed: `git log release/v1.6..feat/marketing-asset-capture --oneline`.

---

## If something is broken when you arrive

Start here:

1. **Is the dev server running?** `curl -fsS http://localhost:5173 -o /dev/null -w "%{http_code}\n"` should return 200. If not, start it with `cd ~/keepance && VITE_MARKETING_CAPTURE=1 npm run dev` (use `Bash run_in_background: true`).
2. **Are SF Pro fonts present?** `fc-list :family | grep -ic "SF Pro"` should be ≥4. If not, re-run `/tmp/install-marketing-capture-deps.sh` (still on disk) or follow Task 1 of `PLAN.md`.
3. **Does ffmpeg work?** `ffmpeg -version | head -1`. If not: `sudo apt-get install -y ffmpeg`.
4. **Did a Zustand store change?** Run any single shot script and look at `Assets/marketing/<file>.png` — if the workspace looks empty, the seeder shape is out of date. Inspect `src/stores/*.ts` and update `lib/seed-state.ts`.
5. **Did the bridge break?** `npm run build && grep "__keepance_seed" dist/`. If it shows up in dist/, the `define` entry in `vite.config.ts` is wrong.

The pipeline is opinionated but fragile — each piece depends on assumptions about the React app it captures. If the app changes, the pipeline needs to follow.
