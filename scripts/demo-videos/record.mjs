#!/usr/bin/env node
/**
 * record.mjs — the one command that records a demo video of any app feature.
 *
 *   node scripts/demo-videos/record.mjs <flow-name>
 *
 * A "flow" is a small script under flows/<flow-name>.mjs that drives the real
 * app (the dev build) like a user would, using the DemoEngine API (smooth
 * cursor + captions). This runner:
 *   1. captures full-density Chromium frames for the whole session,
 *   2. injects the on-screen cursor/caption overlay,
 *   3. runs the flow,
 *   4. transcodes the raw HiDPI frames to a clean MP4 + webm in output/.
 *
 * Prereq: the Vite dev server is running (npm run dev) at http://localhost:5173.
 *
 * Flags:
 *   --keep-raw     keep the raw full-density Playwright frames alongside the outputs
 *   --headed       run headed (watch it live; recording still works)
 *   --base <url>   override the dev server base URL
 *   --output <id>  write a new output filename without changing the flow name
 */
import { chromium } from 'playwright';
import { withBrowserLaunchOptions } from '../browser-launch.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FLOWS_DIR = path.join(__dirname, 'flows');
const OUTPUT_DIR = path.join(__dirname, 'output');
const RAW_DIR = path.join(OUTPUT_DIR, '.raw');
const OVERLAY = path.join(__dirname, 'engine', 'overlay.js');
// The compositor is asked for every painted frame.  60 is not a cosmetic
// encode setting: a take is rejected if Chrome did not actually deliver close
// to 60 distinct frames per second while the flow ran.
const RECORDING_FPS = 60;
const MAX_60FPS_FRAME_GAP_MS = 28;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const hasFlag = (name) => process.argv.includes(name);

const flowName = process.argv[2];
if (!flowName || flowName.startsWith('--')) {
  const avail = fs.existsSync(FLOWS_DIR)
    ? fs
        .readdirSync(FLOWS_DIR)
        .filter((f) => f.endsWith('.mjs'))
        .map((f) => f.replace(/\.mjs$/, ''))
    : [];
  console.error('Usage: node scripts/demo-videos/record.mjs <flow-name>');
  console.error('Available flows:', avail.length ? avail.join(', ') : '(none)');
  process.exit(1);
}

const baseURL = arg(
  '--base',
  process.env.DEMO_BASE_URL || 'http://localhost:5173'
);
const outputName = arg('--output', flowName);
if (!/^[a-z0-9][a-z0-9-]*$/.test(outputName)) {
  console.error('✗ --output must use lowercase letters, numbers, and hyphens only.');
  process.exit(1);
}

// Verify the dev server is up so failures are obvious, not mysterious.
try {
  const res = await fetch(baseURL, { method: 'GET' });
  if (!res.ok) throw new Error(`status ${res.status}`);
} catch (e) {
  console.error(`\n✗ Dev server not reachable at ${baseURL}.`);
  console.error(
    `  Start it first:  npm run dev   (in ${path.resolve(__dirname, '../..')})\n`
  );
  process.exit(1);
}

const flowPath = path.join(FLOWS_DIR, `${flowName}.mjs`);
if (!fs.existsSync(flowPath)) {
  console.error(`✗ No flow named "${flowName}" (looked for ${flowPath}).`);
  process.exit(1);
}
const flowMod = await import(pathToFileURL(flowPath).href);
const run = flowMod.default;
const meta = flowMod.meta || {};
if (typeof run !== 'function') {
  console.error(
    `✗ flows/${flowName}.mjs must export a default async function.`
  );
  process.exit(1);
}

// Keep the original, comfortable app layout. Quality comes from twice the
// device pixels, never from making the browser viewport bigger (which makes
// every app control look smaller in the finished film).
const viewport = { width: 1280, height: 800 };
const deviceScaleFactor = 2;
const captureSize = {
  width: viewport.width * deviceScaleFactor,
  height: viewport.height * deviceScaleFactor,
};
// The compositor stream is CSS-pixel sized. It is later upscaled with Lanczos
// solely to retain the established board-video dimensions; smooth motion is
// more important here than an expensive PNG stream that drops a third of the
// animation frames.
const outputSize = captureSize;
if (
  meta.viewport &&
  (meta.viewport.width !== viewport.width ||
    meta.viewport.height !== viewport.height)
) {
  console.warn(
    `  ! Ignoring ${flowName}'s viewport metadata; demos always use the original ${viewport.width}x${viewport.height} layout.`
  );
}
fs.mkdirSync(RAW_DIR, { recursive: true });

console.log(
  `\n▶ Recording flow "${flowName}"  (${viewport.width}x${viewport.height} layout at ${captureSize.width}x${captureSize.height} pixels)`
);
const t0 = Date.now();

const { DemoEngine } = await import(
  pathToFileURL(path.join(__dirname, 'engine', 'DemoEngine.mjs')).href
);

