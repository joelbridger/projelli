# Keepance product-demo video (`marketing-demo/`)

A polished ~78-second MP4 that makes Keepance look like a working Windows app for a
**financial advisor**, built to validate demand ("would you pay for this?"). The hero client is
the **Webb Household** (the canonical demo client), and the story spine is the stale beneficiary
on an old 401(k) that still names Marcus's ex-wife.

**Everything in this folder is demo-only. None of it ships in the real app.**

- **Output:** [`output/keepance-demo.mp4`](output/keepance-demo.mp4) — 1440×900, H.264, 30 fps, ~78 s.
- **Storyboard:** [`STORYBOARD.md`](STORYBOARD.md) — the 7 scenes, on-screen text, timings.

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
SCENES=overlay bash marketing-demo/regenerate.sh   # only the scripted scenes (1-4,7)
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
| 2 · Onboarding | **Simulated** — welcome / profession / create-client / privacy modals, styled to match the app. |
| 3 · Connect an AI | **Simulated** — provider pick + a **masked, fake** API key (never a real key) + "connected". |
| 4 · Connect data | **Simulated** — the document-import progress bars. *No real indexing happens.* |
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
│   ├── scenes.mjs          # scripted scenes 1-4 + 7 (cold open, onboarding, connect, import, closing)
│   ├── realScenes.mjs      # determinism seeding + Scene 5 (real Client Map)
│   ├── askScene.mjs        # Scene 6 (the Ask replica)
│   ├── stage.js            # in-browser engine: animated cursor, stage, captions, progress
│   └── brand.css           # demo-only styling (mirrors Keepance tokens; classes prefixed `kpd-`)
└── output/
    └── keepance-demo.mp4   # the rendered film (+ raw/ webm capture)
```

**Note on the `kpd-` prefix:** the demo's own CSS classes are prefixed `kpd-` (not `kp-`) so they
can never collide with the real app's `kp-` design-system classes when injected into the page.

---

## How to edit the film

- **Change wording / captions / the AI answer / the email:** edit the strings in
  `render/scenes.mjs` (scenes 1-4, 7), `render/askScene.mjs` (the Ask answer + email), and the
  caption calls in `render/realScenes.mjs` (Scene 5). Keep copy em-dash-free (house style).
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
