/**
 * Campaign test helpers — Keepance 3.0 usability campaign.
 *
 * Exports:
 *   snap(page, testInfo, name)         — full-page screenshot, dual-save
 *   collectConsoleErrors(page)         — attach console listener, return getter
 *   horizontalOverflow                 — re-exported from e2e/helpers/overflow.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, TestInfo } from '@playwright/test';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Re-export the existing overflow helper so campaign specs import from one
// place and the helper stays DRY.
// ---------------------------------------------------------------------------
export { horizontalOverflow } from '../../e2e/helpers/overflow';

// ---------------------------------------------------------------------------
// Committed screenshots directory (under docs/quality/…/screenshots/)
// Kept in git; Playwright's own outputDir (runs/) is gitignored.
// ---------------------------------------------------------------------------
const COMMITTED_SHOTS_DIR = path.resolve(
  __dirname,
  '../../../docs/quality/2026-06-10-v3-usability-campaign/screenshots',
);

/**
 * Take a full-page screenshot and save it in two places:
 *
 *  1. `testInfo.outputPath(name + '.png')` — always, inside Playwright's
 *     managed outputDir (docs/…/runs/). This is the trace-friendly copy that
 *     Playwright attaches to the HTML report.
 *
 *  2. `docs/quality/…/screenshots/<journey>/<name>.png` — only when
 *     `CAMPAIGN_KEEP_SHOTS=1` is set. These are the intentional, committed
 *     visual captures that survive between campaign runs.
 *
 * `name` should be a slug like "smoke-app-shell" or "onboarding-step-1".
 * The journey subfolder is derived from the test's titlePath: the spec file
 * name (without extension) becomes the subfolder, so shots from
 * `smoke.spec.ts` land in `screenshots/smoke/`.
 */
export async function snap(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const fileName = `${name}.png`;

  // ---- 1. Always write to Playwright's managed output path ----
  const outputPath = testInfo.outputPath(fileName);
  await page.screenshot({ path: outputPath, fullPage: true });
  await testInfo.attach(name, { path: outputPath, contentType: 'image/png' });

  // ---- 2. Optionally write to the committed screenshots dir ----
  if (process.env.CAMPAIGN_KEEP_SHOTS === '1') {
    // Derive journey subfolder from the spec title path (e.g. "smoke.spec.ts"
    // → "smoke"). Use the first meaningful path segment to keep nesting flat.
    const specFile = testInfo.titlePath[0] ?? 'misc';
    const journey = specFile
      .replace(/\.spec\.(ts|tsx|js|jsx)$/, '')
      .replace(/.*[/\\]/, ''); // strip any leading directory path

    const journeyDir = path.join(COMMITTED_SHOTS_DIR, journey);
    fs.mkdirSync(journeyDir, { recursive: true });

    const committedPath = path.join(journeyDir, fileName);
    fs.copyFileSync(outputPath, committedPath);
  }
}

// ---------------------------------------------------------------------------
// Console error collector
// ---------------------------------------------------------------------------

/**
 * Known-benign console patterns that are safe to filter from the error list.
 *
 * Each entry documents WHY it is benign so reviewers can audit the list.
 * Add entries conservatively — only filter noise you have actually observed
 * and verified is harmless.
 */
const BENIGN_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    // Vite HMR WebSocket connection refused / close in test environments.
    // The dev server is running but HMR WS sometimes disconnects in headless
    // Playwright (no live reload needed in tests). Not a product error.
    pattern: /\[vite\] (server connection lost|failed to connect|disconnected)/i,
    reason: 'Vite HMR WebSocket noise in headless test environment',
  },
  {
    // Vite overlay script logs "HMR update" or "page reload" at info level
    // but sometimes shows up as a console.error in older Vite versions.
    pattern: /^\[HMR\]/,
    reason: 'Vite HMR lifecycle message, not a product error',
  },
  {
    // React DevTools or strict-mode double-render logs. These surface as
    // errors in some Playwright versions. Not from product code.
    pattern: /Download the React DevTools/i,
    reason: 'React DevTools suggestion, not a product error',
  },
  {
    // Chromium reports an ERR_FAILED for the Tauri IPC channel when the app
    // runs in the browser (non-Tauri) context. The app handles this gracefully
    // and falls back to WebFSBackend. Safe to ignore in browser tests.
    pattern: /tauri:\/\/localhost|ipc:\/\/localhost|__TAURI/i,
    reason: 'Tauri IPC unavailable in browser test context — expected fallback',
  },
  {
    // sql.js WASM loading produces a benign "Using unoptimized WASM" notice
    // in some Chromium builds. Not actionable.
    pattern: /Using unoptimized WASM/i,
    reason: 'sql.js WASM optimization notice, not a product error',
  },
  {
    // Vite injects a client script that logs the dev-server URL on startup.
    // Can appear as a console message in tests.
    pattern: /vite\/dist\/client\/env\.mjs/i,
    reason: 'Vite client environment script log',
  },
];

/** Returns true when the message text matches any known-benign pattern. */
function isBenign(text: string): boolean {
  return BENIGN_PATTERNS.some(({ pattern }) => pattern.test(text));
}

/**
 * Attach a `console` listener to `page` and return a getter that yields the
 * accumulated non-benign error/warning messages.
 *
 * Usage:
 * ```ts
 * const getErrors = collectConsoleErrors(page);
 * // ... do things that might log errors ...
 * const errors = getErrors();
 * expect(errors).toHaveLength(0);
 * ```
 *
 * The listener is scoped to the page's lifetime and cleaned up automatically
 * when the page closes.
 */
export function collectConsoleErrors(page: Page): () => string[] {
  const errors: string[] = [];

  const handler = (msg: { type: () => string; text: () => string }) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    const text = msg.text();
    if (!isBenign(text)) {
      errors.push(`[${msg.type()}] ${text}`);
    }
  };

  // `page.on('console', ...)` types differ between Playwright versions;
  // cast to any to stay compatible with both the narrow ConsoleMessage type
  // and any future change.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page.on('console', handler as any);

  return () => [...errors];
}
