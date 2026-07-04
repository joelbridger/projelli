/**
 * QA-6 (P1) regression guard — the Ask composer must stay usable at normal
 * laptop window sizes.
 *
 * The bug: the Ask 3-column layout has two fixed side columns (conversations
 * rail + sources) and the composer's center column was the only shrinkable one,
 * so at ~1028×749 the `ask-composer-input` collapsed to 0px width and became
 * non-interactable (Playwright `.fill()` timed out), and at ~600px the whole
 * row clipped instead of degrading. The fix (src/features/ask/askResponsive.ts
 * + Ask.tsx) collapses the rail then hides the sources column as the body
 * narrows, keeping the composer a usable minimum width.
 *
 * This mirrors the QA-1 first-run finding (coordination/qa-campaign/evidence:
 * 35-ask-tab.jpeg vs 45-ask-small-window.jpeg). It drives the real Ask surface
 * at the exact reported viewports and asserts the input is present, has
 * non-zero width, and is actually interactable — no AI backend needed.
 */
import { test, expect, type Page } from '@playwright/test';
import { waitForTestModeLoad, hardClick } from './helpers/test-utils';

async function openAsk(page: Page) {
  await page.goto('/?testMode=true');
  await waitForTestModeLoad(page);
  await hardClick(page.getByTestId('spine-nav-search'));
}

// The reported break points: a normal ~1028px laptop window and a narrow 600px.
const VIEWPORTS = [
  { label: 'normal laptop (~1028px)', width: 1028, height: 749 },
  { label: 'narrow (600px)', width: 600, height: 749 },
] as const;

test.describe('Bench mirror: QA-6 — Ask composer usable at normal window sizes', () => {
  for (const vp of VIEWPORTS) {
    test(`ask-composer-input is present, non-zero width, and interactable at ${vp.label}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await openAsk(page);

      const input = page.getByTestId('ask-composer-input');
      await expect(input).toBeVisible({ timeout: 10_000 });

      // The core of the bug: the input measured 0px wide. Assert it has real width.
      const box = await input.boundingBox();
      expect(box, 'ask-composer-input should have a bounding box').not.toBeNull();
      expect(box!.width, `composer input width at ${vp.label}`).toBeGreaterThan(80);

      // ...and is genuinely interactable (the reported failure was a .fill timeout).
      await input.fill('Which client is retiring soonest?');
      await expect(input).toHaveValue('Which client is retiring soonest?');
    });
  }
});
