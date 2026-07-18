/**
 * V03 — Wiki-links (15s) with captions + auto-camera.
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
const VIDEO_TMP = path.resolve(HERE, '../.tmp/video-03');
const ROOT = linterlyFixture.rootPath;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function video03() {
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

  await seedState(page, linterlyFixture, 'wikiLinks');
  await sleep(1500);
  beats.heroSettled = elapsedSec();

  // Editor focus rect for camera.
  const editorRect = await page.evaluate(() => {
    const el = document.querySelector('.cm-editor, [data-testid="markdown-editor"]') as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }).catch(() => null);

  // Type into editor
  beats.typingStart = elapsedSec();
  const editorEl = page.locator('.cm-content, [data-testid="markdown-editor"] .cm-editor, .cm-editor');
  const editorBB = await editorEl.first().boundingBox({ timeout: 1000 }).catch(() => null);
  if (editorBB) {
    await page.mouse.move(editorBB.x + editorBB.width / 2, editorBB.y + editorBB.height - 40, { steps: 8 });
    await page.mouse.click(editorBB.x + editorBB.width / 2, editorBB.y + editorBB.height - 40);
    await sleep(300);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type(' See also [[', { delay: 80 });
  } else {
    await page.evaluate(
      ({ rootPath, content }) => {
        (window as any).__keepance_seed!({
          editor: {
            openTabs: [{ path: `${rootPath}/Vision.md`, name: 'Vision.md', content, isDirty: false, type: 'file' }],
            activeTabPath: `${rootPath}/Vision.md`,
            showBacklinks: true,
          },
        });
      },
      { rootPath: ROOT, content: (linterlyFixture.fileContents['Vision.md'] ?? '') + '\n\n See also [[' },
    );
  }
  await sleep(1500);

  // Inject autocomplete popover
  beats.popoverShown = elapsedSec();
  await page.evaluate(() => {
    if (document.getElementById('__v03_autocomplete')) return;
    const style = document.createElement('style');
    style.id = '__v03_ac_style';
    style.textContent = `
      #__v03_autocomplete {
        position: fixed; left: 50%; top: 55%; transform: translate(-20px, 0);
        z-index: 9999; background: #ffffff;
        border: 1px solid rgba(15,23,42,0.12); border-radius: 10px;
        box-shadow: 0 8px 24px rgba(15,23,42,0.18);
        min-width: 240px; overflow: hidden;
        font-family: -apple-system, "SF Pro Text", system-ui, sans-serif; font-size: 13px;
      }
      .v03-ac-header { font-size: 10px; font-weight: 600; letter-spacing: 0.06em;
        text-transform: uppercase; color: #64748b; padding: 8px 12px 4px; }
      .v03-ac-item { display: flex; align-items: center; gap: 10px;
        padding: 8px 12px; cursor: pointer; color: #111F35; }
      .v03-ac-item.active { background: rgba(255,124,110,0.14); color: #111F35; }
      .v03-ac-icon { width: 18px; height: 18px; border-radius: 4px;
        background: rgba(15,23,42,0.06); display: flex; align-items: center; justify-content: center;
        font-size: 10px; color: #64748b; flex-shrink: 0; }
    `;
    document.head.appendChild(style);
    const popup = document.createElement('div');
    popup.id = '__v03_autocomplete';
    const header = document.createElement('div');
    header.className = 'v03-ac-header';
    header.textContent = 'Link to file';
    popup.appendChild(header);
    const suggestions = [
      { name: 'Customers.md', active: true },
      { name: 'Competitive Analysis.md', active: false },
      { name: 'Brand Voice.md', active: false },
      { name: 'Pricing.md', active: false },
    ];
    for (const s of suggestions) {
      const item = document.createElement('div');
      item.className = `v03-ac-item${s.active ? ' active' : ''}`;
      item.id = s.active ? '__v03_customers_option' : '';
      const icon = document.createElement('div');
      icon.className = 'v03-ac-icon';
      icon.textContent = '#';
      const label = document.createElement('span');
      label.textContent = s.name.replace(/\.md$/, '');
      item.appendChild(icon);
      item.appendChild(label);
      popup.appendChild(item);
    }
    document.body.appendChild(popup);
  });
  await sleep(3000);

  // Click Customers suggestion
  beats.linkInserted = elapsedSec();
  const suggestion = page.locator('#__v03_customers_option');
  const suggBB = await suggestion.first().boundingBox({ timeout: 1000 }).catch(() => null);
  if (suggBB) {
    await page.mouse.move(suggBB.x + suggBB.width / 2, suggBB.y + suggBB.height / 2, { steps: 8 });
    await page.mouse.click(suggBB.x + suggBB.width / 2, suggBB.y + suggBB.height / 2);
  }
  await page.evaluate(
    ({ rootPath, content }) => {
      const popup = document.getElementById('__v03_autocomplete');
      if (popup) popup.remove();
      const style = document.getElementById('__v03_ac_style');
      if (style) style.remove();
      (window as any).__keepance_seed!({
        editor: {
          openTabs: [{ path: `${rootPath}/Vision.md`, name: 'Vision.md', content, isDirty: false, type: 'file' }],
          activeTabPath: `${rootPath}/Vision.md`,
          showBacklinks: true,
        },
      });
    },
    { rootPath: ROOT, content: (linterlyFixture.fileContents['Vision.md'] ?? '') + '\n\n See also [[Customers]]' },
  );
  await sleep(2000);

  // Navigate to Customers.md
  beats.navigated = elapsedSec();
  await page.evaluate(
    ({ rootPath, content }) => {
      (window as any).__keepance_seed!({
        editor: {
          openTabs: [
            { path: `${rootPath}/Vision.md`,    name: 'Vision.md',    content: '', isDirty: false, type: 'file' },
            { path: `${rootPath}/Customers.md`, name: 'Customers.md', content, isDirty: false, type: 'file' },
          ],
          activeTabPath: `${rootPath}/Customers.md`,
          showBacklinks: false,
        },
        workspace: { selectedPath: `${rootPath}/Customers.md` },
      });
    },
    { rootPath: ROOT, content: linterlyFixture.fileContents['Customers.md'] ?? '' },
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
  if (webms.length === 0) throw new Error('No .webm produced');
  const webmPath = path.join(VIDEO_TMP, webms[0]!.f);

  mkdirSync(ASSETS_DIR, { recursive: true });
  const outPath = path.join(ASSETS_DIR, 'wiki-links.mp4');

  console.log('[V03] beats:', JSON.stringify(beats));

  const editorFocus = focusOn([editorRect], { minWidth: 1300, pad: 30 });
  // Popover sits at viewport center; use a center-focused crop for the popover beat.
  const centerFocus: { x: number; y: number; w: number; h: number } = { x: 280, y: 200, w: 1300, h: 743 };

  const shots: CameraShot[] = [
    { tSec: 0,                                      crop: editorFocus,   label: 'editor' },
    { tSec: (beats.popoverShown ?? 5) - 0.3,        crop: centerFocus,   label: 'popover' },
    { tSec: (beats.linkInserted ?? 8) + 0.3,        crop: editorFocus,   label: 'inserted' },
    { tSec: (beats.navigated ?? 11) + 0.3,          crop: editorFocus,   label: 'navigated' },
    { tSec: (beats.end ?? 14),                      crop: editorFocus,   label: 'hold-end' },
  ];

  const captions: Caption[] = [
    { startSec: (beats.typingStart ?? 2) + 0.2, endSec: (beats.popoverShown ?? 5) - 0.3, text: 'Type [[ to link any file' },
    { startSec: (beats.popoverShown ?? 5) + 0.3, endSec: (beats.linkInserted ?? 8) - 0.2, text: 'Pick from your whole workspace' },
    { startSec: (beats.navigated ?? 11) + 0.3, endSec: (beats.end ?? 14) - 0.2, text: 'Click the link to jump there' },
  ];

  const PRE_ROLL_SEC = 0.4;
  const trimSec = Math.max(0, (beats.heroSettled ?? 1.5) - PRE_ROLL_SEC);

  await renderCinematic({ webmPath, chromePngPath: CHROME_PNG, outPath, shots, captions, trimSec, videoTitle: 'Link any note in two keystrokes' });

  mkdirSync(PRESS_KIT_DIR, { recursive: true });
  copyFileSync(outPath, path.join(PRESS_KIT_DIR, 'wiki-links.mp4'));
  console.log(`✓ press-kit copy → ${path.join(PRESS_KIT_DIR, 'wiki-links.mp4')}`);
  return outPath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  video03().catch((e) => { console.error(e); process.exit(1); });
}
