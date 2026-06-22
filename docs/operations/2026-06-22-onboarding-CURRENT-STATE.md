# Onboarding Rework — CURRENT STATE (authoritative)

**Date:** 2026-06-22. Read this first for anything about the Keepance onboarding.
Supersedes earlier onboarding handoffs.

## One-paragraph summary
We built a full animated first-run onboarding "journey" (it works, it's tested, it's on
PR #33). Jameson reviewed it live and rejected the **visuals** (the hand-built CSS/SVG
shapes look amateur) and the **teaching** (it listed 3 AI options without explaining what
AI is or what the options mean). So we are reworking the **visual + teaching layer** on
top of the same working machinery. The decided approach: **Jameson creates the animations
himself in Rive**, full-bleed cinematic, to his own refined flow. The engine, flow logic,
and real setup wiring all stay. Next concrete step: Jameson makes the first Rive scene
(`welcome.riv`) and I wire it into the real app to confirm the look before he makes the rest.

## Where the work lives
- **Branch:** `feat/onboarding-journey` (git worktree at `~/keepance-wt-onboarding`;
  node_modules is **symlinked** from `~/keepance` — adding a dependency needs care so it
  doesn't pollute the main checkout).
- **HEAD:** `557bf7e` (Rive guide). **PR #33** open into `keepance-3.0` (state: OPEN).
- **Main checkout `~/keepance`** had unrelated uncommitted BUG-016 work (ask-grounding) —
  left untouched; that's why we used a worktree + PR instead of merging locally.

## What is BUILT and solid (do not redo)
The journey machinery, fully reviewed (Claude + Codex) and tested — **3,657 unit tests
pass**, typecheck/lint clean:
- Engine `src/features/onboarding-journey/` (`useJourney`/`JourneyHost`), 8 chapters,
  shared `ChapterLayout`, scene kit, `copy/strings.ts`.
- Real setup wiring via a `JourneyActions` channel: `saveApiKey` (live key refresh),
  `setConfidentialityMode`, `chooseWorkspaceFolder` (actually opens the workspace).
- `onComplete` applies profession default / identity / sample files / completion flag;
  skip + Settings "Watch the setup intro again" replay; deferred-AI reminder; full a11y +
  reduced-motion; JourneyHost is a proper fixed modal overlay.
- Cut over in `App.tsx`; old `GuidedOnboarding`/`FirstRunWizard` removed.
- **This is the part being reskinned — the LOGIC stays, the VISUALS change.**

## What is being REWORKED (visual + teaching layer)
Decided with Jameson (2026-06-21/22), via brainstorm
(`docs/superpowers/specs/2026-06-21-onboarding-visual-rework-design.md`):
1. **Graphics:** Jameson makes them himself in **Rive** (rive.app). Reason: my hand-drawn
   CSS looked amateur (HARD RULE: I do NOT draw the graphics), and the free Lottie library
   lacked the right options/cohesion. Rive = designer-controlled, interactive, clean React
   integration.
2. **Layout:** **FULL-BLEED CINEMATIC** — each scene fills the screen, text overlaid.
   Artboard **1920×1080 (16:9)**. Light/airy on-brand backdrop (light theme, navy text on
   top). Two safe zones: crop-safe (key content in central ~80%) + text-safe (calm
   lower-third/left for title+buttons; I add a frosted scrim for legibility on text-heavy
   screens). Vector = size is never a quality cap.
3. **Teaching:** rebuild content to Jameson's refined flow (screenshot
   `~/pastes/clip-20260621-121737.png`): Welcome → what Keepance is + example asks → who
   it's for → **teach the TWO secure ways to use AI** (enterprise provider w/ SOC details
   vs local model w/ effort + pros/cons) → choose (provider / local / tell me again /
   question→support / set up later) → email sync + which provider (MS/Google/Other) → team
   (join/create/solo).
4. **Division of labor:** Jameson makes one `.riv` per screen (ART + MOTION only; the
   on-screen WORDS stay in my code). I build the flow, transitions, clickable choices,
   wiring, scrim, text placement, responsive, reduced-motion.

