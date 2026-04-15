/**
 * Create file dialog destination & preview (UX-15)
 *
 * The PromptDialog used by every "New X file" flow now shows:
 *   - a "Creating in [destinationPath]" line above the input
 *   - a live filename preview ("Preview: my-document.md") below the input
 *
 * Opening the dialog from the file tree's File → Markdown flow should
 * render both pieces, and typing into the input should update the preview.
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad, hardClick, safeFill } from './helpers/test-utils';

test.describe('Create file dialog (UX-15)', () => {
  test('shows destination and live preview when creating markdown', async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    // Open the File dropdown in the file tree toolbar.
    await hardClick(page.getByTestId('new-file-menu-trigger'));
    await hardClick(page.getByTestId('new-file-type-markdown'));

    // Destination label is visible.
    const destination = page.getByTestId('prompt-dialog-destination');
    await expect(destination).toBeVisible();
    await expect(destination).toContainText('Creating in');
    await expect(destination).toContainText('/docs/');

    // Preview filename starts at the placeholder value + extension.
    const preview = page.getByTestId('prompt-dialog-preview-filename');
    await expect(preview).toBeVisible();
    await expect(preview).toHaveText('my-document.md');

    // Typing updates the preview live.
    const input = page.getByRole('textbox');
    await safeFill(input, 'meeting-notes');
    await expect(preview).toHaveText('meeting-notes.md');

    // Typing the extension manually does not duplicate it.
    await safeFill(input, 'already-ext.md');
    await expect(preview).toHaveText('already-ext.md');
  });

  test('shows destination when creating a spreadsheet', async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    await hardClick(page.getByTestId('new-file-menu-trigger'));
    const xlsxOption = page.getByTestId('new-file-type-xlsx');
    // Spreadsheet option is conditionally rendered; skip if not present.
    const count = await xlsxOption.count();
    if (count === 0) {
      test.skip(true, 'Spreadsheet create option not wired in this build');
      return;
    }
    await hardClick(xlsxOption);

    await expect(page.getByTestId('prompt-dialog-destination')).toBeVisible();
    await expect(page.getByTestId('prompt-dialog-preview-filename')).toHaveText(
      'my-sheet.xlsx'
    );
  });
});
