/**
 * Accessibility Tests
 * Uses axe-core to catch real UX problems
 *
 * Uses ?testMode=true to test the main UI
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { waitForTestModeLoad } from './helpers/test-utils';

test.describe('Accessibility', () => {
  test('main app UI passes a11y checks (test mode)', async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .exclude('.cm-editor') // CodeMirror
      .analyze();

    if (results.violations.length > 0) {
      console.log('A11y violations:', JSON.stringify(results.violations.map(v => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        nodes: v.nodes.length,
      })), null, 2));
    }

    const criticalViolations = results.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious'
    );
    expect(criticalViolations).toEqual([]);
  });

  test('workspace selector passes a11y checks', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for workspace selector
    const openExisting = page.getByTestId('open-existing-workspace');
    await expect(openExisting).toBeVisible({ timeout: 15_000 });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    const criticalViolations = results.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious'
    );
    expect(criticalViolations).toEqual([]);
  });
});
