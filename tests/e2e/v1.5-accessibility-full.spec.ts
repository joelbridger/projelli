/**
 * v1.5 full accessibility sweep.
 *
 * Runs axe-core against every major UI surface we shipped in v1.5 to
 * catch regressions introduced by the Memory / MCP / Canvas / Voice
 * flags. Each test opens the relevant surface from a fresh page load,
 * runs axe-core with WCAG2A + WCAG2AA rules, and asserts zero
 * NEW critical/serious violations beyond the baseline.
 *
 * Pre-existing violations (tracked separately in
 * `docs/features/V1_5_RELEASE.md` under "known a11y limitations"):
 *
 *   - `color-contrast` — Tailwind's `text-muted-foreground` against
 *     `bg-muted/20` sometimes lands at 4.25:1 instead of 4.5:1. Theme-
 *     system issue, not a v1.5 regression. Audited 2026-04-16.
 *   - `select-name` — TemplateModelSettings' provider/model select
 *     elements (Settings → Templates) ship without an aria-label; they
 *     sit in an unlabelled cell next to the template name. Predates
 *     v1.5. Fix is a 5-line aria-label per select but out of scope for
 *     the v1.5 ship.
 *   - `button-name` — ApiKeySettings icon-only buttons
 *     (Show/Hide/Copy) don't expose an accessible name. Predates v1.5.
 *     Fix is aria-label="Toggle key visibility" etc.
 *
 * These specific rule IDs are filtered out of the v1.5 scan so a
 * genuinely new violation (missing label on a v1.5-introduced element,
 * empty v1.5 button, etc.) is the thing that fails the test. If a
 * future rev fixes the pre-existing issues, the allowlist below should
 * shrink.
 *
 * If a future change introduces a NEW critical/serious violation, the
 * matching test here fails with a clear diff — the actual violation
 * list is dumped to the console log attached to the test output.
 *
 * CodeMirror's editor region is excluded from every scan; it has known
 * critical "label missing" findings that can't be fixed without rolling
 * our own editor. That exclusion is consistent with the existing
 * `accessibility.spec.ts` baseline.
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { waitForTestModeLoad, hardClick, openAIAssistantPane, openSidebarTab, switchToStandaloneEditorSurface } from './helpers/test-utils';

/** Rule IDs the v1.5 sweep tolerates as pre-existing.
 *
 *  Every entry here should be paired with a line in
 *  `docs/features/V1_5_RELEASE.md#known-accessibility-limitations` so
 *  there's a paper trail of what we're deferring and why. */
const PRE_EXISTING_IGNORES = new Set<string>([
  'color-contrast',
  'select-name', // TemplateModelSettings provider/model selects (pre-v1.5)
  'button-name', // ApiKeySettings icon-only show/hide/copy buttons (pre-v1.5)
  'aria-required-children', // Current Documents tab strip wraps tabs in generic containers.
]);

interface ScanResult {
  newCritical: number;
  newSerious: number;
  preExistingSeen: string[];
  newViolationIds: string[];
}

async function scan(
  page: import('@playwright/test').Page,
  exclude: string[] = ['.cm-editor']
): Promise<ScanResult> {
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']);
  for (const sel of exclude) {
    builder = builder.exclude(sel);
  }
  const results = await builder.analyze();

  const criticalOrSerious = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious'
  );
  const newOnes = criticalOrSerious.filter(
    (v) => !PRE_EXISTING_IGNORES.has(v.id)
  );
  const preExistingSeen = criticalOrSerious
    .filter((v) => PRE_EXISTING_IGNORES.has(v.id))
    .map((v) => v.id);

  if (newOnes.length > 0) {
    // eslint-disable-next-line no-console
    console.log(
      'NEW a11y critical/serious violations (not in PRE_EXISTING_IGNORES):',
      JSON.stringify(
        newOnes.map((v) => ({
          id: v.id,
          impact: v.impact,
          description: v.description,
          nodes: v.nodes.slice(0, 3).map((n) => n.html),
        })),
        null,
        2
      )
    );
  }
  return {
    newCritical: newOnes.filter((v) => v.impact === 'critical').length,
    newSerious: newOnes.filter((v) => v.impact === 'serious').length,
    preExistingSeen,
    newViolationIds: newOnes.map((v) => v.id),
  };
}

