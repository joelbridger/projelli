# Demo Video Playbook

> **✅ APPROVED FORMAT — LOCKED (Jameson, 2026-07-10, after 6 iterations).** Every future demo video matches
> this spec exactly; do not regress any line of it without his word:
> - **Recording:** real app in the browser dev build, viewport **1280×800 at deviceScaleFactor 2** (never a
>   bigger viewport), output **2560×1600 H.264 High, 60fps** (verify with ffprobe + a six-consecutive-frame
>   cursor burst showing small even steps).
> - **Cursor:** overlay eased per animation frame — visibly smooth motion.
> - **Captions:** large type on ONE line, container ~80–85% of frame width, dark pill at **~0.65–0.7 opacity**,
>   positioned bottom-center — but **top-center whenever the step's target is in the bottom 40%** of the frame
>   (never cover what is being demonstrated). Plain client/household language, no em dashes, no time promises.
> - **Verification:** extract frames and LOOK at them (cursor, caption size/position, crispness, light theme)
>   before calling any video done. Design visually.
> - **Publishing:** every new version gets a **new filename** (Cloudflare caches media) → copy to
>   `/home/jameson/board/public/demo-videos/`, update `board-data.json`, run the board deploy — and confirm the
>   PUBLISHED copy references the new names (the served file, not just the source).

This is the repeatable recipe for making a short, polished product video. It
records the real app, not a mock-up. The result should feel like someone is
calmly showing a helpful feature to an advisor.

## What you need first

1. Be in the project folder and make sure its packages are installed.
2. Start the real app in one terminal:

   ```bash
   npm run dev
   ```

   Leave it running at `http://localhost:5173`.

3. Make sure the recording tools are available:

   ```bash
   ffmpeg -version
   ffprobe -version
   npx playwright install chromium
   ```

4. Use the built-in made-up client data. It makes every take safe and
   repeatable. Add one of these query strings in the flow's `engine.goto()`:

   - `?testMode=true&seedSample=1` for the Hendricks sample household and the
     offline, pre-written cited Ask answers.
   - `?testMode=true&seedDemo=1` for the Brennan and Okafor demo households and
     their ready-made Client Maps.

Never record real client data or rely on a personal AI key for a demo take.

## Where things live

| Place | What it is |
|---|---|
| `scripts/demo-videos/record.mjs` | The one command that records and converts a video. It keeps the original 1280×800 app layout, follows Chromium's live compositor at 60fps, and delivers a 2560×1600 MP4. |
| `scripts/demo-videos/engine/DemoEngine.mjs` | The small set of actions a flow can use: move, click, type, wait, and show a caption. |
| `scripts/demo-videos/engine/overlay.js` | The visible cursor, click ripple, and large caption pill. |
| `scripts/demo-videos/flows/` | One small script for each story the video tells. |
| `scripts/demo-videos/output/` | Generated MP4 and WebM files. This folder is intentionally not saved in git. |
| `scripts/demo-videos/output/.raw/` | Temporary Playwright recordings. Keep only while diagnosing a bad take. |

## The shape of a flow

A flow is a short, readable story. It opens safe demo data, says what the
viewer is looking at, moves the visible cursor, performs a real click or type,
then leaves enough time to see the result. Use stable `data-testid` names, not
screen coordinates or brittle CSS selectors.

```js
// scripts/demo-videos/flows/my-feature.mjs
export const meta = {
  title: 'A short human title',
  // Keep this for clarity. The recorder always uses the original app layout.
  viewport: { width: 1280, height: 800 },
};

export default async function run(engine, { page }) {
  // Start from made-up, repeatable demo data.
  await engine.goto('/?testMode=true&seedDemo=1');
  await engine.hold(1000); // Let the app settle before the story begins.

  // Say one simple thing, then show it with a real click.
  const clientRow = page.getByTestId('spine-client-row-matter_demo_brennan');
  await engine.caption('Open one client to see the full picture.', 1800, {
    target: clientRow,
  });
  await engine.click(clientRow);
  await engine.clearCaption();

  // Wait for the result rather than guessing how long it takes.
  await engine.waitForTestId('clientmap-tab-household');
  const source = page.getByTestId('clientmap-source-link').first();
  await engine.caption('Every fact links back to its source.', 1800, {
    target: source,
  });
  await engine.moveTo(source); // Point without clicking when that is clearer.
  await engine.hold(700);
  await engine.clearCaption();
}
```

