/**
 * Search surface
 *
 * Keepance 3.0 replaced the old filename/content result-card panel with the
 * cited Ask search surface. These tests pin the visible controls that exist
 * today without sending a real AI request.
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad, hardClick, safeFill } from './helpers/test-utils';

async function openSearchSurface(page: import('@playwright/test').Page) {
  await hardClick(page.getByTestId('spine-nav-search'));
  await expect(page.getByTestId('ask-composer-input')).toBeVisible();
}

test.describe('Search surface', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    await openSearchSurface(page);
  });

  test('search input uses the current Ask composer', async ({ page }) => {
    const input = page.getByTestId('ask-composer-input');
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute('placeholder', /search across all matters/i);
  });

  test('scope toggle exposes current search scopes', async ({ page }) => {
    await expect(page.getByTestId('scope-toggle')).toBeVisible();
    await expect(page.getByTestId('scope-option-all-matters')).toBeVisible();
    await expect(page.getByTestId('scope-option-email')).toBeVisible();
    await expect(page.getByTestId('scope-option-documents')).toBeVisible();
  });

  test('document scope changes the composer placeholder', async ({ page }) => {
    await hardClick(page.getByTestId('scope-option-documents'));
    await expect(page.getByTestId('ask-composer-input')).toHaveAttribute(
      'placeholder',
      /documents/i
    );
  });

  test('typing a question enables the Search action', async ({ page }) => {
    const input = page.getByTestId('ask-composer-input');
    const searchButton = page.getByRole('button', { name: /^Search$/ }).last();

    await expect(searchButton).toBeDisabled();
    await safeFill(input, 'Find every email from opposing counsel');
    await expect(searchButton).toBeEnabled();
  });
});
