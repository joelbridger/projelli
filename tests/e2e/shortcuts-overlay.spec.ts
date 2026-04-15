/**
 * Keyboard Shortcuts Overlay tests (UX-10)
 *
 * Pressing `?` anywhere (outside an input) opens a Radix Dialog listing all
 * shortcuts from `src/utils/shortcuts.ts`, grouped by category. The overlay
 * has a VISIBLE DialogTitle ("Keyboard shortcuts") — we do not repeat the
 * sr-only workaround used by the command palette.
 *
 * The overlay:
 *   - Registers a `?` keydown handler on window (guarded against input focus).
 *   - Filters the list via the search input.
 *   - Closes with Escape.
 *   - Does NOT trigger when focus is in an input/textarea/contenteditable.
 *
 * Test note: we use `page.keyboard.type('?')` rather than `keyboard.press`
 * because Playwright's `press` with a punctuation character does not
 * consistently dispatch a KeyboardEvent with `key === '?'`. `type` always
 * produces a keydown+keypress whose `.key` is the literal character.
 */

import { test, expect } from '@playwright/test';
import {
  waitForTestModeLoad,
  hardClick,
  safeFill,
} from './helpers/test-utils';

async function pressQuestion(page: import('@playwright/test').Page) {
  await page.keyboard.type('?');
}

test.describe('Shortcuts Overlay (UX-10)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    // Ensure no prior focus inside an input.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  });

  test('pressing "?" opens the overlay', async ({ page }) => {
    await pressQuestion(page);
    await expect(page.getByTestId('shortcuts-overlay')).toBeVisible();
  });

  test('overlay has a visible DialogTitle heading', async ({ page }) => {
    await pressQuestion(page);
    const overlay = page.getByTestId('shortcuts-overlay');
    await expect(overlay).toBeVisible();
    await expect(
      overlay.getByRole('heading', { name: /keyboard shortcuts/i })
    ).toBeVisible();
  });

  test('search filters the shortcut list', async ({ page }) => {
    await pressQuestion(page);
    const search = page.getByTestId('shortcuts-overlay-search');
    await expect(search).toBeVisible();

    // "save" should match at least one shortcut (Save File).
    await safeFill(search, 'save');
    await expect(page.getByTestId('shortcut-item-save-file')).toBeVisible();
    // The "Open Command Palette" item should not match this query.
    await expect(page.getByTestId('shortcut-item-command-palette')).toHaveCount(0);
  });

  test('search with no results shows an empty hint', async ({ page }) => {
    await pressQuestion(page);
    const search = page.getByTestId('shortcuts-overlay-search');
    await safeFill(search, '___nomatchxyz___');
    await expect(page.getByTestId('shortcuts-overlay-empty')).toBeVisible();
  });

  test('Escape closes the overlay', async ({ page }) => {
    await pressQuestion(page);
    await expect(page.getByTestId('shortcuts-overlay')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('shortcuts-overlay')).toHaveCount(0);
  });

  test('"?" pressed while focused in an input does NOT open overlay', async ({ page }) => {
    // Focus an input somewhere in the app. The AI Assistant Keys panel has
    // input fields that are reliably present in test mode.
    await hardClick(page.getByTestId('sidebar-tab-ai-assistant'));
    await hardClick(page.getByTestId('ai-tab-keys'));
    const input = page.getByTestId('api-key-input-anthropic');
    await expect(input).toBeVisible();
    await input.focus();

    // Typing '?' while the input has focus must NOT open the overlay.
    await pressQuestion(page);
    await expect(page.getByTestId('shortcuts-overlay')).toHaveCount(0);
    const val = await input.inputValue();
    expect(val).toContain('?');
  });
});
