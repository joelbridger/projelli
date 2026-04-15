/**
 * Command Palette Tests (UX-02)
 *
 * Pressing Ctrl+K opens the command palette. The Radix Dialog requires a
 * DialogTitle — without one it logs a console error about missing
 * accessibility affordances. This spec opens the palette and asserts that no
 * Radix a11y errors are logged.
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad } from './helpers/test-utils';

test.describe('Command palette accessibility', () => {
  test('opens without Radix a11y errors in the console', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    // Open via the visible header button (equivalent to pressing Ctrl+K, but
    // more deterministic across test environments).
    await page.getByRole('button', { name: /^Ctrl\+K/ }).click();

    const dialog = page.getByTestId('command-palette-dialog');
    await expect(dialog).toBeVisible();

    // Radix logs errors like:
    //   "`DialogContent` requires a `DialogTitle` for the component to be
    //    accessible for screen reader users."
    const radixA11yErrors = consoleErrors.filter(
      (e) =>
        /DialogTitle/.test(e) ||
        /DialogContent.*accessible/i.test(e) ||
        /requires a `DialogTitle`/i.test(e)
    );
    expect(radixA11yErrors).toEqual([]);
  });
});
