/**
 * V02 — Workspace tour (25s) with captions + auto-camera.
 *
 * Tours the 3-pane workspace: file tree on the left, editor in the
 * center. Shows clicking through files and a split-pane view.
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
const VIDEO_TMP = path.resolve(HERE, '../.tmp/video-02');
const ROOT = linterlyFixture.rootPath;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function clickFile(page: Page, fileName: string) {
  const item = page.locator('[data-testid="file-tree-item"]').filter({ hasText: fileName });
  const bb = await item.first().boundingBox({ timeout: 1000 }).catch(() => null);
  if (bb) {
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 10 });
    await sleep(100);
    await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
  } else {
    await page.evaluate(
      ({ rootPath, fileName, content }) => {
        (window as any).__keepance_seed!({
          editor: {
            openTabs: [{ path: `${rootPath}/${fileName}`, name: fileName, content, isDirty: false, type: 'file' }],
            activeTabPath: `${rootPath}/${fileName}`,
            showBacklinks: false,
          },
          workspace: { selectedPath: `${rootPath}/${fileName}` },
        });
      },
      { rootPath: ROOT, fileName, content: linterlyFixture.fileContents[fileName] ?? '' },
    );
  }
}

export async function video02() {
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

  // ── t=0-2s: Workspace hero state ──
  await seedState(page, linterlyFixture, 'workspaceHero');
  await sleep(2000);
  beats.heroSettled = elapsedSec();

  // Capture file tree rect for camera focus.
  const fileTreeRect = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="file-tree"], .file-tree, aside') as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }).catch(() => null);

  // Editor rect for camera focus.
  const editorRect = await page.evaluate(() => {
    const el = document.querySelector('.cm-editor, main, [data-testid="main-panel"]') as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }).catch(() => null);

  // ── t=2-5s: Click Vision.md ──
  await clickFile(page, 'Vision.md');
  beats.visionClicked = elapsedSec();
  await sleep(3000);

  // ── t=5-8s: Click Pricing.md ──
  await clickFile(page, 'Pricing.md');
  beats.pricingClicked = elapsedSec();
  await sleep(3000);

  // ── t=8-13s: Inject split view via DOM overlay ──
  // (The editorStore's splitPane field isn't yet rendered by the editor
  // component; the DOM overlay shows the concept reliably.)
  beats.splitOpened = elapsedSec();
  {
    await page.evaluate(
      ({ content1, content2 }) => {
        if (document.getElementById('__v02_split_overlay')) return;
        const overlay = document.createElement('div');
        overlay.id = '__v02_split_overlay';
        overlay.style.cssText = 'position:fixed;inset:0;display:flex;z-index:50;background:#1a1a1a;pointer-events:none;';
        const paneStyle = 'flex:1;display:flex;flex-direction:column;overflow:hidden;background:#ffffff;border:1px solid rgba(0,0,0,0.08);';
        for (const [title, content] of [['Launch Plan.md', content1], ['Pricing.md', content2]] as const) {
          const pane = document.createElement('div');
          pane.style.cssText = paneStyle;
          const header = document.createElement('div');
          header.style.cssText = 'height:42px;background:#f8fafc;display:flex;align-items:center;padding:0 16px;font-size:14px;font-weight:500;color:#111F35;border-bottom:1px solid #e2e8f0;';
          header.textContent = title;
          const body = document.createElement('pre');
          body.style.cssText = 'flex:1;margin:0;padding:24px;font-family:"SF Mono",ui-monospace,monospace;font-size:13px;line-height:1.6;color:#111F35;overflow:hidden;white-space:pre-wrap;word-break:break-word;';
          body.textContent = content;
          pane.appendChild(header);
          pane.appendChild(body);
          overlay.appendChild(pane);
          const divider = document.createElement('div');
          divider.style.cssText = 'width:1px;background:#e2e8f0;flex-shrink:0;';
          if (title === 'Launch Plan.md') overlay.appendChild(divider);
        }
        document.body.appendChild(overlay);
      },
      {
        content1: linterlyFixture.fileContents['Launch Plan.md'] ?? '',
        content2: linterlyFixture.fileContents['Pricing.md'] ?? '',
      },
    );
  }
  await sleep(11000); // hold split for ~11s so the caption is readable

  // ── t=19-22s: Collapse split ──
  beats.splitClosed = elapsedSec();
  await page.evaluate(() => {
    const overlay = document.getElementById('__v02_split_overlay');
    if (overlay) overlay.remove();
  });
  await page.evaluate(
    ({ rootPath, content }) => {
      (window as any).__keepance_seed!({
        editor: {
          openTabs: [{ path: `${rootPath}/Pricing.md`, name: 'Pricing.md', content, isDirty: false, type: 'file' }],
          activeTabPath: `${rootPath}/Pricing.md`,
          showBacklinks: false,
        },
      });
    },
    { rootPath: ROOT, content: linterlyFixture.fileContents['Pricing.md'] ?? '' },
  );
  await sleep(3000);
  beats.end = elapsedSec();

  await page.close();
  await context.close();
  await browser.close();

  const webms = readdirSync(VIDEO_TMP)
    .filter((f) => f.endsWith('.webm'))
    .map((f) => ({ f, mtime: statSync(path.join(VIDEO_TMP, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (webms.length === 0) throw new Error('No .webm produced by Playwright recordVideo');
  const webmPath = path.join(VIDEO_TMP, webms[0]!.f);

  mkdirSync(ASSETS_DIR, { recursive: true });
  const outPath = path.join(ASSETS_DIR, 'workspace-tour.mp4');

  console.log('[V02] beats:', JSON.stringify(beats));

  // Camera shots: focus on file tree when clicking files, on editor as
  // file content loads, then wide for the split view, then back to editor.
  const fileTreeAndEditorFocus = focusOn([fileTreeRect, editorRect], { minWidth: 1500, pad: 30 });
  const editorOnlyFocus = focusOn([editorRect], { minWidth: 1300, pad: 30 });

  const shots: CameraShot[] = [
    { tSec: 0,                                     crop: wideCrop(),                label: 'wide-open' },
    { tSec: (beats.visionClicked ?? 4) - 0.5,      crop: fileTreeAndEditorFocus,    label: 'tree+editor' },
    { tSec: (beats.splitOpened ?? 12),             crop: wideCrop(),                label: 'split-wide' },
    { tSec: (beats.splitClosed ?? 22) + 0.3,       crop: editorOnlyFocus,           label: 'editor-final' },
    { tSec: (beats.end ?? 25),                     crop: editorOnlyFocus,           label: 'hold-end' },
  ];

  const captions: Caption[] = [
    { startSec: (beats.visionClicked ?? 4) + 0.1, endSec: (beats.pricingClicked ?? 7) - 0.1, text: 'Click any file to open it' },
    { startSec: (beats.pricingClicked ?? 7) + 0.2, endSec: (beats.splitOpened ?? 12) - 0.3, text: 'Switch instantly between files' },
    { startSec: (beats.splitOpened ?? 12) + 0.5,   endSec: (beats.splitClosed ?? 22) - 0.5, text: 'Or open them side by side' },
    { startSec: (beats.splitClosed ?? 22) + 0.5,   endSec: (beats.end ?? 25) - 0.2, text: 'Tabs and panes remember where you were' },
  ];

  const PRE_ROLL_SEC = 0.5;
  const trimSec = Math.max(0, (beats.heroSettled ?? 2.5) - 0.5 - PRE_ROLL_SEC);

  await renderCinematic({
    webmPath,
    chromePngPath: CHROME_PNG,
    outPath,
    shots,
    captions,
    trimSec,
  videoTitle: 'Open files and split panes',
  });

  mkdirSync(PRESS_KIT_DIR, { recursive: true });
  copyFileSync(outPath, path.join(PRESS_KIT_DIR, 'workspace-tour.mp4'));
  console.log(`✓ press-kit copy → ${path.join(PRESS_KIT_DIR, 'workspace-tour.mp4')}`);
  return outPath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  video02().catch((e) => { console.error(e); process.exit(1); });
}
