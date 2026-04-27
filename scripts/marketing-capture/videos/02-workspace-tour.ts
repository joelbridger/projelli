/**
 * V02 — Workspace tour (25s)
 *
 * Tours the 3-pane workspace: file tree on the left, editor in the center.
 * Shows clicking through files and then a split-pane view.
 *
 * Timing:
 *   t=0-2s:  Workspace hero state (Launch Plan.md open)
 *   t=2-5s:  Click Vision.md in file tree → editor switches
 *   t=5-8s:  Click Pricing.md → editor switches
 *   t=8-13s: Inject split-pane view (Launch Plan.md + Pricing.md side by side)
 *   t=13-19s: Hold split view
 *   t=19-22s: Collapse to single pane (Pricing.md)
 *   t=22-25s: Hold final state
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

/** Click a file tree item by name, falling back to a seed mutation. */
async function clickFile(page: Page, fileName: string) {
  // Try real click on the file tree item — use a 1s timeout to avoid 30s auto-wait
  const item = page.locator('[data-testid="file-tree-item"]').filter({ hasText: fileName });
  const bb = await item.first().boundingBox({ timeout: 1000 }).catch(() => null);
  if (bb) {
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 10 });
    await sleep(100);
    await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
  } else {
    // Fall back: seed editor directly
    await page.evaluate(
      ({ rootPath, fileName, content }) => {
        (window as any).__projelli_seed!({
          editor: {
            openTabs: [{ path: `${rootPath}/${fileName}`, name: fileName, content, isDirty: false, type: 'file' }],
            activeTabPath: `${rootPath}/${fileName}`,
            showBacklinks: false,
          },
          workspace: { selectedPath: `${rootPath}/${fileName}` },
        });
      },
      {
        rootPath: ROOT,
        fileName,
        content: linterlyFixture.fileContents[fileName] ?? '',
      },
    );
  }
}

export async function video02() {
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

  // ── t=0-2s: Workspace hero state ──
  await seedState(page, linterlyFixture, 'workspaceHero');
  await sleep(2000);

  // ── t=2-5s: Click Vision.md in file tree ──
  await clickFile(page, 'Vision.md');
  await sleep(3000);

  // ── t=5-8s: Click Pricing.md ──
  await clickFile(page, 'Pricing.md');
  await sleep(3000);

  // ── t=8-13s: Inject split view with two panes ──
  // Try to trigger the real split via editorStore; if not supported, inject a DOM overlay
  const splitSeeded = await page.evaluate(
    ({ rootPath, content1, content2 }) => {
      const seed = (window as any).__projelli_seed;
      if (!seed) return false;
      seed({
        editor: {
          openTabs: [
            { path: `${rootPath}/Launch Plan.md`, name: 'Launch Plan.md', content: content1, isDirty: false, type: 'file' },
            { path: `${rootPath}/Pricing.md`,     name: 'Pricing.md',     content: content2, isDirty: false, type: 'file' },
          ],
          activeTabPath: `${rootPath}/Pricing.md`,
          splitPane: {
            enabled: true,
            leftTabPath: `${rootPath}/Launch Plan.md`,
            rightTabPath: `${rootPath}/Pricing.md`,
          },
          showBacklinks: false,
        },
      });
      return true;
    },
    {
      rootPath: ROOT,
      content1: linterlyFixture.fileContents['Launch Plan.md'] ?? '',
      content2: linterlyFixture.fileContents['Pricing.md'] ?? '',
    },
  );

  if (!splitSeeded) {
    // Inject a visual split-pane overlay so the video shows the concept
    await page.evaluate(
      ({ content1, content2 }) => {
        const mainEl = document.querySelector('[data-testid="main-panel"]') ??
          document.querySelector('.flex-1') ??
          document.body;

        if (document.getElementById('__v02_split_overlay')) return;

        const overlay = document.createElement('div');
        overlay.id = '__v02_split_overlay';
        overlay.style.cssText = [
          'position:fixed',
          'inset:0',
          'display:flex',
          'z-index:50',
          'background:#1a1a1a',
          'pointer-events:none',
        ].join(';');

        const paneStyle = [
          'flex:1',
          'display:flex',
          'flex-direction:column',
          'overflow:hidden',
          'background:var(--background,#1e1e2e)',
          'border:1px solid rgba(255,255,255,0.08)',
        ].join(';');

        const makePane = (title: string, content: string) => {
          const pane = document.createElement('div');
          pane.style.cssText = paneStyle;
          const header = document.createElement('div');
          header.style.cssText = 'height:36px;background:rgba(255,255,255,0.04);display:flex;align-items:center;padding:0 12px;font-size:13px;font-weight:500;color:rgba(255,255,255,0.7);border-bottom:1px solid rgba(255,255,255,0.06);';
          header.textContent = title;
          const body = document.createElement('pre');
          body.style.cssText = 'flex:1;margin:0;padding:16px;font-family:"SF Mono",ui-monospace,monospace;font-size:12px;line-height:1.6;color:rgba(255,255,255,0.85);overflow:hidden;white-space:pre-wrap;word-break:break-word;';
          body.textContent = content;
          pane.appendChild(header);
          pane.appendChild(body);
          return pane;
        };

        const divider = document.createElement('div');
        divider.style.cssText = 'width:1px;background:rgba(255,255,255,0.10);flex-shrink:0;';

        overlay.appendChild(makePane('Launch Plan.md', content1));
        overlay.appendChild(divider);
        overlay.appendChild(makePane('Pricing.md', content2));
        document.body.appendChild(overlay);
      },
      {
        content1: linterlyFixture.fileContents['Launch Plan.md'] ?? '',
        content2: linterlyFixture.fileContents['Pricing.md'] ?? '',
      },
    );
  }
  await sleep(5000);

  // ── t=13-19s: Hold split view ──
  await sleep(6000);

  // ── t=19-22s: Collapse split (remove overlay, go back to single pane) ──
  await page.evaluate(() => {
    const overlay = document.getElementById('__v02_split_overlay');
    if (overlay) overlay.remove();
  });
  // Seed back to single pane, Pricing.md active
  await page.evaluate(
    ({ rootPath, content }) => {
      (window as any).__projelli_seed!({
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

  // ── t=22-25s: Hold final state ──
  await sleep(3000);

  await page.close();
  await context.close();
  await browser.close();

  const webm = readdirSync(VIDEO_TMP).find((f) => f.endsWith('.webm'));
  if (!webm) throw new Error('No .webm produced by Playwright recordVideo');
  const webmPath = path.join(VIDEO_TMP, webm);

  mkdirSync(ASSETS_DIR, { recursive: true });
  const outPath = path.join(ASSETS_DIR, 'workspace-tour.mp4');

  // Determine how much load time to skip (first ~8s is page load + seed wait).
  // We trim from the first "content ready" frame to the end, keeping ~25s of demo.
  // Use ffprobe to get total duration, then skip = duration - 25s (but at least 0).
  const rawDurationStr = execFileSync('ffprobe', [
    '-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', webmPath,
  ], { encoding: 'utf-8' }).trim();
  const rawDuration = parseFloat(rawDurationStr);
  const TARGET_DURATION = 25;
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
  copyFileSync(outPath, path.join(PRESS_KIT_DIR, 'workspace-tour.mp4'));
  console.log(`✓ ${outPath}`);
  return outPath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  video02().catch((e) => { console.error(e); process.exit(1); });
}
