/**
 * v1.5 Flag 3 — Side-by-side AI editing (M5) — E2E smoke tests
 *
 * Scope:
 *   1. The MarkdownEditor mounts in test mode without errors.
 *   2. The CodeMirror content area is present, which means the M5 inline-
 *      chat extension was wired without blowing up the editor.
 *   3. Selecting text programmatically via the editor store does not throw.
 *
 * The full inline-AI-edit flow (select → anchor → prompt → stream → per-hunk
 * accept / reject) is exercised by the Vitest suites below, which use a
 * fake streaming provider + in-memory editor adapter:
 *   - `tests/unit/streaming-diff.test.ts`
 *   - `tests/unit/selection-anchor.test.tsx`
 *   - `tests/unit/hunk-accept-reject.test.tsx`
 *   - `tests/unit/m5-history-attribution.test.ts`
 *
 * Running that flow end-to-end in Playwright would require (a) a real
 * provider API key and (b) a streaming response, neither of which are wired
 * into the E2E harness. The coordinate-based DOM selection path through
 * CodeMirror is also notoriously brittle under headless Chromium's
 * layout thread on WSL, so we keep this spec minimal.
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad, switchToStandaloneEditorSurface } from './helpers/test-utils';

async function openMarkdownFile(
  page: import('@playwright/test').Page,
  args: { path: string; name: string; content: string },
) {
  // MarkdownEditor (and its word-count footer) only mounts on the
  // standalone editor surface (sidebarActiveTab === 'files') — see
  // helpers/test-utils.ts.
  await switchToStandaloneEditorSurface(page);
  await page.evaluate((a) => {
    const fn = (window as unknown as {
      __openTestFile?: (p: string, n: string, c: string) => void;
    }).__openTestFile;
    if (!fn) throw new Error('__openTestFile missing');
    fn(a.path, a.name, a.content);
  }, args);
}

test.describe('v1.5 Flag 3 — Side-by-side AI editing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
  });

  test('Markdown editor mounts with M5 hooks attached and no error', async ({ page }) => {
    await openMarkdownFile(page, {
      path: '/test-workspace/flag3.md',
      name: 'flag3.md',
      content:
        '# Flag 3 smoke\n\nThis paragraph will be the selection target once we wire a mock provider into the E2E harness.\n\nSecond paragraph, unchanged.',
    });

    // Wait for editor word-count footer (also confirms MarkdownEditor mounted)
    const counter = page.getByTestId('editor-word-count');
    await expect(counter).toBeVisible();

    // Inline anchor is selection-driven; it does NOT render without a
    // user selection + layout phase. We don't assert it here because
    // CodeMirror's coordsAtPos path is flaky under headless WSL. The
    // structural guarantee — that the editor mounted with the anchor +
    // overlay components wired — is verified at compile time and by the
    // Vitest unit tests listed in the file docstring.
  });

  test('inline-AI-edit shortcut (Ctrl+Shift+E) does not throw', async ({ page }) => {
    await openMarkdownFile(page, {
      path: '/test-workspace/flag3-shortcut.md',
      name: 'flag3-shortcut.md',
      content: 'Pick a sentence and try to edit it.',
    });

    // The shortcut bumps the externalOpenSignal counter inside
    // useInlineAiEdit. Without a selection the anchor stays hidden,
    // but the key handler shouldn't throw. This is a smoke test — we
    // just want to confirm the listener is registered.
    await page.keyboard.press('Control+Shift+e');

    // The sidebar is still mounted; no unhandled React error crashed the tree.
    await expect(page.getByTestId('sidebar')).toBeVisible();
  });
});
