/**
 * V06 — BYOK setup (15s)
 *
 * Shows settings → API keys → paste a key.
 *
 * Timing:
 *   t=0-2s:  Workspace hero state
 *   t=2-4s:  Cursor moves to settings/AI sidebar tab, click
 *   t=4-6s:  Settings/AI panel opens, click "Keys" tab
 *   t=6-10s: Type fake Anthropic API key char-by-char
 *   t=10-12s: "Saved" badge appears (DOM injection)
 *   t=12-15s: Hold final state — keys all configured
 */

import { chromium } from 'playwright';
import { withBrowserLaunchOptions } from '../../browser-launch.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readdirSync, copyFileSync, rmSync, statSync } from 'node:fs';
import { linterlyFixture } from '../fixtures/linterly-workspace';
import { seedState } from '../lib/seed-state';
import { macStyles } from '../lib/inject-mac-styles';
import { renderCinematic, focusOn, type CameraShot, type Caption } from '../lib/cinematic';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(HERE, '../../../Assets/marketing');
const PRESS_KIT_DIR = path.resolve(HERE, '../../../website/press-kit/assets');
const CHROME_PNG = path.resolve(HERE, '../chrome-template/sequoia-chrome-1920x1080.png');
const VIDEO_TMP = path.resolve(HERE, '../.tmp/video-06');

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Fake keys that look realistic in the UI
const FAKE_ANTHROPIC_KEY = 'sk-ant-api03-abcdefghijk3xQ';
const FAKE_OPENAI_KEY    = 'sk-projUSERKEYFAKE8aB';

