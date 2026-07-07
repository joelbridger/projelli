/**
 * Browser mirror of the Windows bench smoke checklist's Wave 4 Track C check
 * (scripts/bench-smoke/checks/wave4.mjs: wave4-whole-practice-ask — see
 * docs/qa/E2E-SMOKE-MIRROR.md for the full mapping).
 *
 * The whole-practice entry point is intentionally hidden for this branch. This
 * mirror now pins that truth and still covers the live scope toggle by proving
 * the remaining visible scopes switch the status pill.
 */

import { test, expect } from '@playwright/test';
import { hardClick, waitForTestModeLoad } from './helpers/test-utils';

test.describe('Bench mirror: Wave 4 Track C — hidden whole-practice Ask scope', () => {
  test('wave4-whole-practice-ask: hidden chip stays absent and visible scopes switch', async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    await hardClick(page.getByTestId('spine-nav-search'));

    await expect(page.getByTestId('scope-option-whole-practice')).toHaveCount(0);
    const scopePill = page.getByTestId('ask-scope-pill');
    await expect(scopePill).toBeVisible({ timeout: 10_000 });

    await hardClick(page.getByTestId('scope-option-email'));
    await expect(scopePill).toHaveText('Email');

    await hardClick(page.getByTestId('scope-option-documents'));
    await expect(scopePill).toHaveText('Documents');

    await hardClick(page.getByTestId('scope-option-all-matters'));
    await expect(scopePill).toHaveText('All clients');
  });
});