Keep captions plain. Say “household” or “client,” not internal names. Do not
use em dashes. Do not promise a speed you have not measured. A good caption is
one short, simple sentence, and it must fit on one line in the large pill.

### Caption placement

Every caption must name its active target with the third `caption()` argument:
`{ target: locator }`. The recorder checks the target's centre before the
caption appears. If it is in the bottom 40% of the frame, the pill goes at
top-center, about 8% from the top. Otherwise it goes at bottom-center, about
6% from the bottom. A beat without a target uses the visible cursor's current
destination. The pill glides between edges only when a new caption begins;
never move it in the middle of a caption. This keeps the narration from
ghosting over the control, answer, or source it is explaining.

## Record, inspect, and verify

This is the whole loop. Do it for every new or changed video.

```bash
# Record both web-ready formats. Add DEMO_DEBUG=1 only if a take has dead time.
node scripts/demo-videos/record.mjs ask-cited-answer --output ask-cited-answer-crisp

# Confirm the finished MP4 is really 2560×1600, H.264 High profile, and 60 frames per second.
ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_name,profile,width,height,avg_frame_rate \
  -show_entries format=duration,size -of default=nw=1 \
  scripts/demo-videos/output/ask-cited-answer-crisp.mp4

# Pull exactly six evenly spread frames. Visual review is required, not optional.
mkdir -p /tmp/ask-cited-answer-frames
DURATION=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 \
  scripts/demo-videos/output/ask-cited-answer-crisp.mp4)
ffmpeg -y -i scripts/demo-videos/output/ask-cited-answer-crisp.mp4 \
  -vf "fps=6/${DURATION}" -frames:v 6 \
  /tmp/ask-cited-answer-frames/frame-%02d.png
```

Open and look at all six frame images. Do the same for `client-map`. The tool
review must be visual: do not call a video “done” just because a command
finished. If a frame is not useful, adjust the flow or overlay and record again.
Use `--headed` to watch a take live and `--keep-raw` to keep the original
Chromium compositor frames while debugging.

### The sharp-layout rule

The browser viewport is always **1280×800** with `deviceScaleFactor: 2`, so the
app keeps its original comfortable size. Chromium's live screencast emits that
same comfortable layout at CSS-pixel size, then the recorder uses a high-quality
Lanczos scale to make the board's **2560×1600** MP4. Never make the viewport
bigger just to chase a higher-resolution file: that shrinks the interface
itself. The recorder checks that raw frames are the complete 1280×800 layout
before converting.

The cursor and all page animation are recorded from Chromium's compositor at
**60fps**. The recorder rejects a take unless it receives a six-frame burst
with gaps small enough for 60fps motion; simply converting a low-frame-rate
recording to 60fps is never acceptable. The cursor overlay itself uses
`requestAnimationFrame`, so each captured animation frame has a fresh cursor
position.

The encoder keeps the full **2560×1600** source. The finished MP4 is H.264
High profile at CRF 16 and **60fps**, so fullscreen text, fine interface lines,
and cursor motion stay crisp. The larger file is intentional.

For every approval, inspect both ordinary frames and close-up crops of text and
thin interface lines. For example:

```bash
ffmpeg -y -ss 00:00:08 -i scripts/demo-videos/output/ask-cited-answer-crisp.mp4 \
  -vf "crop=720:360:500:150,scale=1440:720:flags=neighbor" -frames:v 1 \
  /tmp/ask-cited-answer-text-crop.png
```

Open the crop as well as the full frames. The crop must show clean letter edges
and UI borders, not soft or smeared ones.