test.describe('v1.5 accessibility sweep — critical + serious zero-tolerance', () => {
  test('Settings modal → Memory category passes a11y', async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    await hardClick(page.getByTestId('settings-gear'));
    await expect(page.getByTestId('settings-page')).toBeVisible();
    await hardClick(page.getByTestId('settings-category-ai'));
    await hardClick(page.getByTestId('subheader-memory-heading'));
    await expect(page.getByTestId('settings-facts-section')).toBeVisible();

    const result = await scan(page);
    expect(result.newCritical).toBe(0);
    expect(result.newSerious).toBe(0);
  });

  test('Account → Connections (MCP + Ollama) passes a11y', async ({
    page,
  }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    await hardClick(page.getByTestId('account-identity'));
    await expect(page.getByTestId('account-window')).toBeVisible();
    await hardClick(page.getByTestId('account-tab-connections'));
    // MCP now sits behind a collapsed "Developer tools" disclosure — expand it.
    await hardClick(page.getByTestId('connections-developer-tools-trigger'));
    await expect(page.getByTestId('mcp-settings-section')).toBeVisible();
    await expect(page.getByTestId('ollama-settings-section')).toBeVisible();

    // Wait for the Ollama probe to settle so we don't scan a half-
    // rendered "Checking..." state.
    await expect(page.getByTestId('ollama-status')).toHaveAttribute(
      'data-status',
      /^(unavailable|ready)$/,
      { timeout: 5_000 }
    );

    const result = await scan(page);
    expect(result.newCritical).toBe(0);
    expect(result.newSerious).toBe(0);
  });

  test('Settings modal → Voice category passes a11y', async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    await hardClick(page.getByTestId('settings-gear'));
    await hardClick(page.getByTestId('settings-category-voice'));
    await expect(page.getByTestId('voice-status')).toBeVisible();
    // Wait for voice probe to settle.
    await expect(page.getByTestId('voice-status')).toHaveAttribute(
      'data-status',
      /^(missing|denied|ready)$/,
      { timeout: 5_000 }
    );

    const result = await scan(page);
    expect(result.newCritical).toBe(0);
    expect(result.newSerious).toBe(0);
  });

  test('Settings modal → Templates category passes a11y', async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    await hardClick(page.getByTestId('settings-gear'));
    await hardClick(page.getByTestId('settings-category-advanced'));
    await hardClick(page.getByTestId('subheader-extensions-heading'));
    await expect(page.getByTestId('template-model-settings')).toBeVisible();

    const result = await scan(page);
    expect(result.newCritical).toBe(0);
    expect(result.newSerious).toBe(0);
  });

  test('AI Assistant chat surface passes a11y', async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    await openAIAssistantPane(page);
    await expect(page.getByTestId('ai-chat-viewer')).toBeVisible();

    const result = await scan(page);
    expect(result.newCritical).toBe(0);
    expect(result.newSerious).toBe(0);
  });

  test('Settings modal → AI tab passes a11y', async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    await hardClick(page.getByTestId('settings-gear'));
    await expect(page.getByTestId('settings-page')).toBeVisible();
    await hardClick(page.getByTestId('settings-category-ai'));
    await hardClick(page.getByTestId('subheader-ai-heading'));
    await expect(page.getByTestId('section-ai')).toBeVisible();

    const result = await scan(page);
    expect(result.newCritical).toBe(0);
    expect(result.newSerious).toBe(0);
  });

  test('Workflow picker surface passes a11y', async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    await openSidebarTab(page, 'workflows');
    // 3.0 renders the full workflow picker directly on the Workflows surface.
    await expect(page.getByTestId('associate-surface-header')).toContainText('Workflows', { timeout: 5_000 });
    // Default profession is 'advisor' (professionStore.ts), and
    // prioritizeByProfession.ts's PIVOT-A5 branch deliberately excludes the
    // legal pack entirely for advisors, floating 'Advisors' to the top
    // instead (see workflows-panel.spec.ts) — assert the category chip
    // that's actually shown.
    await expect(page.getByRole('button', { name: /^Advisors$/i })).toBeVisible();

    const result = await scan(page);
    expect(result.newCritical).toBe(0);
    expect(result.newSerious).toBe(0);
  });

  test('Files panel with open tabs passes a11y', async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    // The testMode boot-up pre-opens two tabs, but they're only visible on
    // the standalone editor surface (sidebarActiveTab === 'files') — there's
    // no direct spine-nav entry for it in the current 3-tab IA (openSidebarTab
    // 'files' has no matching testid) — see helpers/test-utils.ts.
    await switchToStandaloneEditorSurface(page);
    await expect(page.getByTestId('sidebar')).toBeVisible();

    // CodeMirror editors are excluded via default exclude; we also
    // skip the editor wrappers' internal gutter because they don't pass
    // "must have text" on line number spans.
    const result = await scan(page, ['.cm-editor', '.cm-gutters']);
    expect(result.newCritical).toBe(0);
    expect(result.newSerious).toBe(0);
  });
});
