/*
 * marketing-demo/render/record.mjs
 * DEMO-ONLY. Records the Keepance marketing demo video by driving the real
 * web-demo build with Playwright (animated cursor + scripted scenes), then
 * transcodes the capture to MP4 with ffmpeg and verifies it with ffprobe.
 *
 * Usage:
 *   node marketing-demo/render/record.mjs                 # full film
 *   SCENES=overlay node marketing-demo/render/record.mjs  # only scripted scenes (1-4,7)
 *   SCENES=1,2 node marketing-demo/render/record.mjs      # subset by number
 *   BASE_URL=http://localhost:5188/try/ node ...          # override demo URL
 *
 * Requires the web-demo dev server (or a static preview) running at BASE_URL.
 */
import { chromium } from 'playwright';
import { withBrowserLaunchOptions } from '../../scripts/browser-launch.mjs';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VIEW, sceneColdOpen, sceneOnboarding, sceneConnectAI, sceneConnectData, sceneClosing,
} from './scenes.mjs';
import { installDeterminism, sceneClientMap, sceneAsk } from './realScenes.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');               // marketing-demo/
const OUT = path.join(ROOT, 'output');
const RAW = path.join(OUT, 'raw');
const BASE_URL = process.env.BASE_URL || 'http://localhost:5188/try/';

const brandCss = readFileSync(path.join(__dirname, 'brand.css'), 'utf-8');
const stageJs = readFileSync(path.join(__dirname, 'stage.js'), 'utf-8');

// scene registry (in film order)
const FILM = [
  { n: 1, key: 'coldOpen', overlay: true, fn: sceneColdOpen },
  { n: 2, key: 'onboarding', overlay: true, fn: sceneOnboarding },
  { n: 3, key: 'connectAI', overlay: true, fn: sceneConnectAI },
  { n: 4, key: 'connectData', overlay: true, fn: sceneConnectData },
  { n: 5, key: 'clientMap', overlay: false, fn: sceneClientMap },
  { n: 6, key: 'ask', overlay: false, fn: sceneAsk },
  { n: 7, key: 'closing', overlay: true, fn: sceneClosing },
];

function pickScenes() {
  const raw = (process.env.SCENES || '').trim();
  if (!raw || raw === 'all') return FILM;
  if (raw === 'overlay') return FILM.filter((s) => s.overlay);
  if (raw === 'real') return FILM.filter((s) => !s.overlay);
  const nums = raw.split(',').map((x) => parseInt(x, 10)).filter(Boolean);
  return FILM.filter((s) => nums.includes(s.n));
}

async function injectStage(page) {
  await page.addStyleTag({ content: brandCss, id: 'kpd-demo-style' }).catch(() => {});
  // ensure the style tag carries the id the stage looks for
  await page.evaluate(() => {
    const tags = [...document.querySelectorAll('style')];
    const t = tags.find((s) => s.textContent && s.textContent.includes('#kpd-demo-stage'));
    if (t) t.id = 'kpd-demo-style';
  });
  await page.addScriptTag({ content: stageJs });
  await page.waitForFunction(() => window.__kp && window.__kp.__ready, { timeout: 5000 });
  // Hide web-demo-only chrome so the capture reads like the clean desktop app.
  await page.addStyleTag({ content: `
    [data-testid="egress-indicator"],
    [data-testid="egress-indicator-compact"],
    [data-testid="demo-mode-banner"] { display: none !important; }
  ` });
}

async function main() {
  const scenes = pickScenes();
  console.log(`[record] scenes: ${scenes.map((s) => s.n).join(',')}  @ ${BASE_URL}`);
  rmSync(RAW, { recursive: true, force: true });
  mkdirSync(RAW, { recursive: true });
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch(withBrowserLaunchOptions({
    headless: true,
    args: ['--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text', '--hide-scrollbars'],
  }));
  const context = await browser.newContext({
    viewport: VIEW,
    deviceScaleFactor: 1,
    recordVideo: { dir: RAW, size: VIEW },
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  const recT0 = Date.now(); // ~video start; used to trim the navy lead-in
  page.on('pageerror', (e) => console.warn('[pageerror]', e.message));

  // deterministic AI + client-map seeding (route interception + pre-load state)
  await installDeterminism(context, page);

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  // wait for the app shell to be present
  await page.waitForSelector('[data-testid="spine-nav"]', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await injectStage(page);

  // If the film opens on the cold open, raise a navy cover via the stage now so
  // the kept region right before the cold open is navy (not the loading app).
  const opensOnColdOpen = scenes[0]?.key === 'coldOpen';
  if (opensOnColdOpen) {
    await page.evaluate(() => {
      const s = document.getElementById('kpd-demo-stage');
      s.innerHTML = '<div class="kpd-scene"><div class="kpd-fullcard"><div class="kpd-grain"></div></div></div>';
      s.style.transition = 'none';     // raise the navy cover instantly (no fade)
      s.classList.add('kpd-show');
      void s.offsetWidth;
      s.style.transition = '';          // restore the CSS fade for later transitions
    });
  }

  // brief hold so the recording doesn't start mid-paint
  await page.waitForTimeout(500);

  const leadSec = (Date.now() - recT0) / 1000;
  for (const s of scenes) {
    console.log(`[record] scene ${s.n} (${s.key})…`);
    const t0 = Date.now();
    try {
      await s.fn(page);
    } catch (err) {
      console.error(`[record] scene ${s.n} failed:`, err.message);
      throw err;
    }
    console.log(`[record]   ${s.key} done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  await page.waitForTimeout(400);
  // close to flush the video file
  await page.close();
  await context.close();
  await browser.close();

  // find the produced webm
  const webm = readdirSync(RAW).filter((f) => f.endsWith('.webm')).map((f) => path.join(RAW, f))[0];
  if (!webm) throw new Error('no webm produced');
  console.log('[record] raw capture:', webm);

  // transcode to mp4 (H.264, yuv420p, 30fps) — pad/scale to exact even dims
  const suffix = (process.env.SCENES || 'all').replace(/[^a-z0-9]/gi, '');
  const mp4 = path.join(OUT, `keepance-demo${suffix === 'all' ? '' : '-' + suffix}.mp4`);
  const trim = Math.max(0, leadSec - 0.5); // drop the navy boot lead-in, keep ~0.5s
  const ff = spawnSync('ffmpeg', [
    '-y', '-ss', trim.toFixed(2), '-i', webm,
    '-vf', `scale=${VIEW.width}:${VIEW.height}:flags=lanczos,format=yuv420p`,
    '-r', '30',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
    '-movflags', '+faststart',
    '-an',
    mp4,
  ], { stdio: 'inherit' });
  if (ff.status !== 0) throw new Error('ffmpeg transcode failed');

  // verify
  const probe = spawnSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration:stream=width,height,codec_name,r_frame_rate',
    '-of', 'default=noprint_wrappers=1', mp4,
  ], { encoding: 'utf-8' });
  console.log('[record] ffprobe:\n' + probe.stdout);
  console.log('[record] MP4 ready ->', mp4);
}

main().catch((e) => { console.error(e); process.exit(1); });