export async function video06() {
  rmSync(VIDEO_TMP, { recursive: true, force: true });
  mkdirSync(VIDEO_TMP, { recursive: true });

  const browser = await chromium.launch(withBrowserLaunchOptions({
    args: ['--force-device-scale-factor=2', '--high-dpi-support=1'],
  }));
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
    recordVideo: { dir: VIDEO_TMP, size: { width: 3840, height: 2160 } },
    storageState: {
      cookies: [],
      origins: [{
        origin: 'http://localhost:5175',
        localStorage: [
          { name: 'apiKey_openai', value: FAKE_OPENAI_KEY },
        ],
      }],
    },
  });
  const page = await context.newPage();
  const recordingStartMs = Date.now();
  const elapsedSec = () => (Date.now() - recordingStartMs) / 1000;
  const beats: Record<string, number> = {};

  await page.goto('http://localhost:5175/?testMode=true', { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: macStyles() });
  beats.pageReady = elapsedSec();

  // ── t=0-2s: Workspace hero ──
  await seedState(page, linterlyFixture, 'workspaceHero');
  await sleep(2000);
  beats.heroSettled = elapsedSec();

  // ── t=2-4s: Click the AI assistant sidebar tab ──
  const aiTab = page.locator('[data-testid="sidebar-tab-ai-assistant"]');
  const aiTabBB = await aiTab.first().boundingBox({ timeout: 1000 }).catch(() => null);
  if (aiTabBB) {
    await page.mouse.move(aiTabBB.x + aiTabBB.width / 2, aiTabBB.y + aiTabBB.height / 2, { steps: 15 });
    await sleep(200);
    await page.mouse.click(aiTabBB.x + aiTabBB.width / 2, aiTabBB.y + aiTabBB.height / 2);
  }
  await sleep(2000);

  // ── t=4-6s: Click the "Keys" tab within the AI assistant pane ──
  const keysTab = page.locator('[data-testid="ai-tab-keys"]');
  const keysTabBB = await keysTab.first().boundingBox({ timeout: 1000 }).catch(() => null);
  if (keysTabBB) {
    await page.mouse.move(keysTabBB.x + keysTabBB.width / 2, keysTabBB.y + keysTabBB.height / 2, { steps: 8 });
    await sleep(100);
    await page.mouse.click(keysTabBB.x + keysTabBB.width / 2, keysTabBB.y + keysTabBB.height / 2);
    // Wait for the API key rows to appear
    await page.waitForSelector('[data-testid="api-key-row-anthropic"]', { timeout: 5000 }).catch(() => null);
  } else {
    // If the Keys tab isn't reachable, inject the entire API keys panel as DOM overlay
    await page.evaluate(() => {
      if (document.getElementById('__v06_keys_panel')) return;

      const style = document.createElement('style');
      style.textContent = `
        #__v06_keys_panel {
          position: fixed;
          top: 0; right: 0;
          width: 340px;
          height: 100%;
          z-index: 200;
          background: var(--card, #1c1c28);
          border-left: 1px solid rgba(255,255,255,0.08);
          display: flex; flex-direction: column;
          font-family: -apple-system, "SF Pro Text", system-ui, sans-serif;
          padding: 16px;
          gap: 12px;
        }
        .v06-panel-title {
          font-size: 14px; font-weight: 600;
          color: rgba(255,255,255,0.9);
          margin-bottom: 4px;
        }
        .v06-row {
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 8px;
          padding: 10px 12px;
          display: flex; flex-direction: column; gap: 6px;
        }
        .v06-provider { font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.7); }
        .v06-input {
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 5px;
          padding: 5px 8px;
          font-size: 12px;
          font-family: "SF Mono", ui-monospace, monospace;
          color: rgba(255,255,255,0.85);
          letter-spacing: 0.02em;
        }
        .v06-status {
          font-size: 11px;
          color: #34C759;
          font-weight: 500;
        }
      `;
      document.head.appendChild(style);

      const panel = document.createElement('div');
      panel.id = '__v06_keys_panel';

      const title = document.createElement('div');
      title.className = 'v06-panel-title';
      title.textContent = 'API Keys';
      panel.appendChild(title);

      const providers = [
        { id: 'anthropic', label: 'Anthropic', value: '', status: '' },
        { id: 'openai',    label: 'OpenAI',    value: 'sk-proj••••••••8aB', status: 'Configured' },
        { id: 'gemini',    label: 'Google Gemini', value: '', status: '' },
      ];

      for (const p of providers) {
        const row = document.createElement('div');
        row.className = 'v06-row';
        row.setAttribute('data-testid', `api-key-row-${p.id}`);
        const label = document.createElement('div');
        label.className = 'v06-provider';
        label.textContent = p.label;
        const input = document.createElement('div');
        input.className = 'v06-input';
        input.id = `v06-input-${p.id}`;
        input.textContent = p.value;
        row.appendChild(label);
        row.appendChild(input);
        if (p.status) {
          const stat = document.createElement('div');
          stat.className = 'v06-status';
          stat.textContent = `✓ ${p.status}`;
          row.appendChild(stat);
        }
        panel.appendChild(row);
      }

      document.body.appendChild(panel);
    });
  }
  await sleep(2000);
  beats.keysVisible = elapsedSec();

  // ── t=6-10s: Click the Anthropic key input and type char-by-char ──
  const anthropicInput = page.locator('[data-testid="api-key-row-anthropic"] input, [data-testid="api-key-row-anthropic"] [placeholder]');
  const inputBB = await anthropicInput.first().boundingBox({ timeout: 1000 }).catch(() => null);
  if (inputBB) {
    await page.mouse.move(inputBB.x + inputBB.width / 2, inputBB.y + inputBB.height / 2, { steps: 8 });
    await page.mouse.click(inputBB.x + inputBB.width / 2, inputBB.y + inputBB.height / 2);
    // Select all and clear, then type
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(FAKE_ANTHROPIC_KEY, { delay: 80 });
  } else {
    // Fallback: animate text in the fake panel input
    const injectedInput = page.locator('#v06-input-anthropic');
    const injBB = await injectedInput.first().boundingBox({ timeout: 1000 }).catch(() => null);
    if (injBB) {
      // Type characters one-by-one by updating the DOM element text content
      for (let i = 0; i <= FAKE_ANTHROPIC_KEY.length; i++) {
        await page.evaluate(
          ({ chars }) => {
            const el = document.getElementById('v06-input-anthropic');
            if (el) el.textContent = chars;
          },
          { chars: FAKE_ANTHROPIC_KEY.slice(0, i) },
        );
        await sleep(80);
      }
    }
  }
  await sleep(500);
  beats.keyTyped = elapsedSec();

  // ── t=10-12s: Show "Saved" confirmation ──
  await page.evaluate(() => {
    // Try to find a real toast/status element first
    const row = document.querySelector('[data-testid="api-key-row-anthropic"]');
    if (!row) return;

    if (document.getElementById('__v06_saved_badge')) return;

    const badge = document.createElement('div');
    badge.id = '__v06_saved_badge';
    badge.style.cssText = [
      'display:inline-flex',
      'align-items:center',
      'gap:4px',
      'font-size:11px',
      'font-weight:600',
      'color:#34C759',
      'margin-top:2px',
      'opacity:0',
      'transition:opacity 0.3s ease',
    ].join(';');
    badge.textContent = '✓ Saved';

    row.appendChild(badge);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        badge.style.opacity = '1';
      });
    });
  });
  await sleep(2000);
  beats.savedShown = elapsedSec();

  // ── t=12-15s: Hold final state ──
  await sleep(3000);
  beats.end = elapsedSec();

  // Capture the keys panel rect BEFORE closing the browser.
  const keysPanelRect = await page.evaluate(() => {
    const el = document.querySelector('#__v06_keys_panel, [data-testid="api-key-row-anthropic"]') as HTMLElement | null;
    if (!el) return null;
    // Walk up to find a containing panel
    const panel = (el.id === '__v06_keys_panel') ? el : (el.closest('aside, [role="dialog"], #__v06_keys_panel') ?? el.parentElement);
    const r = (panel ?? el).getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }).catch(() => null);

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
  const outPath = path.join(ASSETS_DIR, 'byok-setup.mp4');

  console.log('[V06] beats:', JSON.stringify(beats));

  // Camera focuses on the keys panel (top-right of viewport).
  const keysFocus = keysPanelRect
    ? focusOn([{ x: keysPanelRect.x - 80, y: keysPanelRect.y - 20, width: keysPanelRect.width + 100, height: keysPanelRect.height + 40 }], { minWidth: 1200, pad: 20 })
    : { x: 600, y: 60, w: 1200, h: 685 };

  const shots: CameraShot[] = [
    { tSec: 0,                                crop: keysFocus, label: 'keys-panel' },
    { tSec: (beats.end ?? 14),                crop: keysFocus, label: 'hold-end' },
  ];

  const captions: Caption[] = [
    { startSec: (beats.heroSettled ?? 2) + 0.3, endSec: (beats.keysVisible ?? 6) - 0.3, text: 'Open Settings → API Keys' },
    { startSec: (beats.keysVisible ?? 6) + 0.3, endSec: (beats.savedShown ?? 12) - 0.3, text: 'Paste your own key' },
    { startSec: (beats.savedShown ?? 12) + 0.3, endSec: (beats.end ?? 15) - 0.2, text: 'Stored in your OS keychain' },
  ];

  const PRE_ROLL_SEC = 0.4;
  const trimSec = Math.max(0, (beats.heroSettled ?? 2) - 0.5 - PRE_ROLL_SEC);

  await renderCinematic({ webmPath, chromePngPath: CHROME_PNG, outPath, shots, captions, trimSec, videoTitle: 'Bring your own AI key in 30 seconds' });

  mkdirSync(PRESS_KIT_DIR, { recursive: true });
  copyFileSync(outPath, path.join(PRESS_KIT_DIR, 'byok-setup.mp4'));
  console.log(`✓ press-kit copy → ${path.join(PRESS_KIT_DIR, 'byok-setup.mp4')}`);
  return outPath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  video06().catch((e) => { console.error(e); process.exit(1); });
}
