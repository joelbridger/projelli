/**
 * Create file dialog destination & preview (UX-15)
 *
 * The PromptDialog used by every "New X file" flow now shows:
 *   - a "Creating in [destinationPath]" line above the input
 *   - a live filename preview ("Preview: my-document.md") below the input
 *
 * Opening the dialog from the redesigned Documents toolbar's New document flow
 * should render both pieces, and typing into the input should update the
 * preview.
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad, hardClick, safeFill } from './helpers/test-utils';

test.describe('Create file dialog (UX-15)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    await hardClick(page.getByTestId('spine-nav-files'));
    await hardClick(page.getByRole('tab', { name: 'Files' }));
    await expect(page.getByTestId('documents-toolbar')).toBeVisible();
  });

  test('shows destination and live preview when creating a Word document', async ({ page }) => {
    await hardClick(page.getByTestId('documents-toolbar').getByRole('button', { name: 'New document' }));

    // Destination label is visible.
    const destination = page.getByTestId('prompt-dialog-destination');
    await expect(destination).toBeVisible();
    await expect(destination).toContainText('Creating in');
    await expect(destination).toContainText('/docs/');

    // Preview filename starts at the placeholder value + extension.
    const preview = page.getByTestId('prompt-dialog-preview-filename');
    await expect(preview).toBeVisible();
    await expect(preview).toHaveText('my-document.docx');

    // Typing updates the preview live.
    const input = page.getByRole('textbox');
    await safeFill(input, 'meeting-notes');
    await expect(preview).toHaveText('meeting-notes.docx');

    // Typing the extension manually does not duplicate it.
    await safeFill(input, 'already-ext.docx');
    await expect(preview).toHaveText('already-ext.docx');
  });

  test('shows destination when creating a folder', async ({ page }) => {
    await hardClick(page.getByTestId('documents-toolbar').getByRole('button', { name: 'New folder' }));

    const destination = page.getByTestId('prompt-dialog-destination');
    await expect(destination).toBeVisible();
    await expect(destination).toContainText('Creating in');
    await expect(destination).toContainText('/test-workspace/');
  });
});
