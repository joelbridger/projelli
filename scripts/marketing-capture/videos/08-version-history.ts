/**
 * V08 — Version history (18s)
 *
 * Shows edit → history → preview → restore.
 *
 * Timing:
 *   t=0-2s:  Vision.md open with edit cursor
 *   t=2-5s:  Type a small edit visible to the camera
 *   t=5-7s:  Click history icon / inject history panel
 *   t=7-12s: Side panel shows version timeline with timestamps
 *   t=12-15s: Click an older version → preview shows diff
 *   t=15-17s: Click "Restore" button
 *   t=17-18s: Editor shows restored content
 *
 * Version history UI likely needs DOM injection.
 */

import { chromium } from 'playwright';
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
const VIDEO_TMP = path.resolve(HERE, '../.tmp/video-08');
const ROOT = linterlyFixture.rootPath;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const ORIGINAL_VISION = linterlyFixture.fileContents['Vision.md'] ?? '';
const EDITED_VISION = ORIGINAL_VISION + '\n\n*This is the future of founder writing.*';

export async function video08() {
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

  // ── t=0-2s: Vision.md open ──
  await seedState(page, linterlyFixture, 'wikiLinks');
  // Switch to single-pane without backlinks for this video
  await page.evaluate(
    ({ rootPath, content }) => {
      (window as any).__keepance_seed!({
        editor: {
          openTabs: [{ path: `${rootPath}/Vision.md`, name: 'Vision.md', content, isDirty: false, type: 'file' }],
          activeTabPath: `${rootPath}/Vision.md`,
          showBacklinks: false,
        },
      });
    },
    { rootPath: ROOT, content: ORIGINAL_VISION },
  );
  await sleep(2000);
  beats.editStart = elapsedSec();

  // ── t=2-5s: Type a visible edit into the editor ──
  const editorEl = page.locator('.cm-content, .cm-editor');
  const editorBB = await editorEl.first().boundingBox({ timeout: 1000 }).catch(() => null);
  if (editorBB) {
    await page.mouse.move(editorBB.x + editorBB.width / 2, editorBB.y + editorBB.height - 60, { steps: 8 });
    await page.mouse.click(editorBB.x + editorBB.width / 2, editorBB.y + editorBB.height - 60);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('This is the future of founder writing.', { delay: 60 });
  } else {
    // Seed the edited content directly
    await page.evaluate(
      ({ rootPath, content }) => {
        (window as any).__keepance_seed!({
          editor: {
            openTabs: [{ path: `${rootPath}/Vision.md`, name: 'Vision.md', content, isDirty: true, type: 'file' }],
            activeTabPath: `${rootPath}/Vision.md`,
          },
        });
      },
      { rootPath: ROOT, content: EDITED_VISION },
    );
  }
  await sleep(3000);

  // ── t=5-7s: Open history panel ──
  // Try clicking history icon in status bar / toolbar
  const historyBtn = page.locator('[data-testid="history-btn"], [data-testid="version-history"], [title*="history" i], [aria-label*="history" i]');
  const histBtnBB = await historyBtn.first().boundingBox({ timeout: 1000 }).catch(() => null);
  if (histBtnBB) {
    await page.mouse.move(histBtnBB.x + histBtnBB.width / 2, histBtnBB.y + histBtnBB.height / 2, { steps: 8 });
    await page.mouse.click(histBtnBB.x + histBtnBB.width / 2, histBtnBB.y + histBtnBB.height / 2);
    await sleep(500);
  }
  // Always inject a polished history panel (may replace real one)
  await page.evaluate(() => {
    if (document.getElementById('__v08_history_panel')) return;

    const style = document.createElement('style');
    style.id = '__v08_hist_style';
    style.textContent = `
      #__v08_history_panel {
        position: fixed;
        top: 52px; right: 0;
        width: 280px;
        bottom: 0;
        z-index: 150;
        background: var(--card, #181820);
        border-left: 1px solid rgba(255,255,255,0.08);
        display: flex; flex-direction: column;
        font-family: -apple-system, "SF Pro Text", system-ui, sans-serif;
        animation: __v08slideIn 0.3s ease forwards;
      }
      @keyframes __v08slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to   { transform: translateX(0);    opacity: 1; }
      }
      .v08-hist-header {
        height: 42px; display: flex; align-items: center;
        padding: 0 14px; border-bottom: 1px solid rgba(255,255,255,0.07);
        font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.85);
        flex-shrink: 0; gap: 6px;
      }
      .v08-hist-header-icon {
        font-size: 14px; opacity: 0.6;
      }
      .v08-version-list {
        flex: 1; overflow-y: auto; padding: 6px 0;
      }
      .v08-version-item {
        padding: 10px 14px; cursor: pointer;
        border-left: 3px solid transparent;
        transition: background 0.1s;
      }
      .v08-version-item:hover { background: rgba(255,255,255,0.04); }
      .v08-version-item.selected {
        border-left-color: #007AFF;
        background: rgba(0,122,255,0.08);
      }
      .v08-version-item.current {
        border-left-color: rgba(255,255,255,0.2);
      }
      .v08-ver-time {
        font-size: 12px; font-weight: 600;
        color: rgba(255,255,255,0.8); margin-bottom: 2px;
      }
      .v08-ver-label {
        font-size: 11px; color: rgba(255,255,255,0.4);
      }
      .v08-ver-badge {
        display: inline-block; font-size: 10px; font-weight: 600;
        padding: 1px 6px; border-radius: 3px; margin-left: 6px;
      }
      .v08-ver-badge-current {
        background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.6);
      }
      .v08-ver-badge-restore {
        background: rgba(52,199,89,0.15); color: #34C759;
      }
      .v08-hist-footer {
        padding: 10px 14px; border-top: 1px solid rgba(255,255,255,0.07);
        display: flex; gap: 8px; flex-shrink: 0;
      }
      .v08-restore-btn {
        flex: 1; padding: 7px 0; border-radius: 6px;
        background: #007AFF; color: #fff;
        font-size: 12px; font-weight: 600; border: none; cursor: pointer;
      }
      .v08-cancel-btn {
        padding: 7px 12px; border-radius: 6px;
        background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.6);
        font-size: 12px; font-weight: 500; border: none; cursor: pointer;
      }
    `;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = '__v08_history_panel';

    const header = document.createElement('div');
    header.className = 'v08-hist-header';
    const hIcon = document.createElement('span');
    hIcon.className = 'v08-hist-header-icon';
    hIcon.textContent = '🕐';
    const hTitle = document.createElement('span');
    hTitle.textContent = 'Version History';
    header.appendChild(hIcon);
    header.appendChild(hTitle);
    panel.appendChild(header);

    const vList = document.createElement('div');
    vList.className = 'v08-version-list';

    const versions = [
      { time: 'Just now', label: '38 words', current: true, selected: false },
      { time: '4 min ago', label: '32 words', current: false, selected: true },
      { time: '12 min ago', label: '28 words', current: false, selected: false },
      { time: '1 hour ago', label: '21 words', current: false, selected: false },
      { time: 'Yesterday 6:40 PM', label: '18 words (initial)', current: false, selected: false },
    ];

    for (const v of versions) {
      const item = document.createElement('div');
      item.className = `v08-version-item${v.current ? ' current' : ''}${v.selected ? ' selected' : ''}`;
      if (v.selected) item.id = '__v08_old_version';
      const timeEl = document.createElement('div');
      timeEl.className = 'v08-ver-time';
      timeEl.textContent = v.time;
      if (v.current) {
        const badge = document.createElement('span');
        badge.className = 'v08-ver-badge v08-ver-badge-current';
        badge.textContent = 'current';
        timeEl.appendChild(badge);
      }
      const labelEl = document.createElement('div');
      labelEl.className = 'v08-ver-label';
      labelEl.textContent = v.label;
      item.appendChild(timeEl);
      item.appendChild(labelEl);
      vList.appendChild(item);
    }
    panel.appendChild(vList);

    const footer = document.createElement('div');
    footer.className = 'v08-hist-footer';
    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'v08-restore-btn';
    restoreBtn.id = '__v08_restore_btn';
    restoreBtn.textContent = 'Restore this version';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'v08-cancel-btn';
    cancelBtn.textContent = 'Cancel';
    footer.appendChild(restoreBtn);
    footer.appendChild(cancelBtn);
    panel.appendChild(footer);

    document.body.appendChild(panel);
  });
  await sleep(2000);
  beats.historyShown = elapsedSec();

  // ── t=7-12s: Hold history panel ──
  await sleep(5000);

  // ── t=12-15s: Click the selected (older) version ──
  const oldVersion = page.locator('#__v08_old_version');
  const oldVerBB = await oldVersion.first().boundingBox({ timeout: 1000 }).catch(() => null);
  if (oldVerBB) {
    await page.mouse.move(oldVerBB.x + oldVerBB.width / 2, oldVerBB.y + oldVerBB.height / 2, { steps: 8 });
    await page.mouse.click(oldVerBB.x + oldVerBB.width / 2, oldVerBB.y + oldVerBB.height / 2);
  }
  // Show the diff/preview — seed the editor with older content visible
  await page.evaluate(
    ({ rootPath, content }) => {
      (window as any).__keepance_seed!({
        editor: {
          openTabs: [{ path: `${rootPath}/Vision.md`, name: 'Vision.md', content, isDirty: false, type: 'file' }],
          activeTabPath: `${rootPath}/Vision.md`,
        },
      });
    },
    { rootPath: ROOT, content: ORIGINAL_VISION },
  );
  await sleep(3000);
  beats.previewShown = elapsedSec();

  // ── t=15-17s: Click "Restore" ──
  const restoreBtn = page.locator('#__v08_restore_btn');
  const restoreBB = await restoreBtn.first().boundingBox({ timeout: 1000 }).catch(() => null);
  if (restoreBB) {
    await page.mouse.move(restoreBB.x + restoreBB.width / 2, restoreBB.y + restoreBB.height / 2, { steps: 8 });
    await page.mouse.click(restoreBB.x + restoreBB.width / 2, restoreBB.y + restoreBB.height / 2);
  }
  // Remove history panel, show "Restored" toast
  await page.evaluate(() => {
    const panel = document.getElementById('__v08_history_panel');
    if (panel) panel.remove();
    const style = document.getElementById('__v08_hist_style');
    if (style) style.remove();

    // Toast notification
    const toast = document.createElement('div');
    toast.id = '__v08_toast';
    toast.style.cssText = [
      'position:fixed',
      'bottom:24px',
      'left:50%',
      'transform:translateX(-50%)',
      'background:#1c1c28',
      'border:1px solid rgba(52,199,89,0.4)',
      'border-radius:8px',
      'padding:10px 18px',
      'font-family:-apple-system,SF Pro Text,system-ui,sans-serif',
      'font-size:13px',
      'font-weight:600',
      'color:#34C759',
      'z-index:500',
      'box-shadow:0 4px 16px rgba(0,0,0,0.4)',
      'animation:__v08toastin 0.3s ease forwards',
    ].join(';');
    toast.textContent = '✓ Restored to version from 4 min ago';

    const toastStyle = document.createElement('style');
    toastStyle.textContent = '@keyframes __v08toastin { from{opacity:0;transform:translateX(-50%) translateY(8px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }';
    document.head.appendChild(toastStyle);
    document.body.appendChild(toast);
  });
  await sleep(2000);
  beats.restoredShown = elapsedSec();

  // ── t=17-18s: Hold restored state ──
  await sleep(1500);
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
  const outPath = path.join(ASSETS_DIR, 'version-history.mp4');

  console.log('[V08] beats:', JSON.stringify(beats));

  // Camera focuses on editor for the edit, then pulls wide to show the
  // history panel sliding in on the right.
  const editorOnlyFocus: { x: number; y: number; w: number; h: number } = { x: 200, y: 80, w: 1300, h: 743 };
  const wideShowingHistory = wideCrop();

  const shots: CameraShot[] = [
    { tSec: 0,                                   crop: editorOnlyFocus,    label: 'editor' },
    { tSec: (beats.historyShown ?? 7),           crop: wideShowingHistory, label: 'history-wide' },
    { tSec: (beats.end ?? 18),                   crop: wideShowingHistory, label: 'hold-end' },
  ];

  const captions: Caption[] = [
    { startSec: (beats.editStart ?? 2) + 0.4, endSec: (beats.historyShown ?? 7) - 0.3, text: 'Every save is snapshotted' },
    { startSec: (beats.historyShown ?? 7) + 0.4, endSec: (beats.previewShown ?? 12) - 0.3, text: 'Browse the whole timeline' },
    { startSec: (beats.previewShown ?? 12) + 0.4, endSec: (beats.end ?? 18) - 0.2, text: 'Restore any version' },
  ];

  const PRE_ROLL_SEC = 0.4;
  const trimSec = Math.max(0, (beats.editStart ?? 2) - 0.5 - PRE_ROLL_SEC);

  await renderCinematic({ webmPath, chromePngPath: CHROME_PNG, outPath, shots, captions, trimSec, videoTitle: 'Roll back to any older version' });

  mkdirSync(PRESS_KIT_DIR, { recursive: true });
  copyFileSync(outPath, path.join(PRESS_KIT_DIR, 'version-history.mp4'));
  console.log(`✓ press-kit copy → ${path.join(PRESS_KIT_DIR, 'version-history.mp4')}`);
  return outPath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  video08().catch((e) => { console.error(e); process.exit(1); });
}
