/**
 * V05 — Document suite (15s)
 *
 * Shows three tabs (.md, .xlsx, .pptx) and switches between them, highlighting
 * the v1.0.8 differentiation: Keepance opens office formats, not just markdown.
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
import { withBrowserLaunchOptions } from '../../browser-launch.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readdirSync, copyFileSync, rmSync, statSync } from 'node:fs';
import { linterlyFixture } from '../fixtures/linterly-workspace';
import { seedState } from '../lib/seed-state';
import { macStyles } from '../lib/inject-mac-styles';
import { renderCinematic, focusOn, wideCrop, type CameraShot, type Caption } from '../lib/cinematic';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(HERE, '../../../Assets/marketing');
const PRESS_KIT_DIR = path.resolve(HERE, '../../../website/press-kit/assets');
const CHROME_PNG = path.resolve(HERE, '../chrome-template/sequoia-chrome-1920x1080.png');
const VIDEO_TMP = path.resolve(HERE, '../.tmp/video-05');
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
        (window as any).__keepance_seed!({ editor: { openTabs: tabs, activeTabPath: activePath } });
      },
      { tabs: THREE_TABS, activePath },
    );
  }
}

export async function video05() {
  rmSync(VIDEO_TMP, { recursive: true, force: true });
  mkdirSync(VIDEO_TMP, { recursive: true });

  const browser = await chromium.launch(withBrowserLaunchOptions({
    args: ['--force-device-scale-factor=2', '--high-dpi-support=1'],
  }));
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
    recordVideo: { dir: VIDEO_TMP, size: { width: 3840, height: 2160 } },
  });
  const page = await context.newPage();
  const recordingStartMs = Date.now();
  const elapsedSec = () => (Date.now() - recordingStartMs) / 1000;
  const beats: Record<string, number> = {};

  await page.goto('http://localhost:5175/?testMode=true', { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: macStyles() });
  beats.pageReady = elapsedSec();

  await seedState(page, linterlyFixture, 'documentSuite');
  await sleep(2000);
  beats.mdShown = elapsedSec();

  // Capture rect of the tab strip for camera focus.
  const tabStripRect = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="tab-bar"], .tab-bar, header') as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }).catch(() => null);

  await switchTab(page, `${ROOT}/Q1 Forecast.xlsx`);
  beats.xlsxShown = elapsedSec();
  await sleep(5500);

  await switchTab(page, `${ROOT}/Pitch Deck.pptx`);
  beats.pptxShown = elapsedSec();
  await sleep(3500);

  await switchTab(page, `${ROOT}/Pricing.md`);
  beats.backToMd = elapsedSec();
  await sleep(2500);
  beats.end = elapsedSec();

  await page.close();
  await context.close();
  await browser.close();

  const webms = readdirSync(VIDEO_TMP)
    .filter((f) => f.endsWith('.webm'))
    .map((f) => ({ f, mtime: statSync(path.join(VIDEO_TMP, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (webms.length === 0) throw new Error('No .webm produced');
  const webmPath = path.join(VIDEO_TMP, webms[0]!.f);

  mkdirSync(ASSETS_DIR, { recursive: true });
  const outPath = path.join(ASSETS_DIR, 'feature-document-suite-15s.mp4');

  console.log('[V05] beats:', JSON.stringify(beats));

  // Camera focuses on the tab bar so the user can see the file types
  // (.md / .xlsx / .pptx) the active tab is changing.
  const tabAreaFocus = tabStripRect
    ? focusOn([{ x: tabStripRect.x, y: tabStripRect.y, width: 1700, height: 600 }], { minWidth: 1500, pad: 30 })
    : { x: 56, y: 24, w: 1700, h: 970 };

  const shots: CameraShot[] = [
    { tSec: 0,                            crop: tabAreaFocus, label: 'tabs+content' },
    { tSec: (beats.end ?? 14),            crop: tabAreaFocus, label: 'hold-end' },
  ];

  const captions: Caption[] = [
    { startSec: (beats.mdShown ?? 2) + 0.3,    endSec: (beats.xlsxShown ?? 4) - 0.2, text: 'Open .md files' },
    { startSec: (beats.xlsxShown ?? 4) + 0.4,  endSec: (beats.pptxShown ?? 9) - 0.3,  text: 'Spreadsheets too' },
    { startSec: (beats.pptxShown ?? 10) + 0.3, endSec: (beats.backToMd ?? 13) - 0.2, text: 'And presentations' },
    { startSec: (beats.backToMd ?? 13) + 0.3,  endSec: (beats.end ?? 15) - 0.2, text: 'All in one workspace' },
  ];

  const PRE_ROLL_SEC = 0.4;
  const trimSec = Math.max(0, (beats.mdShown ?? 2) - 0.5 - PRE_ROLL_SEC);

  await renderCinematic({ webmPath, chromePngPath: CHROME_PNG, outPath, shots, captions, trimSec, videoTitle: 'Edit Excel, Word, and PowerPoint here too' });

  mkdirSync(PRESS_KIT_DIR, { recursive: true });
  copyFileSync(outPath, path.join(PRESS_KIT_DIR, 'feature-document-suite-15s.mp4'));
  console.log(`✓ press-kit copy → ${path.join(PRESS_KIT_DIR, 'feature-document-suite-15s.mp4')}`);
  return outPath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  video05().catch((e) => { console.error(e); process.exit(1); });
}
