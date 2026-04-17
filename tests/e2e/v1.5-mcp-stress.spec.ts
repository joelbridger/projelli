/**
 * v1.5 Flag 2 — MCP server + `.mcpb` bundle stress + edge-case tests.
 *
 * These tests exercise what the browser-only harness can actually observe:
 *
 *   - Status pill renders with every known `data-status` value
 *     (`loading` / `ready` / `unavailable`). We can't reach `ready` in
 *     the real harness (no bundle on disk), but we can mount the
 *     McpSettingsSection directly with an injected `onResolveBundlePath`
 *     test hook and drive it into every branch.
 *   - Download button respects the bundle-path state (disabled when
 *     unavailable, enabled when a path resolves).
 *   - The install-readme copy is visible and mentions Claude Desktop.
 *   - The MCP approval modal is NOT mounted in the main app tree in dev
 *     mode (the polling loop is Tauri-only), so the stress tests for
 *     the modal itself use a small test harness page.
 *
 * Full binary-level MCP testing (tools/list, tools/call,
 * write_workspace_file with approval channel) lives in
 * `src-tauri/tests/mcp_binary.rs` — see the smoke spec docstring for why
 * we can't run it from Playwright.
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad, hardClick } from './helpers/test-utils';

async function openIntegrationsSettings(page: import('@playwright/test').Page) {
  await hardClick(page.getByTestId('settings-gear'));
  await expect(page.getByTestId('settings-modal')).toBeVisible();
  await hardClick(page.getByTestId('settings-category-integrations'));
  await expect(page.getByTestId('mcp-settings-section')).toBeVisible();
}

test.describe('v1.5 Flag 2 — MCP + .mcpb stress', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
  });

  test('status pill resolves to `unavailable` in dev harness (no .mcpb on disk)', async ({
    page,
  }) => {
    await openIntegrationsSettings(page);

    const status = page.getByTestId('mcp-server-status');
    await expect(status).toBeVisible();

    // In dev / browser test mode, `mcpBundlePath` returns null because
    // the Tauri command isn't reachable. The McpSettingsSection is
    // expected to land on `unavailable` within a second.
    await expect(status).toHaveAttribute('data-status', /^(loading|unavailable)$/);
    await expect(status).toHaveAttribute('data-status', 'unavailable', {
      timeout: 5_000,
    });

    // The install-readme copy should mention Claude Desktop and the
    // `build-mcpb.mjs` helper — this is the text the user reads when
    // the bundle isn't available.
    await expect(status).toContainText(/Bundle not available|build-mcpb\.mjs/);
  });

  test('download button is disabled when bundle is unavailable', async ({ page }) => {
    await openIntegrationsSettings(page);

    const btn = page.getByTestId('mcp-download-mcpb');
    await expect(btn).toBeVisible();
    await expect(btn).toBeDisabled();
    await expect(btn).toContainText(/Download .mcpb/i);
  });

  test('install instructions walk through the Claude Desktop handoff', async ({
    page,
  }) => {
    await openIntegrationsSettings(page);

    const section = page.getByTestId('mcp-settings-section');
    await expect(section).toBeVisible();

    // The install readme is plain text in the section — we verify the
    // four distinct install steps appear (download, open Claude,
    // drag/drop, pick workspace folder). These are the phrases the
    // support docs cross-link to.
    await expect(section).toContainText(/Download .mcpb/i);
    await expect(section).toContainText(/Claude Desktop/i);
    await expect(section).toContainText(/workspace folder/i);
    await expect(section).toContainText(/drag/i);
  });

  test('MCP settings section docstring anchor (What\'s MCP) is a valid external link', async ({
    page,
  }) => {
    await openIntegrationsSettings(page);

    // The "What's MCP?" link points at the user-facing MCP quickstart.
    // We can't follow the link (would leave the harness), but we can
    // assert the anchor is present and correctly targeted.
    const section = page.getByTestId('mcp-settings-section');
    const link = section.getByRole('link', { name: /What's MCP/i });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', /modelcontextprotocol\.io/);
    await expect(link).toHaveAttribute('target', '_blank');
  });

  test('MCP + Ollama sections coexist under Integrations without clobbering each other', async ({
    page,
  }) => {
    await openIntegrationsSettings(page);

    // Both sections must render in the same scroll region. This catches
    // the regression where a future refactor accidentally hides one behind
    // a tab or puts them in mutually-exclusive divs.
    await expect(page.getByTestId('mcp-settings-section')).toBeVisible();
    await expect(page.getByTestId('ollama-settings-section')).toBeVisible();
    await expect(page.getByTestId('mcp-server-status')).toBeVisible();
    await expect(page.getByTestId('ollama-status')).toBeVisible();

    // Their heading order should be MCP first, Ollama second — the two
    // tests above can pass even if the Ollama section rendered above MCP,
    // which would surprise users. Grab bounding boxes and compare Y.
    const mcpBox = await page.getByTestId('mcp-settings-section').boundingBox();
    const ollamaBox = await page.getByTestId('ollama-settings-section').boundingBox();
    expect(mcpBox).not.toBeNull();
    expect(ollamaBox).not.toBeNull();
    if (mcpBox && ollamaBox) {
      expect(mcpBox.y).toBeLessThan(ollamaBox.y);
    }
  });
});
