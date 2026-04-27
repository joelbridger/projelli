/**
 * V05 — Document suite (15s)
 *
 * Shows three tabs (.md, .xlsx, .pptx) and switches between them, highlighting
 * the v1.0.8 differentiation: Projelli opens office formats, not just markdown.
 *
 * Timing:
 *   t=0-2s:  Pricing.md active (documentSuite seed)
 *   t=2-4s:  Switch to Q1 Forecast.xlsx (cursor move + seed)
 *   t=4-9s:  Q1 Forecast.xlsx tab active, hold
 *   t=9-11s: Switch to Pitch Deck.pptx
 *   t=11-13s: Hold
 *   t=13-15s: Switch back to Pricing.md, hold final state
 */

import { chromium, type Page } from 'playwright';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readdirSync, copyFileSync, unlinkSync } from 'node:fs';
import { linterlyFixture } from '../fixtures/linterly-workspace';
import { seedState } from '../lib/seed-state';
import { macStyles } from '../lib/inject-mac-styles';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(HERE, '../../../Assets/marketing');
const PRESS_KIT_DIR = path.resolve(HERE, '../../../website/press-kit/assets');
const CHROME_PNG = path.resolve(HERE, '../chrome-template/sequoia-chrome-1920x1080.png');
const VIDEO_TMP = path.resolve(HERE, '../.tmp/video');
const ROOT = linterlyFixture.rootPath;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const THREE_TABS = [
  { path: `${ROOT}/Pricing.md`,        name: 'Pricing.md',        content: linterlyFixture.fileContents['Pricing.md'] ?? '', isDirty: false, type: 'file' },
  { path: `${ROOT}/Q1 Forecast.xlsx`,  name: 'Q1 Forecast.xlsx',  content: '', isDirty: false, type: 'file' },
  { path: `${ROOT}/Pitch Deck.pptx`,   name: 'Pitch Deck.pptx',   content: '', isDirty: false, type: 'file' },
];

async function switchTab(page: Page, activePath: string) {
  // Try real click first; fall back to seed mutation.
  const tabName = activePath.split('/').pop()!;
  const tabEl = page.locator('[data-testid="tab-item"]').filter({ hasText: tabName.replace(/\.[^.]+$/, '') });
  const bb = await tabEl.first().boundingBox({ timeout: 1000 }).catch(() => null);
  if (bb) {
    // Animate cursor toward the tab then click
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 10 });
    await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
  } else {
    // Seed fallback: swap activeTabPath without re-seeding the full workspace
    await page.evaluate(
      ({ tabs, activePath }) => {
        (window as any).__projelli_seed!({ editor: { openTabs: tabs, activeTabPath: activePath } });
      },
      { tabs: THREE_TABS, activePath },
    );
  }
}

export async function video05() {
  // Wipe any prior webm so we grab the right one.
  mkdirSync(VIDEO_TMP, { recursive: true });
  for (const f of readdirSync(VIDEO_TMP)) {
    if (f.endsWith('.webm')) unlinkSync(path.join(VIDEO_TMP, f));
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    recordVideo: { dir: VIDEO_TMP, size: { width: 1920, height: 1080 } },
  });
  const page = await context.newPage();

  await page.goto('http://localhost:5173/?testMode=true', { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: macStyles() });

  // ── t=0-2s: Pricing.md active, three tabs visible ──
  await seedState(page, linterlyFixture, 'documentSuite');
  await sleep(2000);

  // ── t=2-4s: Switch to Q1 Forecast.xlsx ──
  await switchTab(page, `${ROOT}/Q1 Forecast.xlsx`);
  await sleep(2000);

  // ── t=4-9s: Hold on xlsx tab ──
  await sleep(5000);

  // ── t=9-11s: Switch to Pitch Deck.pptx ──
  await switchTab(page, `${ROOT}/Pitch Deck.pptx`);
  await sleep(2000);

  // ── t=11-13s: Hold on pptx tab ──
  await sleep(2000);

  // ── t=13-15s: Switch back to Pricing.md, hold ──
  await switchTab(page, `${ROOT}/Pricing.md`);
  await sleep(2000);

  await page.close();
  await context.close();
  await browser.close();

  // Find recorded webm
  const webm = readdirSync(VIDEO_TMP).find((f) => f.endsWith('.webm'));
  if (!webm) throw new Error('No .webm produced by Playwright recordVideo');
  const webmPath = path.join(VIDEO_TMP, webm);

  mkdirSync(ASSETS_DIR, { recursive: true });
  const outPath = path.join(ASSETS_DIR, 'feature-document-suite-15s.mp4');

  const rawDurationStr = execFileSync('ffprobe', [
    '-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', webmPath,
  ], { encoding: 'utf-8' }).trim();
  const rawDuration = parseFloat(rawDurationStr);
  const TARGET_DURATION = 15;
  const skipSeconds = Math.max(0, rawDuration - TARGET_DURATION);

  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-ss', String(skipSeconds),
      '-i', webmPath,
      '-i', CHROME_PNG,
      '-filter_complex',
      '[0:v]scale=1808:1004[scaled];' +
      '[scaled]pad=1920:1080:56:52:color=0x1a1a1a[padded];' +
      '[1:v]format=rgba[chrome];' +
      '[padded][chrome]overlay=0:0,format=yuv420p[v]',
      '-map', '[v]',
      '-t', String(TARGET_DURATION),
      '-c:v', 'libx264',
      '-preset', 'slow',
      '-crf', '18',
      '-r', '30',
      outPath,
    ],
    { stdio: 'inherit' },
  );

  mkdirSync(PRESS_KIT_DIR, { recursive: true });
  copyFileSync(outPath, path.join(PRESS_KIT_DIR, 'feature-document-suite-15s.mp4'));
  console.log(`✓ ${outPath}`);
  return outPath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  video05().catch((e) => { console.error(e); process.exit(1); });
}
