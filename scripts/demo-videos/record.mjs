#!/usr/bin/env node
/**
 * record.mjs — the one command that records a demo video of any app feature.
 *
 *   node scripts/demo-videos/record.mjs <flow-name>
 *
 * A "flow" is a small script under flows/<flow-name>.mjs that drives the real
 * app (the dev build) like a user would, using the DemoEngine API (smooth
 * cursor + captions). This runner:
 *   1. starts a headless Chromium recording the whole session to webm,
 *   2. injects the on-screen cursor/caption overlay,
 *   3. runs the flow,
 *   4. transcodes the raw webm to a clean MP4 + webm in output/.
 *
 * Prereq: the Vite dev server is running (npm run dev) at http://localhost:5173.
 *
 * Flags:
 *   --keep-raw     keep the raw Playwright webm alongside the outputs
 *   --headed       run headed (watch it live; recording still works)
 *   --base <url>   override the dev server base URL
 */
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FLOWS_DIR = path.join(__dirname, 'flows');
const OUTPUT_DIR = path.join(__dirname, 'output');
const RAW_DIR = path.join(OUTPUT_DIR, '.raw');
const OVERLAY = path.join(__dirname, 'engine', 'overlay.js');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const hasFlag = (name) => process.argv.includes(name);

const flowName = process.argv[2];
if (!flowName || flowName.startsWith('--')) {
  const avail = fs.existsSync(FLOWS_DIR)
    ? fs.readdirSync(FLOWS_DIR).filter((f) => f.endsWith('.mjs')).map((f) => f.replace(/\.mjs$/, ''))
    : [];
  console.error('Usage: node scripts/demo-videos/record.mjs <flow-name>');
  console.error('Available flows:', avail.length ? avail.join(', ') : '(none)');
  process.exit(1);
}

const baseURL = arg('--base', process.env.DEMO_BASE_URL || 'http://localhost:5173');

// Verify the dev server is up so failures are obvious, not mysterious.
try {
  const res = await fetch(baseURL, { method: 'GET' });
  if (!res.ok) throw new Error(`status ${res.status}`);
} catch (e) {
  console.error(`\n✗ Dev server not reachable at ${baseURL}.`);
  console.error(`  Start it first:  npm run dev   (in ${path.resolve(__dirname, '../..')})\n`);
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
  console.error(`✗ flows/${flowName}.mjs must export a default async function.`);
  process.exit(1);
}

const viewport = meta.viewport || { width: 1280, height: 800 };
fs.mkdirSync(RAW_DIR, { recursive: true });

console.log(`\n▶ Recording flow "${flowName}"  (${viewport.width}x${viewport.height})`);
const t0 = Date.now();

const { DemoEngine } = await import(pathToFileURL(path.join(__dirname, 'engine', 'DemoEngine.mjs')).href);

const browser = await chromium.launch({ headless: !hasFlag('--headed') });
const context = await browser.newContext({
  viewport,
  deviceScaleFactor: 2,
  recordVideo: { dir: RAW_DIR, size: viewport },
});
const page = await context.newPage();
// Fail stuck actions fast so a flaky target never freezes the recording for
// the default 30s (which reads as dead air in the final video).
page.setDefaultTimeout(4000);
page.on('console', (m) => {
  if (m.type() === 'error') console.log('  [page.error]', m.text().slice(0, 160));
});

// Inject the on-screen cursor + caption overlay on every navigation.
await page.addInitScript({ path: OVERLAY });

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

const video = page.video();
await context.close(); // finalizes the webm
await browser.close();

if (!video) {
  console.error('✗ no video was captured.');
  process.exit(1);
}
const rawPath = await video.path();
if (failed) {
  console.error(`  (raw partial recording kept at ${rawPath})`);
  process.exit(1);
}

// ---- transcode: raw webm -> clean mp4 + webm -------------------------
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const mp4Out = path.join(OUTPUT_DIR, `${flowName}.mp4`);
const webmOut = path.join(OUTPUT_DIR, `${flowName}.webm`);
const vf = `scale=${viewport.width}:${viewport.height}:flags=lanczos,fps=30,format=yuv420p`;

function ffmpeg(args, label) {
  const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (r.status !== 0) console.error(`  ✗ ffmpeg (${label}) failed`);
  return r.status === 0;
}

console.log('  transcoding…');
ffmpeg(['-i', rawPath, '-vf', vf, '-c:v', 'libx264', '-crf', '20', '-preset', 'slow', '-movflags', '+faststart', mp4Out], 'mp4');
ffmpeg(['-i', rawPath, '-vf', `scale=${viewport.width}:${viewport.height}:flags=lanczos,fps=30`, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', '-row-mt', '1', webmOut], 'webm');

if (!hasFlag('--keep-raw')) fs.rmSync(rawPath, { force: true });

// Probe duration for the report.
function durationOf(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' });
  const s = parseFloat((r.stdout || '').trim());
  return Number.isFinite(s) ? `${s.toFixed(1)}s` : '?';
}

const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n✓ done in ${secs}s`);
if (fs.existsSync(mp4Out)) console.log(`  MP4:  ${mp4Out}  (${durationOf(mp4Out)})`);
if (fs.existsSync(webmOut)) console.log(`  WEBM: ${webmOut}`);
console.log('');
