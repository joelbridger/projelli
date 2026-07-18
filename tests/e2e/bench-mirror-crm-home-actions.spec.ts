/**
 * Bench mirror: D4 finding 1.
 *
 * Home's two header actions share one normal-flow action row. At common
 * desktop widths they must remain independently visible and clickable rather
 * than painting over each other.
 */
import { test, expect } from '@playwright/test';
import { boxesOverlap } from './helpers/layout';
import { waitForTestModeLoad } from './helpers/test-utils';

const VIEWPORTS = [1280, 1440, 1680] as const;

test.describe('Bench mirror: CRM Home header actions', () => {
  for (const width of VIEWPORTS) {
    test(`review and notifications controls do not overlap at ${String(width)}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/?testMode=true');
      await waitForTestModeLoad(page);

      const review = page.getByTestId('crm-today-review');
      const notifications = page.getByTestId('crm-notifications-button');
      await expect(review).toBeVisible();
      await expect(review).toBeEnabled();
      await expect(notifications).toBeVisible();
      await expect(notifications).toBeEnabled();

      const reviewBox = await review.boundingBox();
      const notificationsBox = await notifications.boundingBox();
      expect(
        reviewBox,
        'Review today’s plan must have a rendered bounding box'
      ).not.toBeNull();
      expect(
        notificationsBox,
        'Notifications must have a rendered bounding box'
      ).not.toBeNull();
      if (!reviewBox || !notificationsBox) return;

      expect(boxesOverlap(reviewBox, notificationsBox)).toBe(false);
    });
  }
});
