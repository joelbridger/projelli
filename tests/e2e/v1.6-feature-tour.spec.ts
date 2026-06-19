import { test, expect } from '@playwright/test';

test.describe('v1.6 feature tour', () => {
  test('tour appears after first-run completes and can be stepped through', async ({ page }) => {
    await page.goto('/?testMode=true&forceTour=true');
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

    // Advance with ArrowRight (avoids flaky anchored-bubble button clicks on the
    // middle steps), but POLL for the last step's Finish control instead of a
    // fixed number of presses — under full-suite load step transitions are slow
    // enough that a fixed ArrowRight×N + Enter raced ahead and never reached the
    // finish step, so the tour closed without persisting completion.
    const finishBtn = page.getByTestId('feature-tour-finish');
    for (let i = 0; i < 20; i++) {
      if (await finishBtn.isVisible().catch(() => false)) break;
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(200);
    }
    // Finish via the explicit button: its onClick calls onComplete directly, so
    // unlike pressing Enter it cannot lose to the keydown-listener rebind race.
    await expect(finishBtn).toBeVisible({ timeout: 5000 });
    await finishBtn.click();

    await expect(page.getByTestId('feature-tour-center')).not.toBeVisible({ timeout: 3000 });

    // featuresTourCompleted is persisted asynchronously (Zustand persist), so
    // poll rather than reading once — under parallel-suite load the write can
    // land a tick after the tour closes (this is why the test flaked only at
    // full-suite scale, never in isolation).
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const raw = localStorage.getItem('keepance:settings') ?? '{}';
            return JSON.parse(raw).state?.featuresTourCompleted;
          }),
        { timeout: 5000 },
      )
      .toBe(true);
  });

  test('Esc skips the tour', async ({ page }) => {
    await page.goto('/?testMode=true&forceTour=true');
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
