/**
 * Shared Playwright test utilities
 *
 * Rules:
 * - Only use getByTestId() (preferred) or getByRole() / getByLabel()
 * - Never use CSS selectors
 * - Before every click/fill: await expect(locator).toBeVisible()
 * - For buttons: also await expect(locator).toBeEnabled()
 * - No waitForTimeout - use locator assertions instead
 */

import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Hardened click that handles overlays, animations, and offscreen elements
 */
export async function hardClick(el: Locator) {
  await expect(el).toBeVisible();
  await expect(el).toBeEnabled();
  await el.scrollIntoViewIfNeeded();

  try {
    await el.click({ trial: true }); // verifies it can be clicked
    await el.click();
  } catch {
    // fallback for weird overlays/positioning
    await el.click({ force: true });
  }
}

/**
 * Safe fill that waits for visibility and clears existing content
 */
export async function safeFill(el: Locator, text: string) {
  await expect(el).toBeVisible();
  await expect(el).toBeEnabled();
  await el.scrollIntoViewIfNeeded();
  await el.fill(text);
}

/**
 * Wait for the app to fully load (workspace selector or main UI)
 */
export async function waitForAppLoad(page: Page) {
  // The app either shows the workspace selector dialog or the main UI
  // Wait for either to appear
  await page.waitForLoadState('networkidle');

  // Wait for React to render - look for either workspace selector or sidebar
  const workspaceSelector = page.getByTestId('open-existing-workspace');
  const sidebar = page.getByTestId('sidebar');

  await expect(workspaceSelector.or(sidebar)).toBeVisible({ timeout: 15_000 });
}

/**
 * Wait for the app to load in test mode (bypasses workspace selector)
 * The main UI (sidebar, status bar, etc.) should be visible
 */
export async function waitForTestModeLoad(page: Page) {
  await page.waitForLoadState('networkidle');
  // In test mode, the sidebar should be visible
  // Use 30s timeout since dev server may take time to compile on first load
  await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 30_000 });
}

/**
 * Check if the workspace selector is shown (no workspace open)
 */
export async function isWorkspaceSelectorVisible(page: Page): Promise<boolean> {
  const selector = page.getByTestId('open-existing-workspace');
  return selector.isVisible();
}

/**
 * Navigate to the AI Assistant pane via sidebar
 */
export async function openAIAssistantPane(page: Page) {
  const aiTab = page.getByTestId('sidebar-tab-ai-assistant');
  await hardClick(aiTab);
  await expect(page.getByTestId('ai-assistant-pane')).toBeVisible();
}

/**
 * Navigate to a sidebar tab
 */
export async function openSidebarTab(page: Page, tabId: string) {
  const tab = page.getByTestId(`sidebar-tab-${tabId}`);
  await hardClick(tab);
}

/**
 * Switch AI Assistant to a specific tab
 */
export async function switchAITab(page: Page, tab: 'chats' | 'keys' | 'models') {
  const tabButton = page.getByTestId(`ai-tab-${tab}`);
  await hardClick(tabButton);
}

/**
 * Enter an API key for a specific provider
 */
export async function enterApiKey(page: Page, provider: string, key: string) {
  await switchAITab(page, 'keys');
  const input = page.getByTestId(`api-key-input-${provider}`);
  await safeFill(input, key);
  const saveButton = page.getByTestId(`api-key-save-${provider}`);
  await hardClick(saveButton);
}
