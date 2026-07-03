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

  // Wave B / S1: the sidebar auto-collapses to the icon rail on the default
  // landing view (the Client Map list), so most existing specs' `spine-nav-*`
  // selectors (the EXPANDED nav's testids) wouldn't resolve. Normalize to
  // expanded here, once, so every spec built against the expanded sidebar
  // keeps working without touching each one's nav-click selectors.
  const expandButton = page.getByRole('button', { name: 'Expand' });
  if (await expandButton.isVisible().catch(() => false)) {
    await expandButton.click();
    await expect(page.getByTestId('spine-nav')).toBeVisible({ timeout: 10_000 });
  }
}

/**
 * Open the matter-scoped Documents browser through the new Client Map IA.
 *
 * Tests that use the default matter should load `?testMode=true&seedDemo=1`
 * so the Brennan demo client exists.
 */
export async function gotoDocuments(page: Page, matterId = 'matter_demo_brennan') {
  await hardClick(page.getByTestId('spine-nav-matters'));

  // Landing here shows either the matter hub directly (its Documents sub-tab
  // already in the DOM) or a matters list to pick from first (matter-row-*) —
  // which one depends on app state, not timing. Wait for whichever actually
  // appears instead of guessing from a snapshot taken right after the click.
  //
  // STALE-TESTID FIX (F1.3, 2026-07-01): this used to target a
  // `hub-shortcut-documents` shortcut card, which the Client Map redesign
  // (MatterHub.tsx) replaced with a `hub-subtab-documents` tab in the hub's
  // sub-tab bar — the old id no longer exists anywhere in src/, so every
  // caller of this helper failed 100% of the time, on any machine, at any
  // speed. Not a CI-timing flake.
  const documentsTab = page.getByTestId('hub-subtab-documents');
  const matterRow = page.getByTestId(`matter-row-${matterId}`);
  await expect(documentsTab.or(matterRow)).toBeVisible({ timeout: 15_000 });

  if (await matterRow.isVisible().catch(() => false)) {
    await hardClick(matterRow);
    await expect(documentsTab).toBeVisible({ timeout: 15_000 });
  }

  await hardClick(documentsTab);
  await expect(page.getByTestId('documents-toolbar')).toBeVisible({ timeout: 10_000 });
}

/**
 * Check if the workspace selector is shown (no workspace open)
 */
export async function isWorkspaceSelectorVisible(page: Page): Promise<boolean> {
  const selector = page.getByTestId('open-existing-workspace');
  return selector.isVisible();
}

/**
 * Navigate to the current AI Assistant surface.
 *
 * Keepance 3.0 moved AI chat out of the old sidebar pane and into a main
 * editor tab opened by Ctrl+Shift+A.
 */
export async function openAIAssistantPane(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press('Control+Shift+a');
  await expect(page.getByTestId('ai-assistant-tab')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('ai-chat-viewer')).toBeVisible({ timeout: 10_000 });
}

/**
 * Navigate to a sidebar tab
 */
export async function openSidebarTab(page: Page, tabId: string) {
  // Wave B / S1: the sidebar auto-collapses to the icon rail on the Client
  // Map list, which renders `spine-nav-collapsed-*` instead of `spine-nav-*`
  // — match either, only one is ever mounted at a time.
  const tab = page
    .getByTestId(`spine-nav-${tabId}`)
    .or(page.getByTestId(`spine-nav-collapsed-${tabId}`))
    .or(page.getByTestId(`sidebar-tab-${tabId}`));
  await hardClick(tab);
}

/**
 * Switch to the standalone (non-embedded) Documents/editor surface
 * (App.tsx's `sidebarActiveTab === 'files'`) — the surface MainPanel's tab
 * bar, toolbar, and the status bar's file-context slot (breadcrumbs,
 * auto-save indicator) are gated on. In the current 3-tab IA (Client Map /
 * Ask / Workflows) there's no direct spine-nav entry for it; a real user
 * reaches it via Ctrl+Shift+A (open AI Assistant tab) or by opening a cited
 * document from the Client Map/Ask. Ctrl+Shift+A is the simplest real path
 * that doesn't require seeding a matter, so tests use that.
 */
export async function switchToStandaloneEditorSurface(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press('Control+Shift+a');
  await expect(page.getByTestId('main-panel')).toBeVisible({ timeout: 10_000 });
}

/**
 * Open a file on the standalone editor surface (see
 * `switchToStandaloneEditorSurface`) via the `__openTestFile` test hook.
 * Poking `__openTestFile`/the editor store alone leaves `sidebarActiveTab`
 * wherever it was, so surface-gated UI never appears — switch first.
 */
export async function openStandaloneFile(
  page: Page,
  path: string,
  name: string,
  content: string
) {
  await switchToStandaloneEditorSurface(page);
  await page.evaluate((a) => {
    const fn = (window as unknown as {
      __openTestFile?: (p: string, n: string, c: string) => void;
    }).__openTestFile;
    if (!fn) throw new Error('__openTestFile missing');
    fn(a.path, a.name, a.content);
  }, { path, name, content });
}

/**
 * Switch to the standalone editor surface's Files GRID view (toolbar +
 * Files/Trash toggle + tree/grid toggle) rather than whichever editor tab
 * happens to be active. `switchToStandaloneEditorSurface` alone opens the AI
 * Assistant tab, which makes DocumentsHome.tsx render that tab's content
 * instead of the grid (`showFilesGrid` flips false once any editor-surface
 * tab is open) — the toolbar (docs-files-toggle, docs-trash-toggle, etc.)
 * only renders when the grid is shown. Click the pinned "Files" tab to force
 * it back.
 */
export async function switchToStandaloneFilesGrid(page: Page) {
  await switchToStandaloneEditorSurface(page);
  await hardClick(page.getByRole('tab', { name: 'Files' }));
  await expect(page.getByTestId('documents-toolbar')).toBeVisible({ timeout: 10_000 });
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