The normal one-command recording commands are:

```bash
node scripts/demo-videos/record.mjs ask-cited-answer
node scripts/demo-videos/record.mjs client-map
```

Each command writes an MP4 for broad compatibility and a smaller WebM for web
use to `scripts/demo-videos/output/`.

## The quality bar

Before accepting a take, check every item below.

- The raw compositor recording is the complete 1280×800 layout and the
  finished MP4 is 2560×1600 at 60fps. `ffprobe` reports H.264 High profile at
  CRF 16. The recorder report includes a verified six-frame 60fps burst.
- The app is in its light theme from the first frame to the last.
- The visible cursor is present, moves smoothly, and lands on the thing the
  real app action changes. Clicks have a small ripple.
- Captions are large (44px in the original 1280×800 layout), white on a
  visibly translucent dark pill (`rgba(17, 24, 39, 0.68)`), easy to read at a
  glance, and have generous padding. The panel is centered and 82% of the
  frame wide. Captions must be short enough to remain one line; the overlay
  deliberately prevents wrapping so a too-long caption is obvious and must be
  rewritten before recording.
- Every caption names its active target. Targets in the lower 40% use the
  top-center pill; all other targets use bottom-center. A caption never hides
  the control, result, source, or part of the story it explains.
- The words are short, plain, and use client/household language. No em dashes.
- The pace has no long frozen waits. Give people time to read and notice a
  result, but remove dead air.
- Six extracted frames and zoomed crops of text/UI regions have been visually
  reviewed. They show a legible one-line caption, visible cursor, crisp light
  interface, and meaningful moments from across the whole video. Also inspect
  a six-frame consecutive burst during one cursor glide: its positions must
  advance in small, even steps, proving the motion is genuinely smooth.
- The larger file is expected. The MP4 uses H.264 High profile at CRF 16,
  preserving clean text and fine UI lines for fullscreen playback.

## Put an approved video on the private board

The private board already knows how to render a **Demo Videos** sub-tab. The
steps below publish an approved MP4 there; do this only after the visual review
above passes.

1. Copy the finished MP4 into the board's public video folder. Every new video
   version **must get a new filename** first (for example `-v2` or `-crisp`).
   Cloudflare can keep an older media file at the edge, so never replace a
   reviewed version under the same name:

   ```bash
   mkdir -p /home/jameson/board/public/demo-videos
   cp scripts/demo-videos/output/ask-cited-answer-crisp.mp4 \
     /home/jameson/board/public/demo-videos/ask-cited-answer-crisp.mp4
   ```

2. In `docs/board/board-data.json`, find the section whose `id` is `demo` and
   add or update its `videos` list. Each item becomes one card in the Demo
   Videos sub-tab:

   ```json
   "videos": [
     {
       "file": "ask-cited-answer-crisp.mp4",
       "title": "Ask a question, get a cited answer",
       "description": "Ask about one household, then open the exact sources behind the answer."
     }
   ]
   ```

3. Check that the JSON is valid and publish the board files:

   ```bash
   node -e "JSON.parse(require('fs').readFileSync('docs/board/board-data.json','utf8'))"
   bash docs/board/deploy.sh
   ```

   The deploy script copies the board page and its data to
   `/home/jameson/board/public/`. It does not copy video files, which is why
   step 1 is separate.

4. Open `https://board.jameworld.com`, choose **Demo**, then **Demo Videos**.
   Play each card. Check the video starts, the title and description match, and
   the new file is the one you reviewed.

## Later: add a video to website help

Do not embed an unreviewed local output file directly. First choose the final
hosting location used by the website, copy the reviewed MP4 and optional WebM
there, then add a normal HTML `<video controls>` block with an MP4 source and a
clear sentence explaining what the viewer will learn. Test the built website in
a browser at desktop and narrow widths. Keep the same quality bar: full HD,
light UI, visible cursor, and large readable captions.

When the website gets a permanent help-video area, update this playbook with
its exact folder and page location so the next person does not have to guess.
