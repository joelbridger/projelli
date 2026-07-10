# Demo Video Engine

Make a short demo video of any app feature that shows a **real cursor clicking
through the real app, like a real person would** — ready to embed in the website
help sections.

One command:

```bash
npm run dev                                        # in another terminal (starts the app)
node scripts/demo-videos/record.mjs ask-cited-answer
```

Out come `scripts/demo-videos/output/<flow>.mp4` and `<flow>.webm`.

There are two flows today:

| Flow | What it shows | Command |
|---|---|---|
| `ask-cited-answer` | Ask a plain question about a household, get an answer grounded in that household's own files, open the sources | `node scripts/demo-videos/record.mjs ask-cited-answer` |
| `client-map` | The Client Map: one organised picture of a household, each fact linked to where it came from, gaps flagged | `node scripts/demo-videos/record.mjs client-map` |

Add a feature → add one small flow file → get a video. See "Add a new video" below.

---

## How it works (plain version)

The app you run with `npm run dev` in a browser **is the real product** (the
desktop app wraps this exact code). So we record that.

The engine does four things:

1. **Drives the real app** with Playwright (the same browser-automation tool the
   test suite uses), clicking the same buttons a person would.
2. **Draws a cursor** on the screen. Playwright's real click leaves no visible
   pointer, so we paint our own arrow that glides smoothly to each target and
   shows a little click ripple. The drawn cursor sits exactly where the real
   click lands, so what you see and what happens always match.
3. **Shows captions** — a large, soft dark bar at the bottom that narrates
   each step in plain language.
4. **Records to video** and converts it to a clean MP4 (works everywhere) and a
   WebM (small, good for the web) with `ffmpeg`.

No cloud key, no real client data, nothing leaves the machine. The app runs in
its built-in sample mode with made-up households (the Hendricks, the Brennans).

---

## Design decisions (and the research behind them)

Before building, I looked at what the repo already had. The findings shaped the
whole approach — the engine reuses existing machinery instead of reinventing it.

**Prior art:** `scripts/record-hero.mjs` already recorded the real app to WebM,
but with no visible cursor and no captions — just held on static screens. This
engine keeps its good idea (drive the real app in a seeded test mode, record the
context to video) and adds the cursor, captions, eased motion, a repeatable
flow-per-feature structure, and the MP4/WebM conversion.

