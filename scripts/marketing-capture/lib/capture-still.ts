/**
 * Still-shot orchestration helper.
 *
 * Wires together: mockAI (before navigation) → goto (?testMode=true) →
 * seedState → macStyles injection → optional beforeShot hook → screenshot
 * → composeChrome → write output file(s).
 *
 * Critical invariants:
 *  1. ALL navigation goes to `http://localhost:5173/?testMode=true` so the
 *     WorkspaceSelector is bypassed by the app's IS_TEST_MODE guard.
 *  2. mockAI() is called BEFORE page.goto() so route interceptors are
 *     registered before any in-app fetch fires.
 *  3. macStyles() is injected AFTER goto+networkidle+seedState so the app's
 *     own CSS doesn't override the injected styles.
 */

import { chromium, type Page } from 'playwright';
import { withBrowserLaunchOptions } from '../../browser-launch.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { linterlyFixture } from '../fixtures/linterly-workspace';
import { seedState, type ShotKey } from './seed-state';
import { macStyles } from './inject-mac-styles';
import { mockAI } from './mock-ai';
import { composeChrome } from './compose-chrome';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(HERE, '../../../Assets/marketing');
const PRESS_KIT_DIR = path.resolve(HERE, '../../../website/press-kit/assets');

export interface StillShotOptions {
  shotKey: ShotKey;
  outputName: string;
  pressKit?: boolean;
  viewport: { width: number; height: number };
  /** Optional AI replay fixture name (basename without .json). If set, mockAI() runs before navigation. */
  aiReplay?: string;
  /** Window title in the macOS chrome. Defaults to "Keepance". */
  windowTitle?: string;
  /** Async hook called after seed + style-injection but before screenshot. */
  beforeShot?: (page: Page) => Promise<void>;
  /** If true, returns the raw PNG without compositing the macOS chrome around it. */
  raw?: boolean;
  /** Optional pre-launched browser to reuse (saves cold-start time across shots). */
  browser?: import('playwright').Browser;
  /**
   * Key/value pairs written to localStorage via an init script that runs
   * BEFORE page.goto(). Use this to seed data that React hooks read on
   * mount (e.g. apiKey_anthropic for useApiKeys).
   */
  localStorageSeed?: Record<string, string>;
}

export async function captureStill(opts: StillShotOptions): Promise<string> {
  const ownsBrowser = !opts.browser;
  const browser = opts.browser ?? (await chromium.launch(withBrowserLaunchOptions()));

  try {
    const context = await browser.newContext({
      viewport: opts.viewport,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();

    try {
      // Mocking must be installed BEFORE navigation so routes catch in-app fetches.
      if (opts.aiReplay) await mockAI(page, opts.aiReplay);

      // Seed localStorage values before navigation so React hooks read them on mount.
      if (opts.localStorageSeed) {
        const entries = opts.localStorageSeed;
        await context.addInitScript((kv) => {
          for (const [k, v] of Object.entries(kv)) {
            localStorage.setItem(k, v);
          }
        }, entries);
      }

      await page.goto('http://localhost:5173/?testMode=true', { waitUntil: 'networkidle' });
      await seedState(page, linterlyFixture, opts.shotKey);
      // Inject after seed so app CSS doesn't override.
      await page.addStyleTag({ content: macStyles() });

      if (opts.beforeShot) await opts.beforeShot(page);

      // Final settle frame before capture.
      await page.waitForTimeout(300);

      const rawPng = await page.screenshot({ type: 'png', fullPage: false });
      const final = opts.raw
        ? rawPng
        : await composeChrome(rawPng, { title: opts.windowTitle ?? 'Keepance', browser });

      mkdirSync(ASSETS_DIR, { recursive: true });
      const outPath = path.join(ASSETS_DIR, opts.outputName);
      writeFileSync(outPath, final);

      if (opts.pressKit) {
        mkdirSync(PRESS_KIT_DIR, { recursive: true });
        writeFileSync(path.join(PRESS_KIT_DIR, opts.outputName), final);
      }

      return outPath;
    } finally {
      await context.close();
    }
  } finally {
    if (ownsBrowser) await browser.close();
  }
}
