# Keepance product-demo video (`marketing-demo/`)

A polished ~69-second MP4 that makes Keepance look like a working Windows app for a
**financial advisor**, built to validate demand ("would you pay for this?"). The hero client is
the **Webb Household** (the canonical demo client), and the story spine is the stale beneficiary
on an old 401(k) that still names Marcus's ex-wife.

**Everything in this folder is demo-only. None of it ships in the real app.**

> **2026-06-29 re-cut:** the onboarding section is now the **REAL full-screen onboarding-journey**
> (`JourneyHost`), driven live — the old simulated welcome / connect-AI / connect-data modals are
> gone. See "The real onboarding" below.

- **Output:** [`output/keepance-demo.mp4`](output/keepance-demo.mp4) — 1440×900, H.264, 30 fps, ~69 s.
- **Storyboard:** [`STORYBOARD.md`](STORYBOARD.md) — the scenes, on-screen text, timings.

---

## Regenerate the video (one command)

From the repo root:

```bash
npm run demo:video
# or:  bash marketing-demo/regenerate.sh
```

That script will:
1. Start the web-demo dev server (`vite --config vite.config.web-demo.ts`) on port 5188 if it
   isn't already running (set `PORT=…` to change it).
2. Drive the real web-demo build with Playwright — animated cursor, scripted scenes, the real
   Client Map and a pixel-faithful Ask replica — and record it.
3. Encode the MP4 with ffmpeg and verify it with ffprobe.

It's deterministic: the Client Map, the AI answers, and the "connected" state are all seeded, so
every run produces the same film. Requirements: `node`, `ffmpeg`/`ffprobe`, and the repo's
`node_modules` (Playwright + Chromium are already installed here).

### Render a subset while editing

```bash
SCENES=2        bash marketing-demo/regenerate.sh   # just the real onboarding
SCENES=1,2      bash marketing-demo/regenerate.sh   # cold open + onboarding
SCENES=5,6      bash marketing-demo/regenerate.sh   # the Client Map + Ask scenes
SCENES=6        bash marketing-demo/regenerate.sh   # just the Ask scene
```

To eyeball a frame without watching the whole clip:
`ffmpeg -y -ss <seconds> -i output/keepance-demo.mp4 -frames:v 1 /tmp/frame.png`

---

## What's REAL vs SIMULATED (the honest boundary)

This matters: the video should look real, and we keep the line between "real product" and
"scripted for the film" clear in the code.

| Scene | What it is |
|---|---|
| 1 · Cold open | **Simulated** — a branded title card (the "scattered context" pain). |
| 2 · **Onboarding** | **REAL app + REAL component.** The actual onboarding-journey `JourneyHost` (Welcome → Files stay home → Meet the AI → Choose your AI / BYOK), full-screen, driven live. Side-effects (key save, folder pick) are stubbed for the film; the on-screen copy is the product's own. |
| 5 · **Client Map** | **REAL app + REAL component.** The actual `ClientMapPanel` renders the Webb Household map from seeded demo data. This is the genuine product UI. |
| 6 · Ask | **Faithful replica** of the real Ask UI (overlaid on the real top bar + sidebar). The real Ask pipeline can't produce a live-typed, Webb-specific, verified-citation answer in the browser without product-code changes, so this scene is scripted. It matches the real components (cited answer, green "Answered over your own files" attestation, Sources panel). |
| 7 · Closing | **Simulated** — the logo + tagline card. |

All client data (the Webbs, the accounts, the beneficiary gap) is **fictional demo data**, taken
from the canonical advisor sample (`src/web-demo/sample-workspace-advisor.json`). No real API key
ever appears on screen.

---

## Where things live

```
marketing-demo/
├── STORYBOARD.md          # the 7 scenes, exact on-screen text + timings
├── README.md              # this file
├── regenerate.sh          # one-command rebuild (starts server, renders, verifies)
├── data/
│   └── webbSeed.mjs        # the Webb matter + filled Client Map (localStorage seed)
├── render/
│   ├── record.mjs          # entry point: launches Chromium, records, encodes, verifies
│   ├── scenes.mjs          # scripted overlay scenes: cold open (1) + closing (7)
│   ├── onboardingScene.mjs # Scene 2: drives the REAL onboarding-journey (JourneyHost)
│   ├── realScenes.mjs      # determinism seeding + Scene 5 (real Client Map)
│   ├── askScene.mjs        # Scene 6 (the Ask replica)
│   ├── stage.js            # in-browser engine: animated cursor, stage, captions, progress
│   └── brand.css           # demo-only styling (mirrors Keepance tokens; classes prefixed `kpd-`)
└── output/
    ├── keepance-demo.mp4   # the rendered film (+ raw/ webm capture)
    └── keyframes/          # a few extracted stills for review
```

**The real onboarding (Scene 2).** Unlike the other scenes, Scene 2 renders the genuine product
component. A dev-only overlay, `src/dev/DemoJourneyOverlay.tsx`, mounts `JourneyHost` (from
`src/features/onboarding-journey/`) on top of the running `/try` app and exposes
`window.__kpJourney.{show,hide}`. It is gated by `import.meta.env.DEV`, so it exists only under the
vite dev server the render drives — never in the deployed `/try` or the desktop build. The director
(`render/onboardingScene.mjs`) shows it, clicks through a 4-chapter cut with the demo cursor, then
hands off to Scene 5 with a navy wipe.

**Note on the `kpd-` prefix:** the demo's own CSS classes are prefixed `kpd-` (not `kp-`) so they
can never collide with the real app's `kp-` design-system classes when injected into the page.

---

## How to edit the film

- **Change wording / captions / the AI answer / the email:** edit the strings in
  `render/scenes.mjs` (cold open + closing), `render/askScene.mjs` (the Ask answer + email), and the
  caption calls in `render/realScenes.mjs` (Scene 5). Keep copy em-dash-free (house style).
- **Change the onboarding cut (Scene 2):** the chapters shown and their order live in
  `src/dev/DemoJourneyOverlay.tsx` (`DEMO_CHAPTERS`); the pacing/clicks live in
  `render/onboardingScene.mjs`. The on-screen copy itself is the product's own
  (`src/features/onboarding-journey/copy/strings.ts`) — don't edit product copy for the film.
- **Change the Client Map content:** edit `data/webbSeed.mjs` (people, accounts, dates, the
  beneficiary item, the "what's missing" questions). It seeds the **real** Client Map panel.
- **Change pacing / scene length:** each scene uses `page.waitForTimeout(...)` holds; bump those.
  Current scene lengths print during a render (`[record] <scene> done in N.Ns`).
- **Change resolution / encode:** `VIEW` in `render/scenes.mjs` and the ffmpeg args in
  `render/record.mjs`.
- **Re-style the simulated scenes:** `render/brand.css` (it mirrors the real design tokens —
  navy `#0a2540`, accent `#1f74c4`, Satoshi font, light theme).

---

## Optional follow-ups (not done)

- Background music / light SFX (left silent to avoid licensing questions — easy to add in the
  final ffmpeg step).
- A 16:9 (1920×1080) export — currently native 1440×900 (16:10); pad/scale in ffmpeg if a 16:9
  master is needed for a specific channel.
