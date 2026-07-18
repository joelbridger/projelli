/**
 * V09 — Tutorial walkthrough (hero video) with Loom-style auto-camera.
 *
 * Drives the *real* FeatureTour component by navigating with
 * ?testMode=true&forceTour=true, then reading testids the component
 * itself emits. No state-injection of tour internals — the bubbles,
 * highlights, and transitions are exactly what a new user sees.
 *
 * Camera motion: at each step we capture the bubble + target element
 * rects (in page coords) plus the timestamp relative to recording start.
 * After capture, those rects become keyframes for an animated ffmpeg
 * `crop` filter that smoothly zooms+pans between focus areas with
 * cubic ease-in-out transitions. The composite chain stays the same
 * (scale-pad-overlay chrome), only the final crop is now time-varying.
 */
import { chromium } from 'playwright';
import { withBrowserLaunchOptions } from '../../browser-launch.mjs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readdirSync, copyFileSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { linterlyFixture } from '../fixtures/linterly-workspace';
import { seedState } from '../lib/seed-state';
import { macStyles } from '../lib/inject-mac-styles';
import { composeWithCards } from '../lib/cinematic';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(HERE, '../../../Assets/marketing');
const PRESS_KIT_DIR = path.resolve(HERE, '../../../website/press-kit/assets');
const CHROME_PNG = path.resolve(HERE, '../chrome-template/sequoia-chrome-1920x1080.png');
const VIDEO_TMP = path.resolve(HERE, '../.tmp/video-09');
const REPLAY_PATH = path.resolve(HERE, '../fixtures/ai-replays/launch-plan-stream.json');

interface ReplayChunk { delayMs: number; text: string; }
interface Replay { chunks: ReplayChunk[]; createdFile?: string; }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const TOUR_STEP_DWELL_MS = 4500; // read time per anchored step
const INTRO_DWELL_MS = 200;      // skip past the intro modal almost instantly
                                 // — the camera timeline starts at file-tree

// Each step's anchored target — used by the camera math to compute a
// crop window around (target ∪ bubble). Mirrors featureTourSteps.ts.
const TARGET_SELECTORS: Record<string, string> = {
  'file-tree':       '[data-testid="sidebar-tab-files"]',
  'ai-chat':         '[data-testid="sidebar-tab-ai-assistant"]',
  'workflows':       '[data-testid="sidebar-tab-workflows"]',
  'search':          '[data-testid="sidebar-tab-search"]',
  'research':        '[data-testid="sidebar-tab-research"]',
  'whiteboard':      '[data-testid="sidebar-tab-whiteboard"]',
  'audit':           '[data-testid="sidebar-tab-audit"]',
  'command-palette': '[data-testid="command-palette-button"]',
  'settings':        '[data-testid="settings-gear"]',
};

const TOUR_STEPS = [
  { id: 'intro',            kind: 'center'   as const, dwell: INTRO_DWELL_MS },
  { id: 'file-tree',        kind: 'anchored' as const, dwell: TOUR_STEP_DWELL_MS },
  { id: 'ai-chat',          kind: 'anchored' as const, dwell: TOUR_STEP_DWELL_MS },
  { id: 'workflows',        kind: 'anchored' as const, dwell: TOUR_STEP_DWELL_MS },
  { id: 'search',           kind: 'anchored' as const, dwell: TOUR_STEP_DWELL_MS },
  { id: 'research',         kind: 'anchored' as const, dwell: TOUR_STEP_DWELL_MS },
  { id: 'whiteboard',       kind: 'anchored' as const, dwell: TOUR_STEP_DWELL_MS },
  { id: 'audit',            kind: 'anchored' as const, dwell: TOUR_STEP_DWELL_MS },
  { id: 'command-palette',  kind: 'anchored' as const, dwell: TOUR_STEP_DWELL_MS },
  { id: 'settings',         kind: 'anchored' as const, dwell: TOUR_STEP_DWELL_MS },
];

// ────────────────────────────────────────────────────────────────────────
// Camera math
// ────────────────────────────────────────────────────────────────────────

