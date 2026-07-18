/**
 * V07 — Local-first (12s)
 *
 * Shows a file in Keepance, then slides in the macOS Finder to show the same
 * file exists on disk. Reinforces "your data stays on your machine."
 *
 * Timing:
 *   t=0-2s:  Workspace hero state, file tree visible
 *   t=2-3s:  "Brand Voice.md" appears in the tree (seed mutation)
 *   t=3-5s:  Brief focus on new file (click or seed active)
 *   t=5-7s:  Finder mockup slides in from the right
 *   t=7-12s: Both side-by-side — Keepance left, Finder right — hold
 *
 * The Finder overlay is built entirely via safe DOM APIs — no innerHTML.
 */

import { chromium } from 'playwright';
import { withBrowserLaunchOptions } from '../../browser-launch.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readdirSync, copyFileSync, rmSync, statSync } from 'node:fs';
import { linterlyFixture } from '../fixtures/linterly-workspace';
import { macStyles } from '../lib/inject-mac-styles';
import { renderCinematic, wideCrop, type CameraShot, type Caption } from '../lib/cinematic';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(HERE, '../../../Assets/marketing');
const PRESS_KIT_DIR = path.resolve(HERE, '../../../website/press-kit/assets');
const CHROME_PNG = path.resolve(HERE, '../chrome-template/sequoia-chrome-1920x1080.png');
const VIDEO_TMP = path.resolve(HERE, '../.tmp/video-07');
const ROOT = linterlyFixture.rootPath;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function video07() {
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

  // ── t=0-2s: Workspace hero (Launch Plan.md, file tree visible, no Brand Voice) ──
  const filesWithoutBrandVoice = linterlyFixture.files.filter((f) => f.name !== 'Brand Voice.md');
  await page.waitForFunction(() => typeof (window as any).__keepance_seed === 'function', null, { timeout: 10_000 });
  await page.evaluate(
    ({ rootPath, files }) => {
      (window as any).__keepance_seed!({
        skipOnboarding: true,
        workspace: {
          rootPath,
          fileTree: files,
          selectedPath: `${rootPath}/Launch Plan.md`,
          expandedPaths: new Set([rootPath]),
          recentWorkspaces: [{ path: rootPath, name: 'Linterly', lastOpened: Date.now() }],
        },
        editor: {
          openTabs: [{ path: `${rootPath}/Launch Plan.md`, name: 'Launch Plan.md', content: '', isDirty: false, type: 'file' }],
          activeTabPath: `${rootPath}/Launch Plan.md`,
          showBacklinks: false,
        },
      });
    },
    { rootPath: ROOT, files: filesWithoutBrandVoice },
  );
  await sleep(2000);
  beats.heroSettled = elapsedSec();

  // ── t=2-3s: Brand Voice.md appears in the file tree ──
  const brandVoiceFile = linterlyFixture.files.find((f) => f.name === 'Brand Voice.md')!;
  await page.evaluate(
    ({ rootPath, files }) => {
      (window as any).__keepance_seed!({ workspace: { rootPath, fileTree: files } });
    },
    { rootPath: ROOT, files: [...filesWithoutBrandVoice, brandVoiceFile] },
  );
  beats.fileAppeared = elapsedSec();
  await sleep(1000);

  // ── t=3-5s: Brand Voice.md becomes active ──
  const bvItem = page.locator('[data-testid="file-tree-item"]').filter({ hasText: 'Brand Voice' });
  const bb = await bvItem.first().boundingBox({ timeout: 1000 }).catch(() => null);
  if (bb) {
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 8 });
    await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
  } else {
    await page.evaluate(
      ({ rootPath, content }) => {
        (window as any).__keepance_seed!({
          editor: {
            openTabs: [{ path: `${rootPath}/Brand Voice.md`, name: 'Brand Voice.md', content, isDirty: false, type: 'file' }],
            activeTabPath: `${rootPath}/Brand Voice.md`,
          },
          workspace: { selectedPath: `${rootPath}/Brand Voice.md` },
        });
      },
      { rootPath: ROOT, content: linterlyFixture.fileContents['Brand Voice.md'] ?? '' },
    );
  }
  await sleep(2000);
  beats.fileOpened = elapsedSec();

  // ── t=5-7s: Finder panel slides in from the right ──
  // Built entirely with safe DOM API calls; no innerHTML.
  await page.evaluate(
    ({ fileNames }: { fileNames: string[] }) => {
      if (document.getElementById('__v07_finder')) return;

      /* ── styles ── */
      const style = document.createElement('style');
      style.id = '__v07_finder_style';
      style.textContent = `
        @keyframes __v07slideIn {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
        #__v07_finder {
          position: fixed;
          top: 52px; right: 0;
          width: 42%;
          bottom: 0;
          z-index: 100;
          display: flex;
          align-items: flex-start;
          padding-top: 32px;
          justify-content: center;
          background: rgba(20,20,20,0.92);
          box-shadow: -4px 0 32px rgba(0,0,0,0.5);
          animation: __v07slideIn 0.45s cubic-bezier(0.25,0.46,0.45,0.94) forwards;
        }
        .v07-finder-win {
          width: 380px;
          background: #fff;
          border-radius: 10px;
          overflow: hidden;
          box-shadow: 0 16px 40px rgba(0,0,0,0.3);
          font-family: -apple-system, "SF Pro Text", system-ui, sans-serif;
          font-size: 12px;
          color: #1d1d1f;
          user-select: none;
        }
        .v07-titlebar {
          height: 26px;
          background: linear-gradient(180deg,#EBEBEB,#D8D8D8);
          border-bottom: 1px solid rgba(0,0,0,0.12);
          display: flex;
          align-items: center;
          padding: 0 10px;
          position: relative;
        }
        .v07-lights { display: flex; gap: 7px; align-items: center; }
        .v07-dot { width: 11px; height: 11px; border-radius: 50%; }
        .v07-close { background: #FF5F57; }
        .v07-min   { background: #FEBC2E; }
        .v07-max   { background: #28C840; }
        .v07-title {
          position: absolute; left: 0; right: 0;
          text-align: center; font-size: 12px; font-weight: 500;
          color: #1d1d1f; pointer-events: none;
        }
        .v07-toolbar {
          height: 34px;
          background: linear-gradient(180deg,#DCDCDC,#D2D2D2);
          border-bottom: 1px solid rgba(0,0,0,0.10);
          display: flex; align-items: center; padding: 0 8px; gap: 6px;
        }
        .v07-path-bar {
          height: 22px;
          background: #F5F5F7;
          border-bottom: 1px solid rgba(0,0,0,0.07);
          display: flex; align-items: center;
          padding: 0 10px; gap: 3px;
          font-size: 10.5px; color: #6c6c70;
        }
        .v07-path-sep { color: #aaaaaf; }
        .v07-path-last { color: #1d1d1f; font-weight: 600; }
        .v07-col-head {
          height: 20px;
          background: #F9F9F9;
          border-bottom: 1px solid rgba(0,0,0,0.07);
          display: flex; align-items: center;
          padding: 0 8px;
          font-size: 10.5px; color: #6c6c70; font-weight: 500;
        }
        .v07-file-row {
          display: flex; align-items: center;
          height: 20px; padding: 0 8px;
          font-size: 11.5px; color: #1d1d1f;
          gap: 6px;
        }
        .v07-file-row.sel { background: #0066D9; color: #fff; }
        .v07-icon {
          width: 14px; height: 14px; flex-shrink: 0;
          border-radius: 2px; display: flex; align-items: center; justify-content: center;
          font-size: 9px;
        }
        .v07-icon-md   { background: #E5F3FF; color: #007AFF; }
        .v07-icon-xlsx { background: #E6F9EE; color: #34C759; }
        .v07-icon-pptx { background: #FFF0E5; color: #FF9500; }
        .v07-statusbar {
          height: 22px; background: #F9F9F9; border-top: 1px solid rgba(0,0,0,0.08);
          display: flex; align-items: center; justify-content: center;
          font-size: 10.5px; color: #6c6c70;
        }
      `;
      document.head.appendChild(style);

      /* ── build structure ── */
      const wrapper = document.createElement('div');
      wrapper.id = '__v07_finder';

      const win = document.createElement('div');
      win.className = 'v07-finder-win';

      // titlebar
      const tb = document.createElement('div');
      tb.className = 'v07-titlebar';
      const lights = document.createElement('div');
      lights.className = 'v07-lights';
      ['v07-close', 'v07-min', 'v07-max'].forEach((cls) => {
        const dot = document.createElement('div');
        dot.className = `v07-dot ${cls}`;
        lights.appendChild(dot);
      });
      const titleText = document.createElement('div');
      titleText.className = 'v07-title';
      titleText.textContent = 'Linterly';
      tb.appendChild(lights);
      tb.appendChild(titleText);
      win.appendChild(tb);

      // toolbar (just decorative)
      const toolbar = document.createElement('div');
      toolbar.className = 'v07-toolbar';
      win.appendChild(toolbar);

      // path bar
      const pathBar = document.createElement('div');
      pathBar.className = 'v07-path-bar';
      ['Users', ' > ', 'jameson', ' > ', 'Keepance', ' > '].forEach((s) => {
        const sp = document.createElement('span');
        sp.className = s.trim() === '>' ? 'v07-path-sep' : '';
        sp.textContent = s;
        pathBar.appendChild(sp);
      });
      const lastCrumb = document.createElement('span');
      lastCrumb.className = 'v07-path-last';
      lastCrumb.textContent = 'Linterly';
      pathBar.appendChild(lastCrumb);
      win.appendChild(pathBar);

      // column headers
      const colHead = document.createElement('div');
      colHead.className = 'v07-col-head';
      colHead.textContent = 'Name';
      win.appendChild(colHead);

      // file list
      const listWrap = document.createElement('div');
      listWrap.style.cssText = 'overflow:hidden;';

      const FILE_DEFS: Array<{ name: string; cls: string; label: string }> = [
        { name: 'Brand Voice.md',        cls: 'v07-icon-md',   label: 'MD' },
        { name: 'Customers.md',          cls: 'v07-icon-md',   label: 'MD' },
        { name: 'Founder Notes.md',      cls: 'v07-icon-md',   label: 'MD' },
        { name: 'Launch Plan.md',        cls: 'v07-icon-md',   label: 'MD' },
        { name: 'Pitch Deck.pptx',       cls: 'v07-icon-pptx', label: 'PPT' },
        { name: 'Pricing.md',            cls: 'v07-icon-md',   label: 'MD' },
        { name: 'Q1 Forecast.xlsx',      cls: 'v07-icon-xlsx', label: 'XLS' },
        { name: 'Vision.md',             cls: 'v07-icon-md',   label: 'MD' },
      ];

      FILE_DEFS.forEach(({ name, cls, label }) => {
        const row = document.createElement('div');
        row.className = `v07-file-row${name === 'Brand Voice.md' ? ' sel' : ''}`;
        const icon = document.createElement('div');
        icon.className = `v07-icon ${cls}`;
        icon.textContent = label;
        const nameEl = document.createElement('span');
        nameEl.textContent = name;
        nameEl.style.cssText = 'overflow:hidden;white-space:nowrap;text-overflow:ellipsis;';
        row.appendChild(icon);
        row.appendChild(nameEl);
        listWrap.appendChild(row);
      });
      win.appendChild(listWrap);

      // status bar
      const statusBar = document.createElement('div');
      statusBar.className = 'v07-statusbar';
      statusBar.textContent = '8 items, 142 KB on disk';
      win.appendChild(statusBar);

      wrapper.appendChild(win);
      document.body.appendChild(wrapper);
    },
    { fileNames: linterlyFixture.files.map((f) => f.name) },
  );
  await sleep(2000);
  beats.finderShown = elapsedSec();

  // ── t=7-12s: Hold both side-by-side ──
  await sleep(5000);
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
  const outPath = path.join(ASSETS_DIR, 'local-first.mp4');

  console.log('[V07] beats:', JSON.stringify(beats));

  // Camera stays wide so both Keepance (left) and Finder (right) are visible
  // when the Finder slides in.
  const shots: CameraShot[] = [
    { tSec: 0,                         crop: wideCrop(), label: 'wide' },
    { tSec: (beats.end ?? 12),         crop: wideCrop(), label: 'hold-end' },
  ];

  const captions: Caption[] = [
    { startSec: (beats.fileAppeared ?? 3) + 0.2, endSec: (beats.finderShown ?? 6) - 0.2, text: 'When the AI creates a file…' },
    { startSec: (beats.finderShown ?? 6) + 0.4,  endSec: (beats.end ?? 12) - 0.2, text: '…it’s a real file on your disk' },
  ];

  const PRE_ROLL_SEC = 0.4;
  const trimSec = Math.max(0, (beats.heroSettled ?? 2) - 0.5 - PRE_ROLL_SEC);

  await renderCinematic({ webmPath, chromePngPath: CHROME_PNG, outPath, shots, captions, trimSec, videoTitle: 'See your AI files on your own disk' });

  mkdirSync(PRESS_KIT_DIR, { recursive: true });
  copyFileSync(outPath, path.join(PRESS_KIT_DIR, 'local-first.mp4'));
  console.log(`✓ press-kit copy → ${path.join(PRESS_KIT_DIR, 'local-first.mp4')}`);
  return outPath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  video07().catch((e) => { console.error(e); process.exit(1); });
}
