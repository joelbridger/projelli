/**
 * V03 — Wiki-links (15s)
 *
 * Shows wiki-link autocompletion + navigation in the editor.
 *
 * Timing:
 *   t=0-2s:  Vision.md open in editor (wikiLinks shot)
 *   t=2-5s:  Editor gains focus, type " See also [["
 *   t=5-8s:  Autocomplete popover appears with file suggestions (DOM injection)
 *   t=8-10s: Click "Customers" suggestion → editor inserts [[Customers]]
 *   t=10-13s: Click the inserted link → navigate to Customers.md
 *   t=13-15s: Hold on Customers.md
 *
 * The autocompletion popover is injected via DOM since CodeMirror completions
 * are hard to drive deterministically in browser mode.
 */

import { chromium } from 'playwright';
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

export async function video03() {
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

  // ── t=0-2s: Vision.md open, backlinks panel visible ──
  await seedState(page, linterlyFixture, 'wikiLinks');
  await sleep(2000);

  // ── t=2-5s: Type " See also [[" into the editor ──
  // Try to click the editor first, then type. If the editor isn't clickable, seed text.
  const editorEl = page.locator('.cm-content, [data-testid="markdown-editor"] .cm-editor, .cm-editor');
  const editorBB = await editorEl.first().boundingBox({ timeout: 1000 }).catch(() => null);
  if (editorBB) {
    // Click near the end of the content area
    await page.mouse.move(editorBB.x + editorBB.width / 2, editorBB.y + editorBB.height - 40, { steps: 8 });
    await page.mouse.click(editorBB.x + editorBB.width / 2, editorBB.y + editorBB.height - 40);
    await sleep(300);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type(' See also [[', { delay: 80 });
  } else {
    // Seed the editor text directly
    await page.evaluate(
      ({ rootPath, content }) => {
        (window as any).__projelli_seed!({
          editor: {
            openTabs: [{ path: `${rootPath}/Vision.md`, name: 'Vision.md', content, isDirty: false, type: 'file' }],
            activeTabPath: `${rootPath}/Vision.md`,
            showBacklinks: true,
          },
        });
      },
      {
        rootPath: ROOT,
        content: (linterlyFixture.fileContents['Vision.md'] ?? '') + '\n\n See also [[',
      },
    );
  }
  await sleep(3000);

  // ── t=5-8s: Inject autocomplete popover ──
  // Position it just below and right of where the cursor would be (roughly center of editor)
  await page.evaluate(() => {
    if (document.getElementById('__v03_autocomplete')) return;

    const style = document.createElement('style');
    style.id = '__v03_ac_style';
    style.textContent = `
      #__v03_autocomplete {
        position: fixed;
        left: 50%;
        top: 55%;
        transform: translate(-20px, 0);
        z-index: 9999;
        background: var(--popover, #1e2030);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 8px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        min-width: 220px;
        overflow: hidden;
        font-family: -apple-system, "SF Pro Text", system-ui, sans-serif;
        font-size: 13px;
        animation: __v03fadeIn 0.2s ease forwards;
      }
      @keyframes __v03fadeIn {
        from { opacity: 0; transform: translate(-20px, -4px); }
        to   { opacity: 1; transform: translate(-20px, 0); }
      }
      .v03-ac-header {
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(255,255,255,0.35);
        padding: 6px 10px 2px;
      }
      .v03-ac-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        cursor: pointer;
        color: rgba(255,255,255,0.85);
        transition: background 0.1s;
      }
      .v03-ac-item.active {
        background: rgba(0,122,255,0.2);
        color: #fff;
      }
      .v03-ac-item:hover { background: rgba(255,255,255,0.06); }
      .v03-ac-icon {
        width: 18px; height: 18px;
        border-radius: 3px;
        background: rgba(255,255,255,0.08);
        display: flex; align-items: center; justify-content: center;
        font-size: 10px; color: rgba(255,255,255,0.5);
        flex-shrink: 0;
      }
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

  // ── t=8-10s: Click the "Customers" suggestion ──
  const suggestion = page.locator('#__v03_customers_option');
  const suggBB = await suggestion.first().boundingBox({ timeout: 1000 }).catch(() => null);
  if (suggBB) {
    await page.mouse.move(suggBB.x + suggBB.width / 2, suggBB.y + suggBB.height / 2, { steps: 8 });
    await page.mouse.click(suggBB.x + suggBB.width / 2, suggBB.y + suggBB.height / 2);
  }
  // Remove the popup and seed the editor with the inserted link
  await page.evaluate(
    ({ rootPath, content }) => {
      const popup = document.getElementById('__v03_autocomplete');
      if (popup) popup.remove();
      const style = document.getElementById('__v03_ac_style');
      if (style) style.remove();
      // Seed Vision.md with [[Customers]] inserted
      (window as any).__projelli_seed!({
        editor: {
          openTabs: [{ path: `${rootPath}/Vision.md`, name: 'Vision.md', content, isDirty: false, type: 'file' }],
          activeTabPath: `${rootPath}/Vision.md`,
          showBacklinks: true,
        },
      });
    },
    {
      rootPath: ROOT,
      content: (linterlyFixture.fileContents['Vision.md'] ?? '') + '\n\n See also [[Customers]]',
    },
  );
  await sleep(2000);

  // ── t=10-13s: Navigate to Customers.md (simulate clicking the wiki link) ──
  // Try clicking a wikilink in the editor; fall back to seeding Customers.md directly.
  const wikiLink = page.locator('.cm-content a, .wiki-link, [data-type="wikilink"]').first();
  const wlBB = await wikiLink.first().boundingBox({ timeout: 1000 }).catch(() => null);
  if (wlBB) {
    await page.mouse.move(wlBB.x + wlBB.width / 2, wlBB.y + wlBB.height / 2, { steps: 8 });
    await page.mouse.click(wlBB.x + wlBB.width / 2, wlBB.y + wlBB.height / 2);
  } else {
    // Seed Customers.md as active
    await page.evaluate(
      ({ rootPath, content }) => {
        (window as any).__projelli_seed!({
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
  }
  await sleep(3000);

  // ── t=13-15s: Hold on Customers.md ──
  await sleep(2000);

  await page.close();
  await context.close();
  await browser.close();

  const webm = readdirSync(VIDEO_TMP).find((f) => f.endsWith('.webm'));
  if (!webm) throw new Error('No .webm produced by Playwright recordVideo');
  const webmPath = path.join(VIDEO_TMP, webm);

  const rawDurationStr = execFileSync('ffprobe', [
    '-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', webmPath,
  ], { encoding: 'utf-8' }).trim();
  const rawDuration = parseFloat(rawDurationStr);
  const TARGET_DURATION = 15;
  const skipSeconds = Math.max(0, rawDuration - TARGET_DURATION);

  mkdirSync(ASSETS_DIR, { recursive: true });
  const outPath = path.join(ASSETS_DIR, 'wiki-links.mp4');

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
  copyFileSync(outPath, path.join(PRESS_KIT_DIR, 'wiki-links.mp4'));
  console.log(`✓ ${outPath}`);
  return outPath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  video03().catch((e) => { console.error(e); process.exit(1); });
}