interface PageRect { x: number; y: number; width: number; height: number; }
interface CropRect { x: number; y: number; w: number; h: number; }
interface Keyframe {
  stepId: string;
  tSec: number;       // seconds since recording start
  crop: CropRect;     // crop window in post-composite 1920x1080 space
}

// Post-composite layout: source 1920x1080 video is scaled to 1808x1004 and
// placed at offset (56, 52) inside a 1920x1080 frame. The macOS chrome PNG
// (1920x1080 with alpha) is overlaid on top.
const SCALE_X = 1808 / 1920;
const SCALE_Y = 1004 / 1080;
const OFF_X = 56;
const OFF_Y = 52;

// The visible (non-padded) area of the post-composite frame. The static
// crop in V01-V08 used (56, 24, 1808, 1032), so 24..1056 vertically.
const VISIBLE_X = 56, VISIBLE_Y = 24, VISIBLE_W = 1808, VISIBLE_H = 1032;
const OUT_W = 1808, OUT_H = 1032;
const OUT_ASPECT = OUT_W / OUT_H;

// Tightest zoom — ~2.9x camera zoom. The bubble's body text reads at
// large size with comfortable padding around it. We have 4K source
// pixels to draw from, so this zoom level looks crisp on retina.
const TIGHT_W = 620;
const TIGHT_H = TIGHT_W / OUT_ASPECT;

// Padding around the union(target, bubble) bounding box. Generous on
// the right specifically because top-right bubbles (Ctrl+K, settings)
// sit close to the chrome edge and need slack so they don't clip.
const PAD = 36;
const PAD_RIGHT_EXTRA = 24;

function mapPageRectToPost(r: PageRect): { x1: number; y1: number; x2: number; y2: number } {
  return {
    x1: r.x * SCALE_X + OFF_X,
    y1: r.y * SCALE_Y + OFF_Y,
    x2: (r.x + r.width) * SCALE_X + OFF_X,
    y2: (r.y + r.height) * SCALE_Y + OFF_Y,
  };
}

function wideCrop(): CropRect {
  return { x: VISIBLE_X, y: VISIBLE_Y, w: VISIBLE_W, h: VISIBLE_H };
}

function computeCropWindow(target: PageRect | null, bubble: PageRect | null): CropRect {
  if (!target && !bubble) return wideCrop();

  const boxes = [target, bubble]
    .filter((r): r is PageRect => r !== null)
    .map(mapPageRectToPost);
  const xMin = Math.min(...boxes.map((b) => b.x1)) - PAD;
  const yMin = Math.min(...boxes.map((b) => b.y1)) - PAD;
  const xMax = Math.max(...boxes.map((b) => b.x2)) + PAD + PAD_RIGHT_EXTRA;
  const yMax = Math.max(...boxes.map((b) => b.y2)) + PAD;
  const uw = xMax - xMin;
  const uh = yMax - yMin;

  // Pick the smallest crop that (a) covers the union and (b) keeps OUT_ASPECT.
  let cropW = Math.max(uw, uh * OUT_ASPECT, TIGHT_W);
  let cropH = cropW / OUT_ASPECT;
  if (cropH < uh) {
    cropH = Math.max(uh, TIGHT_H);
    cropW = cropH * OUT_ASPECT;
  }
  // Cap at the visible area — never zoom out past wide.
  cropW = Math.min(cropW, VISIBLE_W);
  cropH = Math.min(cropH, VISIBLE_H);

  // Center on the union midpoint, then clamp inside the visible area so we
  // never reveal the dark padding behind the chrome.
  const cx = (xMin + xMax) / 2;
  const cy = (yMin + yMax) / 2;
  let cropX = cx - cropW / 2;
  let cropY = cy - cropH / 2;
  cropX = Math.max(VISIBLE_X, Math.min(cropX, VISIBLE_X + VISIBLE_W - cropW));
  cropY = Math.max(VISIBLE_Y, Math.min(cropY, VISIBLE_Y + VISIBLE_H - cropH));

  return { x: cropX, y: cropY, w: cropW, h: cropH };
}

