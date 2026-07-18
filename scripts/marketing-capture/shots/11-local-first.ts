/**
 * S11 — Local-first with Finder overlay
 *
 * Goal: Workspace screenshot with a fake macOS Finder window overlaid
 * in the bottom-right corner showing the same files on disk. Reinforces
 * the "your data stays on your machine" message.
 */

import { chromium } from 'playwright';
import { withBrowserLaunchOptions } from '../../browser-launch.mjs';
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureStill } from '../lib/capture-still';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(HERE, '../../../Assets/marketing');
const FINDER_HTML = path.resolve(HERE, '../chrome-template/finder-overlay.html');

/**
 * Render the Finder HTML at 2x DPI and return the PNG buffer.
 * Finder widget is 540×392 logical pixels (titlebar 28 + toolbar 38 + body + statusbar).
 */
async function renderFinder(): Promise<Buffer> {
  const browser = await chromium.launch(withBrowserLaunchOptions());
  try {
    const page = await browser.newPage({
      viewport: { width: 540, height: 392 },
      deviceScaleFactor: 2,
    });
    await page.setContent(readFileSync(FINDER_HTML, 'utf-8'), { waitUntil: 'load' });
    // Wait for fonts and layout to settle.
    await page.waitForTimeout(200);
    return await page.screenshot({ type: 'png', omitBackground: true });
  } finally {
    await browser.close();
  }
}

export async function shot11() {
  // 1. Capture raw workspace hero (no chrome — raw:true).
  const rawPath = await captureStill({
    shotKey: 'workspaceHero',
    outputName: '.tmp-workspace-raw-s11.png',
    viewport: { width: 1280, height: 800 },
    windowTitle: 'Linterly — Keepance',
    raw: true,
  });

  // 2. Render Finder overlay at 2x DPI.
  const finderBuf = await renderFinder();

  // 3. Composite finder into bottom-right of raw shot.
  //    sharp raw buf is at deviceScaleFactor=2, so physical px = 2560×1600.
  //    Finder rendered at 2x too, so physical px = 960×616.
  //    We inset 64 physical px (32 logical) from bottom-right.
  const rawBuf = readFileSync(rawPath);
  const rawMeta = await sharp(rawBuf).metadata();
  const finderMeta = await sharp(finderBuf).metadata();

  const rawW = rawMeta.width!;
  const rawH = rawMeta.height!;
  const finderW = finderMeta.width!;
  const finderH = finderMeta.height!;

  const INSET = 64; // physical pixels
  const top  = rawH - finderH - INSET;
  const left = rawW - finderW - INSET;

  const composited = await sharp(rawBuf)
    .composite([{ input: finderBuf, top, left }])
    .png()
    .toBuffer();

  // 4. Wrap in macOS chrome using a fresh Playwright browser inside
  //    compose-chrome.  Import dynamically to reuse the existing helper.
  const { composeChrome } = await import('../lib/compose-chrome');
  const final = await composeChrome(composited, { title: 'Linterly — Keepance' });

  mkdirSync(ASSETS_DIR, { recursive: true });
  const outPath = path.join(ASSETS_DIR, 'feature-local-first.png');
  writeFileSync(outPath, final);

  // Clean up temp raw file.
  try { (await import('node:fs')).unlinkSync(rawPath); } catch { /* ignore */ }

  console.log(`✓ ${outPath}`);
  return outPath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  shot11();
}