const browser = await chromium.launch(withBrowserLaunchOptions({ headless: !hasFlag('--headed') }));
const context = await browser.newContext({
  viewport,
  deviceScaleFactor,
});
const page = await context.newPage();
// Fail stuck actions fast so a flaky target never freezes the recording for
// the default 30s (which reads as dead air in the final video).
page.setDefaultTimeout(4000);
page.on('console', (m) => {
  if (m.type() === 'error')
    console.log('  [page.error]', m.text().slice(0, 160));
});

// Inject the on-screen cursor + caption overlay on every navigation.
await page.addInitScript({ path: OVERLAY });

// Playwright's built-in video recorder paints a CSS-pixel viewport into a
// larger canvas on Chromium. That creates a technically big video with a
// visibly shrunken app. Direct Playwright screenshots honor deviceScaleFactor,
// so these are genuine 2560x1600 HiDPI frames of the 1280x800 layout.
async function startFullDensityCapture() {
  const framesDir = fs.mkdtempSync(path.join(RAW_DIR, `${outputName}-`));
  const frames = [];
  let active = true;
  let frameNumber = 0;
  const cdp = await context.newCDPSession(page);
  let writeQueue = Promise.resolve();
  let firstTimestamp = null;
  let lastTimestamp = null;

  // Page.screencastFrame comes directly from Chromium's compositor.  Unlike a
  // loop of Playwright screenshots, it follows every requestAnimationFrame
  // paint, so the visible cursor and the captured film share one 60fps clock.
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    if (!active) return;
    const timestamp = Number(metadata?.timestamp);
    const capturedAt = Number.isFinite(timestamp)
      ? timestamp * 1000
      : performance.now();
    const file = path.join(
      framesDir,
      `frame-${String(frameNumber++).padStart(6, '0')}.png`
    );
    if (firstTimestamp === null) firstTimestamp = capturedAt;
    lastTimestamp = capturedAt;
    frames.push({ file, capturedAt });
    // Ack immediately so Chromium can keep painting; queue the disk writes so
    // a slow disk never turns the cursor into a coarse slideshow.
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    const image = Buffer.from(data, 'base64');
    writeQueue = writeQueue.then(() => fs.promises.writeFile(file, image));
  });
  await cdp.send('Page.startScreencast', {
    // High-quality JPEG is dramatically lighter than PNG for a compositor
    // stream and is what lets Chromium keep up with requestAnimationFrame.
    // The final H.264 encode remains at CRF 16.
    format: 'jpeg',
    quality: 100,
    maxWidth: viewport.width,
    maxHeight: viewport.height,
    everyNthFrame: 1,
  });

  return {
    async stop() {
      active = false;
      await cdp.send('Page.stopScreencast').catch(() => {});
      await writeQueue;
      await cdp.detach().catch(() => {});
      const elapsedSeconds =
        firstTimestamp !== null && lastTimestamp !== null
          ? Math.max((lastTimestamp - firstTimestamp) / 1000, 0)
          : 0;
      const capturedFps = elapsedSeconds > 0 ? (frames.length - 1) / elapsedSeconds : 0;
      const timingPath = path.join(framesDir, 'capture-timing.json');
      fs.writeFileSync(
        timingPath,
        JSON.stringify({
          capturedFps,
          frames: frames.map(({ file, capturedAt }) => ({
            file: path.basename(file),
            capturedAt,
          })),
        }),
      );
      return { frames, framesDir, capturedFps, timingPath };
    },
  };
}

const capture = await startFullDensityCapture();

const engine = new DemoEngine(page, { baseURL });

let failed = null;
try {
  await run(engine, { page, meta });
  // Let the last frame breathe before we cut.
  await engine.hold(900);
} catch (e) {
  failed = e;
  console.error('  ✗ flow threw:', e.message);
}

const captured = await capture.stop();
await context.close();
await browser.close();

if (captured.frames.length < 2) {
  console.error('✗ not enough full-density frames were captured.');
  process.exit(1);
}
function bestSixFrameBurst(frames) {
  let best = null;
  for (let i = 0; i <= frames.length - 6; i += 1) {
    const deltas = Array.from({ length: 5 }, (_, j) =>
      frames[i + j + 1].capturedAt - frames[i + j].capturedAt,
    );
    const maxGap = Math.max(...deltas);
    const minGap = Math.min(...deltas);
    const mean = deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length;
    const evenness = Math.max(...deltas.map((delta) => Math.abs(delta - mean)));
    const candidate = { start: i, deltas, maxGap, minGap, mean, evenness };
    if (!best || candidate.maxGap < best.maxGap ||
      (candidate.maxGap === best.maxGap && candidate.evenness < best.evenness)) {
      best = candidate;
    }
  }
  return best;
}

const burst = bestSixFrameBurst(captured.frames);
if (!burst || burst.maxGap > MAX_60FPS_FRAME_GAP_MS) {
  console.error(
    `✗ Chromium never delivered a six-frame 60fps burst (best gap ${burst?.maxGap?.toFixed(1) ?? '?'}ms; need ≤${MAX_60FPS_FRAME_GAP_MS}ms).`
  );
  console.error(`  Raw frames were kept at ${captured.framesDir}.`);
  process.exit(1);
}
if (failed) {
  console.error(`  (raw partial frames kept at ${captured.framesDir})`);
  process.exit(1);
}

