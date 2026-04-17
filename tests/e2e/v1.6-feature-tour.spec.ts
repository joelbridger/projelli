import { test, expect } from '@playwright/test';

test.describe('v1.6 feature tour', () => {
  test('tour appears after first-run completes and can be stepped through', async ({ page }) => {
    await page.goto('http://localhost:5173');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await page.evaluate(() => {
      localStorage.setItem('projelli_onboarding_complete', 'true');
      const raw = localStorage.getItem('projelli:settings') ?? '{}';
      const parsed = JSON.parse(raw);
      parsed.state = parsed.state ?? {};
      parsed.state.featuresTourCompleted = false;
      localStorage.setItem('projelli:settings', JSON.stringify(parsed));
    });
    await page.reload();

    await expect(page.getByTestId('feature-tour-center')).toBeVisible({ timeout: 5000 });

    for (let i = 0; i < 4; i++) {
      await page.getByTestId('feature-tour-next').click();
    }

    await expect(page.getByTestId('feature-tour-finish')).toBeVisible();
    await page.getByTestId('feature-tour-finish').click();

    await expect(page.getByTestId('feature-tour-center')).not.toBeVisible();

    const completed = await page.evaluate(() => {
      const raw = localStorage.getItem('projelli:settings') ?? '{}';
      return JSON.parse(raw).state?.featuresTourCompleted;
    });
    expect(completed).toBe(true);
  });

  test('Esc skips the tour', async ({ page }) => {
    await page.goto('http://localhost:5173');
    await page.evaluate(() => {
      localStorage.setItem('projelli_onboarding_complete', 'true');
      const raw = localStorage.getItem('projelli:settings') ?? '{}';
      const parsed = JSON.parse(raw);
      parsed.state = parsed.state ?? {};
      parsed.state.featuresTourCompleted = false;
      localStorage.setItem('projelli:settings', JSON.stringify(parsed));
    });
    await page.reload();
    await expect(page.getByTestId('feature-tour-center')).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('feature-tour-center')).not.toBeVisible();
  });
});