/**
 * Build a piecewise ffmpeg expression for one channel (x | y | w | h) that
 * holds at each keyframe value, then transitions to the next over
 * `transitionSec` with a cubic ease-in-out. The transition WINDOW ends at
 * the next keyframe time, so by the moment the next bubble appears the
 * camera has already settled.
 *
 * Important: ffmpeg's crop filter doesn't expose a working `t` (timestamp)
 * variable for webm input — `t` is NaN, so any `lt(t, ...)` evaluates to
 * 0 and the expression always takes the else branch. We use `n` (input
 * frame number) instead and convert keyframe seconds to frame numbers
 * using the source webm's frame rate.
 */
function buildExpr(values: Array<{ t: number; v: number }>, transitionSec: number, fps: number): string {
  const toFrame = (sec: number) => Math.round(sec * fps);
  if (values.length === 0) return '0';
  if (values.length === 1) return values[0]!.v.toFixed(2);

  // Build right-to-left so the deepest else-branch is the final value.
  let expr = values[values.length - 1]!.v.toFixed(2);
  for (let i = values.length - 1; i >= 1; i--) {
    const prev = values[i - 1]!;
    const curr = values[i]!;
    const tStart = Math.max(prev.t, curr.t - transitionSec);
    const nStart = toFrame(tStart);
    const nEnd = toFrame(curr.t);
    const dur = Math.max(1, nEnd - nStart); // frames
    const p = `((n-${nStart})/${dur})`;
    // Cubic ease-in-out: p<.5 ? 4p^3 : 1 - (-2p+2)^3 / 2
    const eased = `if(lt(${p},0.5),4*${p}*${p}*${p},1-pow(-2*${p}+2\\,3)/2)`;
    const lerp = `(${prev.v.toFixed(2)}+(${(curr.v - prev.v).toFixed(2)})*(${eased}))`;
    expr = `if(lt(n,${nStart}),${prev.v.toFixed(2)},if(lt(n,${nEnd}),${lerp},${expr}))`;
  }
  expr = `if(lt(n,${toFrame(values[0]!.t)}),${values[0]!.v.toFixed(2)},${expr})`;
  return expr;
}

const CHAT_ID = 'tutorial-first-chat';
const USER_PROMPT = 'Draft a brand voice doc based on Vision.md and Customers.md.';
const CHAT_TITLE = 'Drafting brand voice for Linterly';

