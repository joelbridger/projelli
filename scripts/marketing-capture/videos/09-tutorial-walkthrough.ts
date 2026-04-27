/**
 * V09 — Tutorial walkthrough (hero video).
 *
 * Captures the real first-launch experience: the auto-opening Feature
 * Tour walks through 10 product surfaces, then the user opens Settings,
 * pastes an API key, and sends their first AI chat message which streams
 * back into a freshly-created file.
 *
 * Drives the *real* FeatureTour component by navigating with
 * ?testMode=true&forceTour=true, then reading testids the component
 * itself emits. No state-injection of tour internals — the bubbles,
 * highlights, and transitions are exactly what a new user sees.
 *
 * The streaming reply at the end re-uses V01's chunk replay so the
 * "magic moment" payoff matches the rest of the video set.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readdirSync, copyFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { linterlyFixture } from '../fixtures/linterly-workspace';
import { seedState } from '../lib/seed-state';
import { macStyles } from '../lib/inject-mac-styles';

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
const INTRO_DWELL_MS = 5000;     // first step is the centered intro modal

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

const CHAT_ID = 'tutorial-first-chat';
const USER_PROMPT = 'Draft a brand voice doc based on Vision.md and Customers.md.';
const CHAT_TITLE = 'Drafting brand voice for Linterly';

export async function video09() {
  // Wipe any stale recordings from prior runs — readdirSync's iteration
  // order is filesystem-dependent and we don't want to grab an old webm.
  rmSync(VIDEO_TMP, { recursive: true, force: true });
  mkdirSync(VIDEO_TMP, { recursive: true });
  const replay: Replay = JSON.parse(readFileSync(REPLAY_PATH, 'utf-8'));

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    recordVideo: { dir: VIDEO_TMP, size: { width: 1920, height: 1080 } },
  });
  const page = await context.newPage();

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

    await sleep(step.dwell);

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

  // Hold on the post-tour workspace for a final beat. The first-time
  // viewer sees the same screen the tutorial ended on, with the gear icon
  // (subject of the last tour bubble) still visible in the corner. The
  // Esc-press loop above keeps dismissing the tour if it reopens.
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

  // Same composite as V01, then crop=1808:1032:56:24 to drop the dark
  // canvas around the macOS chrome. Matches the cropped V01-V08 set.
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-i', webmPath,
      '-i', CHROME_PNG,
      '-filter_complex',
      '[0:v]scale=1808:1004[scaled];' +
      '[scaled]pad=1920:1080:56:52:color=0x1a1a1a[padded];' +
      '[1:v]format=rgba[chrome];' +
      '[padded][chrome]overlay=0:0[composed];' +
      '[composed]crop=1808:1032:56:24,format=yuv420p[v]',
      '-map', '[v]',
      '-c:v', 'libx264',
      '-preset', 'slow',
      '-crf', '20',
      '-r', '30',
      outPath,
    ],
    { stdio: 'inherit' },
  );

  mkdirSync(PRESS_KIT_DIR, { recursive: true });
  copyFileSync(outPath, path.join(PRESS_KIT_DIR, 'tutorial-walkthrough.mp4'));
  console.log(`✓ ${outPath}`);
  return outPath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  video09().catch((e) => { console.error(e); process.exit(1); });
}
