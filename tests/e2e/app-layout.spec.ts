/**
 * App Layout & Navigation Tests
 * Verifies core UI elements are present and navigable
 */

import { test, expect } from '@playwright/test';
import { BRAND } from '../../src/config/brand';
import { waitForAppLoad, waitForTestModeLoad, hardClick } from './helpers/test-utils';

test.describe('App Layout', () => {
  test('app loads and shows workspace selector', async ({ page }) => {
    await page.goto('/');
    await waitForAppLoad(page);

    const workspaceSelector = page.getByTestId('open-existing-workspace');
    await expect(workspaceSelector).toBeVisible();
  });

  test('workspace selector has both action buttons', async ({ page }) => {
    await page.goto('/');
    await waitForAppLoad(page);

    const openExisting = page.getByTestId('open-existing-workspace');
    await expect(openExisting).toBeEnabled();
    const newWorkspace = page.getByTestId('new-workspace');
    await expect(newWorkspace).toBeVisible();
    await expect(newWorkspace).toBeEnabled();
  });

  test('visual snapshot: workspace selector', async ({ page }) => {
    await page.goto('/');
    await waitForAppLoad(page);
    await expect(page).toHaveScreenshot('workspace-selector.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.05,
    });
  });
});

test.describe('Spine Navigation (test mode)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
  });

  test('spine has exactly the 3 IA rail destinations (and not the demoted ones)', async ({ page }) => {
    const expectedTabs = ['home', 'matters', 'search'];
    for (const tabId of expectedTabs) {
      await expect(page.getByTestId(`spine-nav-${tabId}`)).toBeVisible();
    }
    await expect(page.getByTestId('spine-nav-workflows')).toHaveCount(0);
    // Documents / Email / Activity Log / Privacy Center / Settings relocated —
    // they are no longer rail tabs (reached via the client hub + the gear).
    for (const tabId of ['files', 'email', 'audit', 'privacy', 'settings']) {
      await expect(page.getByTestId(`spine-nav-${tabId}`)).toHaveCount(0);
    }
  });

  test('top bar owns the logo and no longer renders the global Back button', async ({ page }) => {
    const header = page.getByTestId('app-header');
    const logo = header.getByRole('img', { name: BRAND.name });

    await expect(logo).toBeVisible();
    await expect(logo).toHaveAttribute('src', /\/logo-dark\.svg$/);
    await expect(page.getByTestId('app-back-button')).toHaveCount(0);
    await expect(page.getByTestId('trust-bar')).toBeVisible();
    await expect(page.getByLabel('Open Privacy Center')).toBeVisible();
  });

  test('spine no longer renders the old logo image', async ({ page }) => {
    const spine = page.getByTestId('spine-nav');

    await expect(
      spine.getByRole('img', { name: 'Lantern' })
    ).toHaveCount(0);

    const spineImageSources = await spine.locator('img').evaluateAll((imgs) =>
      imgs.map((img) => img.getAttribute('src') ?? '')
    );
    expect(spineImageSources.some((src) => src.includes('logo-white.svg'))).toBe(
      false
    );
  });

  test('spine collapse and expand buttons work', async ({ page }) => {
    const collapseBtn = page.getByRole('button', { name: 'Collapse sidebar' });
    await hardClick(collapseBtn);
    await expect(page.getByTestId('spine-nav-collapsed-matters')).toBeVisible();

    const expandBtn = page.getByRole('button', { name: 'Expand' });
    await hardClick(expandBtn);
    await expect(page.getByTestId('spine-nav-matters')).toBeVisible();
  });

  test('clicking spine tabs switches content', async ({ page }) => {
    await hardClick(page.getByTestId('spine-nav-search'));
    await expect(page.getByRole('heading', { name: 'Ask' })).toBeVisible();
    await expect(page.getByTestId('ask-composer-input')).toBeVisible();

    await hardClick(page.getByTestId('spine-nav-home'));
    await hardClick(page.getByTestId('crm-home-nav-workflows'));
    await expect(page.getByTestId('crm-screen-workflows')).toBeVisible();

    // Back to the Client Map — content switches away from Ask.
    await hardClick(page.getByTestId('spine-nav-matters'));
    await expect(page.getByTestId('spine-nav-matters')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('ask-composer-input')).toHaveCount(0);
  });

  test('visual snapshot: main app in test mode', async ({ page }) => {
    await expect(page).toHaveScreenshot('main-app-test-mode.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.05,
    });
  });
});
