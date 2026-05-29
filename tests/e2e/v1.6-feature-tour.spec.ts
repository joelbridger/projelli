import { test, expect } from '@playwright/test';

test.describe('v1.6 feature tour', () => {
  test('tour appears after first-run completes and can be stepped through', async ({ page }) => {
    await page.goto('http://localhost:5173/?testMode=true&forceTour=true');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await page.evaluate(() => {
      localStorage.setItem('keepance_onboarding_complete', 'true');
      const raw = localStorage.getItem('keepance:settings') ?? '{}';
      const parsed = JSON.parse(raw);
      parsed.state = parsed.state ?? {};
      parsed.state.featuresTourCompleted = false;
      localStorage.setItem('keepance:settings', JSON.stringify(parsed));
    });
    await page.reload();

    await expect(page.getByTestId('feature-tour-center')).toBeVisible({ timeout: 5000 });

    // Use keyboard arrows + Enter — more reliable than clicking through
    // anchored-bubble transitions in headless E2E.
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(150);
    }
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('feature-tour-center')).not.toBeVisible({ timeout: 3000 });

    const completed = await page.evaluate(() => {
      const raw = localStorage.getItem('keepance:settings') ?? '{}';
      return JSON.parse(raw).state?.featuresTourCompleted;
    });
    expect(completed).toBe(true);
  });

  test('Esc skips the tour', async ({ page }) => {
    await page.goto('http://localhost:5173/?testMode=true&forceTour=true');
    await page.evaluate(() => {
      localStorage.setItem('keepance_onboarding_complete', 'true');
      const raw = localStorage.getItem('keepance:settings') ?? '{}';
      const parsed = JSON.parse(raw);
      parsed.state = parsed.state ?? {};
      parsed.state.featuresTourCompleted = false;
      localStorage.setItem('keepance:settings', JSON.stringify(parsed));
    });
    await page.reload();
    await expect(page.getByTestId('feature-tour-center')).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('feature-tour-center')).not.toBeVisible();
  });
});