**Why drive the real app, not the marketing "web demo" bundle:** there is a
separate demo bundle (`index.demo.html`, built by `vite.config.web-demo.ts`) with
canned cited answers, but it renders blank under the normal dev server (its build
flag isn't set) and it carries marketing chrome — a sticky banner, a "download"
call to action, a 5-message limit gate. For clean feature videos we want the real
app, so we drive `npm run dev` directly.

**How the app is seeded (no key, deterministic):** the app already has dev-only
"test mode" seeds, gated by URL query flags in
`src/app/lifecycle/useTestModeWorkspace.ts`:

- `?testMode=true&seedDemo=1` seeds a realistic advisor book — the **Brennan**
  and **Okafor** households, each with a fully built, cited Client Map. The
  `client-map` flow uses this.
- `?testMode=true&seedSample=1` activates the app's built-in **advisor sample
  matter** (the Hendricks). This is the *only* matter for which **Ask** serves
  its hand-authored, cited answers **offline with no cloud key** — the demo
  branch in `src/features/ask/useAsk.ts` fires when the sample matter is active,
  there is no cloud key, and the question matches one of the sample questions
  (`src/platform/matter/samples/sampleMatterDemo.ts`). The `ask-cited-answer`
  flow uses this.

  `seedSample` was added for the demo engine. It is dev/preview-only (same
  pattern and file as the existing `seedDemo` / `recordMatter` seeds) and reuses
  the exact functions the onboarding "Try a sample" path uses
  (`getOrCreateSampleMatter` + `seedSampleClientMap`). Nothing about the shipping
  app changes.

**Targets are `data-testid`s, same discipline as the test suite.** Flows click
elements by their stable `data-testid` (e.g. `spine-nav-search`,
`ask-demo-question`, `clientmap-tab-money`), never by fragile CSS or screen
position. When the UI moves, the video keeps working as long as the test ids do —
the same contract the E2E tests rely on.

---

## Files

```
scripts/demo-videos/
  README.md                 this file
  record.mjs                the one command: node record.mjs <flow>
  engine/
    overlay.js              injected into the page — draws the cursor + captions
    DemoEngine.mjs          the API a flow uses (goto, caption, click, moveTo, type…)
  flows/
    ask-cited-answer.mjs    flagship: cited answer, open sources
    client-map.mjs          the Client Map tour
  output/                   generated .mp4 / .webm  (git-ignored)
```

---

## Add a new video

1. Find the feature's `data-testid`s (grep `src/` or read `tests/e2e/**`).
2. Copy an existing flow in `flows/` to `flows/<your-feature>.mjs`.
3. Write the beats with the engine API (below). Keep captions in plain
   client/household language — no jargon, no em dashes, no time promises.
4. Run `node scripts/demo-videos/record.mjs <your-feature>`.

A flow exports a default async function and optional `meta`:

```js
export const meta = { title: 'My feature', viewport: { width: 1280, height: 800 } };

export default async function run(engine, { page }) {
  await engine.goto('/?testMode=true&seedDemo=1');
  await engine.caption('Here is the thing.', 1600);
  await engine.clickTestId('spine-nav-search');
  await engine.clearCaption();
  // ...
}
```

### Engine API

| Method | What it does |
|---|---|
| `engine.goto(pathOrUrl)` | Navigate and wait for the overlay to be ready |
| `engine.caption(text, holdMs?)` | Show a caption and hold so it can be read |
| `engine.clearCaption()` | Fade the caption out |
| `engine.hold(ms)` | Pause (use sparingly — no dead air) |
| `engine.moveTo(locator, {duration?})` | Glide the cursor to a target (no click) |
| `engine.moveToTestId(id, opts?)` | Same, by test id |
| `engine.click(locator, {duration?, settle?})` | Glide, ripple, then really click |
| `engine.clickTestId(id, opts?)` | Same, by test id |
| `engine.type(locator, text, {perChar?})` | Click a field, then type at human speed |
| `engine.typeInTestId(id, text, opts?)` | Same, by test id |
| `engine.waitFor(locator)` / `engine.waitForTestId(id)` | Wait for something to appear (no motion) |

`engine.testId(id)` returns the raw Playwright locator if you need `.filter()`,
`.first()`, `.count()`, etc.

### Flags for `record.mjs`

| Flag | Effect |
|---|---|
| `--headed` | Watch it run in a visible browser (still records) |
| `--keep-raw` | Keep the raw full-density Playwright frames next to the outputs |
| `--base <url>` | Point at a different dev server (default `http://localhost:5173`) |
| `--output <id>` | Write a new filename for an approved video version (for example `ask-cited-answer-crisp`) |
| `DEMO_DEBUG=1` (env) | Print step timings — handy when a video is too long |

---

## Quality bar

- Original 1280×800 layout captured and encoded at its full 2560×1600 HiDPI
  size (H.264 High profile, CRF 16); light theme always, smooth eased cursor,
  click ripples.
- Captions are 48px with a soft dark pill (`rgba(17, 24, 39, 0.76)`) and roomy
  padding. The centered panel is 80% of the layout width, so short wording
  stays on one or two comfortable lines and clear of meaningful UI.
- No dead time. If a video runs long, `DEMO_DEBUG=1` prints which step stalled;
  targets that aren't ready fast are skipped rather than freezing the frame.
- Captions: plain household language, short, no jargon, no em dashes, no time
  promises ("Every claim carries a source", not "In seconds you get…").

## Prerequisites

- `npm run dev` running (the flows fail fast with a clear message if it isn't).
- `ffmpeg` + `ffprobe` on the PATH (already present on this server).
- Playwright browsers installed (`npx playwright install chromium` if missing).
