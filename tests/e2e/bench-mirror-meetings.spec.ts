/**
 * Browser mirror of the Wave 3c Meetings tab surface (Lantern-Plus). The
 * actual recording pipeline (capture_start/capture_stop) is Tauri-only and
 * not drivable in the browser dev build, but the tab itself, the empty
 * state, and the consent dialog gating are pure client-side UI — this spec
 * covers exactly that "browser-drivable" slice, per
 * docs/qa/E2E-SMOKE-MIRROR.md's convention (see bench-mirror-book-view.spec.ts
 * / bench-mirror-setup.spec.ts for the same pattern on other Wave surfaces).
 */
import { test, expect, type Page } from '@playwright/test';
import { hardClick, waitForTestModeLoad } from './helpers/test-utils';

const BRENNAN_ID = 'matter_demo_brennan';

async function openMeetingsTab(page: Page) {
  await page.goto('/?testMode=true&seedDemo=1');
  await waitForTestModeLoad(page);
  await hardClick(page.getByTestId('spine-nav-matters'));
  const subtabBar = page.getByTestId('hub-subtab-bar');
  const matterRow = page.getByTestId(`matter-row-${BRENNAN_ID}`);
  await expect(subtabBar.or(matterRow)).toBeVisible({ timeout: 15_000 });
  if (await matterRow.isVisible().catch(() => false)) {
    await hardClick(matterRow);
    await expect(subtabBar).toBeVisible({ timeout: 15_000 });
  }
  await hardClick(page.getByTestId('hub-subtab-meetings'));
  await expect(page.getByTestId('hub-subtab-panel-meetings')).toBeVisible({ timeout: 10_000 });
}

test.describe('Bench mirror: Wave 3c — Meetings tab', () => {
  test('meetings tab sits on the client hub and shows the empty state', async ({ page }) => {
    await openMeetingsTab(page);
    await expect(page.getByTestId('client-meetings-tab')).toBeVisible();
    await expect(page.getByTestId('client-meetings-empty')).toBeVisible({ timeout: 10_000 });
    // 2026-07-04 UX review S6: the empty state itself carries the record CTA.
    await expect(page.getByTestId('record-meeting-button')).toBeEnabled();
  });

  test('Record a meeting opens the consent dialog, gated on the checkbox', async ({ page }) => {
    await openMeetingsTab(page);
    await hardClick(page.getByTestId('record-meeting-button'));

    const dialog = page.getByTestId('consent-dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // 2026-07-04 UX review S2: with no state on file, the two-party guidance
    // reads conditionally instead of asserting the advisor's state law.
    await expect(dialog.getByText(/if your state requires/i)).toBeVisible();

    const startButton = page.getByTestId('consent-start-button');
    await expect(startButton).toBeDisabled();

    await hardClick(page.getByTestId('consent-checkbox'));
    await expect(startButton).toBeEnabled();

    await hardClick(page.getByRole('button', { name: /cancel/i }));
    await expect(dialog).not.toBeVisible();
  });

  // 2026-07-04 UX review B6: in the browser build capture_start (Tauri-only)
  // always fails — exactly the failure shape this asserts on: the dialog must
  // surface the error inline and stay open, never close on silence.
  test('a failed recording start shows the error inline, never a silent close', async ({ page }) => {
    await openMeetingsTab(page);
    await hardClick(page.getByTestId('record-meeting-button'));

    const dialog = page.getByTestId('consent-dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await hardClick(page.getByTestId('consent-checkbox'));
    await hardClick(page.getByTestId('consent-start-button'));

    await expect(page.getByTestId('consent-error')).toBeVisible({ timeout: 10_000 });
    await expect(dialog).toBeVisible();
  });
});