export async function video09() {
  // Wipe any stale recordings from prior runs — readdirSync's iteration
  // order is filesystem-dependent and we don't want to grab an old webm.
  rmSync(VIDEO_TMP, { recursive: true, force: true });
  mkdirSync(VIDEO_TMP, { recursive: true });
  const replay: Replay = JSON.parse(readFileSync(REPLAY_PATH, 'utf-8'));

  // Record at 4K (DPR=2) so we have the pixel headroom to zoom in 3x
  // without pixelation. The viewport stays at 1920x1080 CSS so the
  // React app's layout is unchanged; only the captured bitmap is 2x.
  //
  // `deviceScaleFactor` alone doesn't change recordVideo's pixel
  // density — Playwright happily wrote a 1920x1080 page into a 4K
  // black-padded canvas. The fix is `--force-device-scale-factor=2`
  // at the Chromium command-line level, which makes the compositor
  // render at 2x pixels for real.
  const browser = await chromium.launch(withBrowserLaunchOptions({
    args: ['--force-device-scale-factor=2', '--high-dpi-support=1'],
  }));
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
    recordVideo: { dir: VIDEO_TMP, size: { width: 3840, height: 2160 } },
  });
  const page = await context.newPage();
  // Recording starts when the page is created, so anchor t=0 here. All
  // subsequent keyframe times are webm-relative.
  const recordingStartMs = Date.now();

  // forceTour=true + testMode=true: bypasses persistent completed/skipped
  // flags and forces the tour to auto-open ~800ms after mount.
  await page.goto('http://localhost:5175/?testMode=true&forceTour=true', {
    waitUntil: 'networkidle',
  });
  await page.addStyleTag({ content: macStyles() });

  // Seed a workspace so the sidebar tabs (file-tree, ai-chat, etc.) have
  // real targets to highlight. Uses the same Linterly fixture as V01.
  await seedState(page, linterlyFixture, 'workspaceHero');

  // Strip forceTour=true from the URL NOW, before the auto-trigger timeout
  // fires. The already-scheduled setTimeout(800ms) still opens the tour
  // (its closure captured the old setTourOpen). But on the *next* render
  // (triggered by setTourOpen → state change), `const FORCE_TOUR` re-reads
  // the URL and becomes false. The auto-trigger useEffect's deps change,
  // it re-runs, hits its `IS_TEST_MODE && !FORCE_TOUR` early return, and
  // never reschedules. Without this, completing the tour flips
  // `shouldAutoShow`, which re-runs the effect with FORCE_TOUR still true,
  // and the tour reopens at step 1 forever.
  await page.evaluate(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('forceTour');
    window.history.replaceState({}, '', url.toString());
  });

  // Wait for the auto-trigger to fire. The App component schedules
  // setTourOpen(true) at +800ms; allow extra slack for React commit.
  await sleep(1500);

  // Camera timeline: one keyframe per tour step + a wide bookend after
  // the tour closes. Times are webm-relative (set above before page.goto).
  const keyframes: Keyframe[] = [];

  // ── Walk through all 10 tour steps ───────────────────────────────────
  for (let i = 0; i < TOUR_STEPS.length; i++) {
    const step = TOUR_STEPS[i]!;
    const isLast = i === TOUR_STEPS.length - 1;

    const selector =
      step.kind === 'center'
        ? '[data-testid="feature-tour-center"]'
        : `[data-testid="feature-tour-step-${step.id}"]`;

    try {
      await page.waitForSelector(selector, { timeout: 6000 });
    } catch {
      console.warn(`[V09] step "${step.id}" never appeared (selector ${selector}); continuing`);
    }

    // Capture rects RIGHT AFTER the bubble mounts so the camera math has
    // up-to-date positions. AnchoredBubble uses fixed positioning so a
    // tiny delay is enough for the layout to settle.
    await sleep(120);
    const rects = await page.evaluate(
      ({ stepId, kind, targetSel }) => {
        const bubbleSel = kind === 'center'
          ? '[data-testid="feature-tour-center"]'
          : `[data-testid="feature-tour-step-${stepId}"]`;
        const bubble = document.querySelector(bubbleSel) as HTMLElement | null;
        const target = targetSel ? (document.querySelector(targetSel) as HTMLElement | null) : null;
        const br = bubble?.getBoundingClientRect();
        const tr = target?.getBoundingClientRect();
        return {
          bubble: br ? { x: br.x, y: br.y, width: br.width, height: br.height } : null,
          target: tr ? { x: tr.x, y: tr.y, width: tr.width, height: tr.height } : null,
        };
      },
      {
        stepId: step.id,
        kind: step.kind,
        targetSel: step.kind === 'anchored' ? (TARGET_SELECTORS[step.id] ?? null) : null,
      },
    );

    const tSec = (Date.now() - recordingStartMs) / 1000;
    // Skip the intro modal as a camera keyframe — we auto-advance past
    // it in 200ms (the user wants to jump straight into the actual
    // tour content). The camera starts at file-tree's crop instead.
    if (step.id !== 'intro') {
      const crop = computeCropWindow(rects.target, rects.bubble);
      keyframes.push({ stepId: step.id, tSec, crop });
      console.log(
        `[V09] keyframe step=${step.id.padEnd(16)} t=${tSec.toFixed(2)}s ` +
        `crop=(${Math.round(crop.x)},${Math.round(crop.y)},${Math.round(crop.w)},${Math.round(crop.h)})`,
      );
    }

    await sleep(step.dwell - 120);

    if (isLast) {
      const finished = await page
        .locator('[data-testid="feature-tour-finish"]')
        .click({ timeout: 2000 })
        .then(() => true)
        .catch(() => false);
      if (!finished) {
        // Fallback: press Enter (FeatureTour treats this as Finish on last step).
        await page.keyboard.press('Enter');
      }
      // The App's auto-trigger effect re-opens the tour at step 1 once
      // shouldAutoShow flips. Press Esc repeatedly during the post-tour
      // hold to immediately dismiss any reappearance.
      // (Esc → onSkip → setTourOpen(false). The skipForNow flag
      // doesn't stop FORCE_TOUR from re-firing, so we keep dismissing.)
      const stopPressing = { current: false };
      const pressLoop = (async () => {
        while (!stopPressing.current) {
          await page.keyboard.press('Escape').catch(() => undefined);
          await sleep(150);
        }
      })();
      // Stash the controller on a closure-shared object so we can stop it
      // after the post-tour hold.
      (globalThis as any).__v09_stopPressing = stopPressing;
      (globalThis as any).__v09_pressLoop = pressLoop;
    } else {
      // Advance via the Next button when present, otherwise ArrowRight.
      const advanced = await page
        .locator('[data-testid="feature-tour-next"]')
        .click({ timeout: 2000 })
        .then(() => true)
        .catch(() => false);
      if (!advanced) {
        await page.keyboard.press('ArrowRight');
      }
    }
  }

  // Wide bookend: zoom out as the tour closes, holding on the full
  // workspace for a final beat. The Esc loop keeps dismissing any
  // tour reappearance during this hold.
  const postTourSec = (Date.now() - recordingStartMs) / 1000 + 0.4;
  keyframes.push({ stepId: 'post-tour', tSec: postTourSec, crop: wideCrop() });
  console.log(`[V09] keyframe step=post-tour        t=${postTourSec.toFixed(2)}s (wide)`);

  await sleep(2500);

  // Stop the dismissal loop and let it drain.
  const stop = (globalThis as any).__v09_stopPressing as { current: boolean } | undefined;
  if (stop) stop.current = true;
  const loop = (globalThis as any).__v09_pressLoop as Promise<void> | undefined;
  if (loop) await loop.catch(() => undefined);

  await page.close();
  await context.close();
  await browser.close();

  // Find the recorded webm — pick the newest in case multiple linger.
  const webms = readdirSync(VIDEO_TMP)
    .filter((f) => f.endsWith('.webm'))
    .map((f) => ({ f, mtime: statSync(path.join(VIDEO_TMP, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (webms.length === 0) throw new Error('No .webm produced by Playwright recordVideo');
  const webmPath = path.join(VIDEO_TMP, webms[0]!.f);

  mkdirSync(ASSETS_DIR, { recursive: true });
  const outPath = path.join(ASSETS_DIR, 'tutorial-walkthrough.mp4');

  // ── Detect input fps so the frame-number expression matches reality ──
  // Playwright's recordVideo writes webm at a fixed rate (typically 25
  // fps). The crop filter's `t` variable is NaN for webm, so we drive
  // animation off `n` (input frame number) instead.
  const probeOut = execFileSync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=r_frame_rate',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    webmPath,
  ]).toString().trim();
  const [num, den] = probeOut.split('/').map(Number);
  const FPS_IN = (num ?? 25) / (den ?? 1);
  console.log(`[V09] source webm fps = ${FPS_IN}`);

  // ── Build animated crop expressions from the keyframe timeline ──────
  // Trim the lead-in (test-workspace + intro modal flash before
  // file-tree appears). Keep ~0.4s of pre-roll so the camera is
  // pre-positioned on the file-tree zoom when the bubble pops in.
  const PRE_ROLL_SEC = 0.4;
  const trimSec = Math.max(0, keyframes[0]!.tSec - PRE_ROLL_SEC);
  // Source recording is 4K (DPR=2). All keyframes are computed in 1x
  // post-composite coords; multiply by 2 here so they index into the
  // 4K composite frame.
  const SCALE_TO_4K = 2;
  const adjusted = keyframes.map((k) => ({ ...k, tSec: k.tSec /* no shift */ }));

  const TRANSITION_SEC = 0.5;
  const exprX = buildExpr(adjusted.map((k) => ({ t: k.tSec, v: k.crop.x * SCALE_TO_4K })), TRANSITION_SEC, FPS_IN);
  const exprY = buildExpr(adjusted.map((k) => ({ t: k.tSec, v: k.crop.y * SCALE_TO_4K })), TRANSITION_SEC, FPS_IN);
  const exprW = buildExpr(adjusted.map((k) => ({ t: k.tSec, v: k.crop.w * SCALE_TO_4K })), TRANSITION_SEC, FPS_IN);
  const exprH = buildExpr(adjusted.map((k) => ({ t: k.tSec, v: k.crop.h * SCALE_TO_4K })), TRANSITION_SEC, FPS_IN);
  console.log(`[V09] trimming first ${trimSec.toFixed(2)}s from output`);

  // Persist the timeline next to the temp webm so future debugging /
  // tweaks can replay the same camera moves without recapturing.
  const timelinePath = path.join(VIDEO_TMP, 'camera-timeline.json');
  writeFileSync(timelinePath, JSON.stringify({ transitionSec: TRANSITION_SEC, keyframes }, null, 2));
  console.log(`[V09] camera timeline written → ${timelinePath}`);

  // Composite + animated crop pipeline (4K source path):
  //   1. Scale 4K source video into chrome's content area (3616x2008)
  //   2. Pad to 3840x2160, content offset (112, 104)
  //   3. Scale chrome PNG 1920x1080 → 3840x2160 with lanczos
  //   4. Overlay chrome PNG on top
  //   5. Animated crop in 4K coords = time-varying camera window
  //   6. Lanczos downscale to 1808x1032 — the final video output
  //
  // The downscale is what makes the zoomed result crisp: at TIGHT_W=620
  // (1x) = 1240 (4K) crop, source pixels per output pixel = 1240/1808 =
  // 0.69. So each output pixel is averaged from ~1.5 source pixels.
  // Sharp on retina without obvious blocking.
  // Render the composite to a `.main.mp4`; we'll prepend the title
  // card and append the end card via composeWithCards so V09 matches
  // the rest of the demo videos.
  const mainPath = outPath.replace(/\.mp4$/, '.main.mp4');
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-i', webmPath,
      '-i', CHROME_PNG,
      // -ss after -i = output seek: trims the first N seconds of the
      // ENCODED output (after filter graph runs). This avoids the
      // PTS/`n` reset issues that -ss before -i would cause.
      '-ss', trimSec.toFixed(3),
      '-filter_complex',
      '[0:v]scale=3616:2008:flags=lanczos[scaled];' +
      '[scaled]pad=3840:2160:112:104:color=0x1a1a1a[padded];' +
      '[1:v]scale=3840:2160:flags=lanczos,format=rgba[chrome];' +
      '[padded][chrome]overlay=0:0[composed];' +
      `[composed]crop=w='${exprW}':h='${exprH}':x='${exprX}':y='${exprY}'[zoomed];` +
      '[zoomed]scale=1808:1032:flags=lanczos,format=yuv420p[v]',
      '-map', '[v]',
      '-c:v', 'libx264',
      '-preset', 'slow',
      '-crf', '18',
      '-r', '30',
      mainPath,
    ],
    { stdio: 'inherit' },
  );

  // Wrap with intro + outro cards (matches V01-V08 treatment).
  const cardDir = path.join(VIDEO_TMP, 'cards');
  await composeWithCards({
    mainPath,
    outPath,
    videoTitle: 'Start here: the first launch tour',
    endTagline: 'keepance.com',
    cardDir,
  });

  mkdirSync(PRESS_KIT_DIR, { recursive: true });
  copyFileSync(outPath, path.join(PRESS_KIT_DIR, 'tutorial-walkthrough.mp4'));
  console.log(`✓ ${outPath}`);
  return outPath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  video09().catch((e) => { console.error(e); process.exit(1); });
}
