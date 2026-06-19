/**
 * v1.5 Flag 2 — MCP server + `.mcpb` Desktop Extension bundle — E2E smoke tests
 *
 * Scope:
 *   1. The Account → Connections tab renders.
 *   2. The McpSettingsSection mounts with its testid skeleton present:
 *      status pill, download button, install readme.
 *   3. The status pill reports "Bundle not available" in dev mode (no
 *      bundle built on disk) OR "Ready to install" when CI has built one
 *      — either is acceptable; we just verify one of those two states.
 *
 * Full binary-level MCP testing (JSON-RPC `initialize`, `tools/list`,
 * `tools/call list_workspace_files` / `search_workspace` /
 * `write_workspace_file` with approval channel) is covered by the Rust
 * integration tests in `src-tauri/tests/mcp_binary.rs` — that suite spawns
 * the built binary with a throwaway workspace and drives the full protocol.
 * Running that from Playwright would require bundling the binary into the
 * dev server, which isn't part of the E2E harness.
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad, hardClick } from './helpers/test-utils';

async function openAccountConnections(page: import('@playwright/test').Page) {
  await hardClick(page.getByTestId('account-identity'));
  await expect(page.getByTestId('account-window')).toBeVisible();
  await hardClick(page.getByTestId('account-tab-connections'));
  await expect(page.getByTestId('mcp-settings-section')).toBeVisible();
}

test.describe('v1.5 Flag 2 — MCP server', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
  });

  test('Account → Connections shows the MCP settings section', async ({ page }) => {
    await openAccountConnections(page);

    // Status pill resolves to one of the known states. In dev / browser
    // mode the bundle isn't on disk, so we expect `unavailable` or
    // `loading` → `unavailable`. A CI-built release pipeline would show
    // `ready`; either is acceptable. The pill reports its state via the
    // `data-status` attribute.
    const status = page.getByTestId('mcp-server-status');
    await expect(status).toBeVisible();
    await expect(status).toHaveAttribute(
      'data-status',
      /^(loading|ready|unavailable)$/
    );
  });

  test('MCP download button exists under the status pill', async ({ page }) => {
    await openAccountConnections(page);

    const downloadBtn = page.getByTestId('mcp-download-mcpb');
    await expect(downloadBtn).toBeVisible();
    // Disabled in browser/dev mode because the bundle path resolves to
    // null. That's the correct state for a test run that doesn't produce
    // a `.mcpb`.
    await expect(downloadBtn).toBeDisabled();
  });

  test('Ollama settings section also renders under Account → Connections', async ({ page }) => {
    // Q7 adds the Ollama provider under the same Account connection tab.
    // Verify it co-exists with the MCP section without breaking layout.
    await openAccountConnections(page);

    await expect(page.getByTestId('mcp-settings-section')).toBeVisible();
    await expect(page.getByTestId('ollama-settings-section')).toBeVisible();

    const ollamaStatus = page.getByTestId('ollama-status');
    await expect(ollamaStatus).toBeVisible();
    await expect(ollamaStatus).toHaveAttribute(
      'data-status',
      /^(checking|ready|unavailable)$/
    );
  });
});