## Guide for Jameson
`docs/design/2026-06-21-rive-onboarding-guide.md` — the step-by-step Rive walkthrough,
specs, file naming (`welcome/what-ai-is/two-ways/choose/files-home/email/team/done.riv`,
artboard `Scene`), and the make→test loop.

## The make → test loop (the immediate next step)
1. Jameson makes **`welcome.riv`** first (1920×1080, light airy full-screen, calm lower
   area for title+Start).
2. He drops it in **`~/pastes`** (where his screenshots go; if that's images-only, set up a
   tiny upload page).
3. Claude adds `@rive-app/react-canvas` (carefully — see node_modules symlink note), builds
   a `RiveScene` component + a test slot, and shows it rendering in the REAL Keepance app.
4. Confirm size/colors/feel, lock the look, then Jameson batches the other 7.

## Useful discovery (Lottie pipeline, if ever needed)
Curated Lottie was explored and proven but set aside (library lacked the right options).
How it worked, in case: harvest `.lottie` URLs from lottiefiles.com via the page's network
resources (`assets-v2.lottiefiles.com/a/<id>/*.lottie`), render via
`@lottiefiles/dotlottie-wc` (from esm.sh) on a local board served on a port, view via the
always-on Chrome at `http://100.68.20.52:<port>`.

## Landmines / open items
- **node_modules is symlinked** in the worktree — don't `npm install` carelessly.
- **PR #33's visual layer will be replaced** by the Rive version; the logic/tests stay.
- **Pre-existing security flag (NOT this work):** `useApiKeys`/`handleSaveApiKey` mirrors the
  full API key into `localStorage`, violating the repo's "keychain only / no plaintext keys"
  rule. The journey only reuses that path. Deserves a separate security task.
- For VISUAL decisions, Jameson needs to SEE options, not read text choices.

## 2026-06-22: HyperFrames evaluated — IT WORKS (decision pending)
**HyperFrames** (HeyGen, Apache-2.0, github.com/heygen-com/hyperframes) = "video as code":
write HTML/CSS/GSAP → renders a deterministic MP4, agent-driven (Claude writes the
composition). Output is **baked video, not interactive** — but that fits our full-bleed plan
(animation = the background video; clickable parts stay in my React layer on top).

**Proven on the server (works):**
- Needs Node 22+ (system is Node 20) → installed standalone at `~/node22` (system untouched).
  ffmpeg present; uses system Chrome at `/usr/bin/google-chrome` for headless capture.
- Trial project at `~/hyperframes-trial/keepance-onboarding/`. Authored a premium "welcome"
  scene (kinetic Sora type + brand aurora + grain + trust pills, on-brand navy/pink/blue),
  `npm run check` clean, `npm run render` → **1080p MP4 in ~9 seconds**. It looks genuinely
  professional — a real step up from the hand-built CSS.
- Gotchas: fonts must be LOCAL (@font-face → captured woff2 in `capture/assets/fonts/`,
  Google/Fontshare links are lint-blocked); composition rules in the project's `CLAUDE.md`
  (clips need `class="clip"` + data-start/duration/track-index; paused GSAP timeline on
  `window.__timelines["main"]`; deterministic only — no random/Date.now/repeat:-1).
- Preview shown to Jameson: served the MP4 on a port, opened in the always-on Chrome.

**The honest catch:** HyperFrames still has CLAUDE authoring the visuals (rendered as video),
so it shines for **premium motion-graphics** (kinetic type, gradients, compositing real app
screenshots, data) but does NOT produce hand-drawn **illustration** (the brain/robot/house
characters). So the choice is a STYLE fork:
- Motion-graphics look that Claude generates + Jameson art-directs (fast, free, agent-made) → **HyperFrames**.
- Illustrated scenes Jameson controls → **Rive** (he makes them).
- Possibly hybrid (HyperFrames for type/data/cinematic; Rive for illustrated moments).

**DECISION PENDING:** Jameson to react to the live HyperFrames sample and pick the direction.
If HyperFrames: I generate all 8 full-bleed scenes this way, he art-directs each, I build the
interactive overlay + wire to the existing journey machinery (which still stands). The Rive
guide stays valid if he prefers illustration.