// ---- transcode: raw webm -> clean mp4 + webm -------------------------
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const mp4Out = path.join(OUTPUT_DIR, `${outputName}.mp4`);
const webmOut = path.join(OUTPUT_DIR, `${outputName}.webm`);

function dimensionsOf(file) {
  const r = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-of',
      'csv=p=0',
      file,
    ],
    { encoding: 'utf8' }
  );
  const [width, height] = (r.stdout || '').trim().split(',').map(Number);
  return { width, height };
}

// Chromium's screencast API emits CSS-pixel frames (the original comfortable
// app layout) rather than device pixels. Refuse any unexpected crop or cap.
const rawDimensions = dimensionsOf(captured.frames[0].file);
if (
  rawDimensions.width !== viewport.width ||
  rawDimensions.height !== viewport.height
) {
  console.error(
    `✗ Recorder produced ${rawDimensions.width}x${rawDimensions.height}, expected ${viewport.width}x${viewport.height}.`
  );
  console.error(`  Full-density frames were kept at ${captured.framesDir}.`);
  process.exit(1);
}

const manifestPath = path.join(captured.framesDir, 'frames.ffconcat');
const concatLines = ['ffconcat version 1.0'];
for (let i = 0; i < captured.frames.length; i += 1) {
  const frame = captured.frames[i];
  const next = captured.frames[i + 1];
  concatLines.push(`file '${frame.file.replace(/'/g, "'\\\\''")}'`);
  concatLines.push(
    `duration ${((next?.capturedAt - frame.capturedAt || 1000 / RECORDING_FPS) / 1000).toFixed(6)}`
  );
}
// concat uses the duration of a frame only when the following frame exists.
// Repeat the last image once so the final held frame reaches the output.
concatLines.push(
  `file '${captured.frames.at(-1).file.replace(/'/g, "'\\\\''")}'`
);
fs.writeFileSync(manifestPath, `${concatLines.join('\n')}\n`);

// Preserve the native HiDPI dimensions. The frame-rate conversion is the only
// video filter; yuv420p keeps broad browser/device compatibility.
const vf = `fps=${RECORDING_FPS},scale=${outputSize.width}:${outputSize.height}:flags=lanczos,format=yuv420p`;

function ffmpeg(args, label) {
  const r = spawnSync(
    'ffmpeg',
    ['-y', '-hide_banner', '-loglevel', 'error', ...args],
    {
      stdio: ['ignore', 'inherit', 'inherit'],
    }
  );
  if (r.status !== 0) console.error(`  ✗ ffmpeg (${label}) failed`);
  return r.status === 0;
}

console.log('  transcoding…');
// CRF 16 and High profile keep small type and 1px UI borders exceptionally
// clean. faststart lets browsers begin playing before downloading the file.
ffmpeg(
  [
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    manifestPath,
    '-vf',
    vf,
    '-c:v',
    'libx264',
    '-crf',
    '16',
    '-profile:v',
    'high',
    '-level:v',
    '5.0',
    '-preset',
    'slow',
    '-movflags',
    '+faststart',
    mp4Out,
  ],
  'mp4'
);
ffmpeg(
  [
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    manifestPath,
    '-vf',
    `fps=${RECORDING_FPS},scale=${outputSize.width}:${outputSize.height}:flags=lanczos`,
    '-c:v',
    'libvpx-vp9',
    '-b:v',
    '0',
    '-crf',
    '32',
    '-row-mt',
    '1',
    webmOut,
  ],
  'webm'
);

if (!hasFlag('--keep-raw')) fs.rmSync(captured.framesDir, { recursive: true, force: true });

const mp4Dimensions = dimensionsOf(mp4Out);
if (
  mp4Dimensions.width !== outputSize.width ||
  mp4Dimensions.height !== outputSize.height
) {
  console.error(
    `✗ MP4 produced ${mp4Dimensions.width}x${mp4Dimensions.height}, expected ${outputSize.width}x${outputSize.height}.`
  );
  process.exit(1);
}

// Probe duration for the report.
function durationOf(file) {
  const r = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=nw=1:nk=1',
      file,
    ],
    { encoding: 'utf8' }
  );
  const s = parseFloat((r.stdout || '').trim());
  return Number.isFinite(s) ? `${s.toFixed(1)}s` : '?';
}

const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n✓ done in ${secs}s`);
console.log(`  capture: ${captured.capturedFps.toFixed(1)}fps from Chromium compositor`);
console.log(
  `  smoothest six-frame burst: ${burst.deltas.map((delta) => delta.toFixed(1)).join(', ')}ms`,
);
if (fs.existsSync(mp4Out))
  console.log(`  MP4:  ${mp4Out}  (${durationOf(mp4Out)}, ${mp4Dimensions.width}x${mp4Dimensions.height})`);
if (fs.existsSync(webmOut)) console.log(`  WEBM: ${webmOut}`);
console.log('');
