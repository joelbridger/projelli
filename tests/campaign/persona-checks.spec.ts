/**
 * persona-checks.spec.ts — Task 7 of the Diane Marchetti study: extended spot
 * checks. Each check is isolated (its own test) so one failure never blocks the
 * rest. Screenshots land under the `persona-checks` journey and are copied into
 * `persona/` after the run. Real fixtures from tests/fixtures/matter-corpus/.
 */

import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { snap, collectConsoleErrors } from './helpers/campaign';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, '../fixtures/matter-corpus');

async function dump(page: Page, label: string, selector?: string): Promise<void> {
  const text = await page.evaluate((sel) => {
    const el = sel ? document.querySelector(sel) : document.body;
    return el ? (el as HTMLElement).innerText : `(selector not found: ${sel ?? 'body'})`;
  }, selector ?? null);
  console.log(`\n===PERSONA-DUMP[${label}]===\n${text}\n===END-DUMP[${label}]===`);
}

async function boot(page: Page, query = '/?testMode=true'): Promise<void> {
  await page.goto(query);
  await page.getByTestId('sidebar').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(900);
}

// ── Check A — privilege tagging + retrieval exclusion affordance ──────────────
test('Task 7A: privilege tagging affordance', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const getErrors = collectConsoleErrors(page);
  await boot(page, '/?testMode=true&recordMatter=1');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press('Control+Shift+a');
  await page.getByTestId('ai-assistant-tab').waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(800);
  const privToggle = page.getByTestId('include-privileged-toggle');
  const seen = await privToggle.isVisible({ timeout: 4000 }).catch(() => false);
  console.log(`PERSONA-NOTE: include-privileged-toggle visible = ${seen}`);
  if (seen) {
    await dump(page, 't7a-chat-header', '[data-testid="ai-chat-viewer"]');
    await privToggle.click().catch(() => {});
    await page.waitForTimeout(300);
  }
  await snap(page, testInfo, 't7a-01-privilege-toggle');
  // Privileged Matter Mode status badge (set by Local-only / privileged matter).
  const badge = page.getByTestId('privileged-matter-badge');
  console.log(`PERSONA-NOTE: privileged-matter-badge visible = ${await badge.isVisible({ timeout: 1500 }).catch(() => false)}`);
  console.log(`PERSONA-NOTE: t7a console errors = ${getErrors().length}`);
  expect(true).toBe(true);
});

// ── Check B — redline round-trip on the fixture engagement letter ─────────────
test('Task 7B: tracked-changes redline round-trip', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const getErrors = collectConsoleErrors(page);
  await boot(page);
  const b64 = fs.readFileSync(path.join(FIXTURES, 'engagement-letter-tracked.docx')).toString('base64');
  const dataUrl = `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${b64}`;
  await page.evaluate(({ url }) => {
    const ed = (window as any).__editorStore?.getState?.();
    ed?.openTab?.('/test-workspace/engagement-letter-tracked.docx', 'engagement-letter-tracked.docx', url, 'file');
  }, { url: dataUrl });

  const editor = page.getByTestId('docx-editor');
  await editor.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await dump(page, 't7b-docx-loaded', '[data-testid="docx-editor"]');
  await snap(page, testInfo, 't7b-01-docx-loaded');

  // Count rendered tracked-change runs.
  const ins = await page.locator('[data-testid="docx-insertion"]').count().catch(() => 0);
  const del = await page.locator('[data-testid="docx-deletion"]').count().catch(() => 0);
  const comments = await page.locator('[data-testid="docx-comment-marker"]').count().catch(() => 0);
  console.log(`PERSONA-NOTE: tracked insertions=${ins} deletions=${del} comment-markers=${comments}`);

  // Open the review pane.
  const reviewToggle = page.getByTestId('docx-toggle-review-pane');
  if (await reviewToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
    await reviewToggle.click();
    await page.waitForTimeout(600);
    await dump(page, 't7b-review-pane', '[data-testid="docx-review-pane"]');
    await snap(page, testInfo, 't7b-02-review-pane');
    // Accept one change.
    const acceptOne = page.getByTestId('docx-accept-one').first();
    if (await acceptOne.isVisible({ timeout: 2000 }).catch(() => false)) {
      await acceptOne.click();
      await page.waitForTimeout(400);
      await snap(page, testInfo, 't7b-03-after-accept-one');
      console.log('PERSONA-NOTE: accepted one change');
    }
    // Reject one change.
    const rejectOne = page.getByTestId('docx-reject-one').first();
    if (await rejectOne.isVisible({ timeout: 2000 }).catch(() => false)) {
      await rejectOne.click();
      await page.waitForTimeout(400);
      console.log('PERSONA-NOTE: rejected one change');
    }
    // Accept all remaining.
    const acceptAll = page.getByTestId('docx-accept-all');
    if (await acceptAll.isVisible({ timeout: 2000 }).catch(() => false)) {
      await acceptAll.click();
      await page.waitForTimeout(500);
      await dump(page, 't7b-after-accept-all', '[data-testid="docx-review-pane"]');
      await snap(page, testInfo, 't7b-04-after-accept-all');
      console.log('PERSONA-NOTE: accept-all clicked');
    }
  } else {
    console.log('PERSONA-NOTE: docx review pane toggle not visible');
  }
  console.log(`PERSONA-NOTE: t7b console errors = ${getErrors().length}`);
  expect(true).toBe(true);
});

// ── Check C — Deposition Contradiction Finder vs the fixture transcript ───────
test('Task 7C: deposition contradiction finder', async ({ page }, testInfo) => {
  test.setTimeout(360_000);
  const getErrors = collectConsoleErrors(page);
  await boot(page);

  const transcript = fs.readFileSync(path.join(FIXTURES, 'deposition-transcript-johnson.txt'), 'utf8');
  const summary = fs.readFileSync(path.join(FIXTURES, 'incident-summary-johnson.md'), 'utf8');

  await page.getByTestId('sidebar-tab-workflows').click();
  await page.getByTestId('workflows-panel').waitFor({ state: 'visible', timeout: 5000 });
  const openFull = page.getByTestId('workflows-open-full-view');
  if (await openFull.isVisible({ timeout: 2000 }).catch(() => false)) {
    await openFull.click();
    await page.getByTestId('workflows-modal').waitFor({ state: 'visible', timeout: 5000 });
  }
  const card = page.getByTestId('workflow-modal-card-legal-deposition-contradiction-finder');
  await card.scrollIntoViewIfNeeded();
  await card.getByRole('button', { name: 'Start' }).click();

  // Estimate modal → confirm.
  const estimate = page.getByTestId('workflow-estimate-modal');
  if (await estimate.isVisible({ timeout: 6000 }).catch(() => false)) {
    await page.getByTestId('workflow-estimate-confirm').click();
  }
  // Questions dialog.
  const qDialog = page.getByRole('dialog').filter({ hasText: 'Workflow Questions' });
  await qDialog.waitFor({ state: 'visible', timeout: 10_000 });
  const scope = (await qDialog.locator('form').first().isVisible({ timeout: 2000 }).catch(() => false))
    ? qDialog.locator('form').first()
    : qDialog;
  const textInputs = scope.locator('input[type="text"]');
  await textInputs.nth(0).fill('Johnson v. Nexus Dynamics');
  if (await textInputs.count() > 1) await textInputs.nth(1).fill('Marcus Johnson');
  if (await textInputs.count() > 2) await textInputs.nth(2).fill('2025-11-04');
  const tas = scope.locator('textarea');
  const nta = await tas.count();
  // keyClaims, depositionExcerpts, priorStatements — fill last two with fixtures.
  if (nta >= 3) {
    await tas.nth(0).fill('Whether documents left company systems; the compliance response deadline date; the severance offer length.');
    await tas.nth(1).fill(transcript.slice(0, 6000));
    await tas.nth(2).fill(summary.slice(0, 3500));
  } else if (nta === 2) {
    await tas.nth(0).fill(transcript.slice(0, 6000));
    await tas.nth(1).fill(summary.slice(0, 3500));
  }
  await snap(page, testInfo, 't7c-01-inputs-filled');
  const cont = scope.locator('button[type="submit"]').first();
  if (await cont.isVisible({ timeout: 1500 }).catch(() => false)) {
    await cont.click({ force: true });
  } else {
    await qDialog.getByRole('button', { name: /continue|submit|generate/i }).first().click({ force: true });
  }
  console.log('PERSONA-NOTE: contradiction finder submitted');

  // Wait for completion (Generated Output / analyze summary / file link).
  await Promise.race([
    page.getByText('Generated Output').first().waitFor({ state: 'visible', timeout: 240_000 }),
    page.getByTestId('workflow-analyze-summary').waitFor({ state: 'visible', timeout: 240_000 }),
    page.locator('[data-testid^="workflow-file-link-"]').first().waitFor({ state: 'visible', timeout: 240_000 }),
  ]).catch(() => console.log('PERSONA-NOTE: contradiction finder did not reach completion in time'));
  await page.waitForTimeout(1000);
  await dump(page, 't7c-result', '[data-testid="workflow-execution-tab"]');
  await snap(page, testInfo, 't7c-02-result');
  console.log(`PERSONA-NOTE: t7c console errors = ${getErrors().length}`);
  expect(true).toBe(true);
});

// ── Check D — version history ─────────────────────────────────────────────────
test('Task 7D: version history', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const getErrors = collectConsoleErrors(page);
  await boot(page);
  await page.getByText('test1', { exact: true }).first().click();
  await page.waitForTimeout(500);
  const cm = page.locator('.cm-content').first();
  await cm.click();
  // Make a couple of edits with pauses so versions are captured.
  await page.keyboard.type('\n\nDiane edit 1: note for version history.');
  await page.waitForTimeout(2600);
  await page.keyboard.type('\n\nDiane edit 2: second revision.');
  await page.waitForTimeout(2600);
  const histBtn = page.getByTestId('toolbar-history');
  let label = '';
  if (await histBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    label = await histBtn.innerText().catch(() => '');
    await histBtn.click();
  } else {
    const overflow = page.getByTestId('toolbar-overflow-history');
    if (await overflow.isVisible({ timeout: 2000 }).catch(() => false)) {
      label = await overflow.innerText().catch(() => '');
      await overflow.click();
    }
  }
  console.log(`PERSONA-NOTE: history button label = "${label}"`);
  await page.waitForTimeout(800);
  await dump(page, 't7d-history', '[data-testid="main-panel"]');
  await snap(page, testInfo, 't7d-01-version-history');
  console.log(`PERSONA-NOTE: t7d console errors = ${getErrors().length}`);
  expect(true).toBe(true);
});

// ── Check E — trash / restore ─────────────────────────────────────────────────
test('Task 7E: trash and restore', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const getErrors = collectConsoleErrors(page);
  await boot(page, '/?testMode=true&recordMatter=1');
  await page.getByTestId('sidebar-tab-trash').click();
  await page.waitForTimeout(700);
  await dump(page, 't7e-trash', '[data-testid="sidebar"]');
  await snap(page, testInfo, 't7e-01-trash-panel');
  // Restore affordance present?
  const restore = page.getByRole('button', { name: /restore/i }).first();
  console.log(`PERSONA-NOTE: trash restore button visible = ${await restore.isVisible({ timeout: 1500 }).catch(() => false)}`);
  console.log(`PERSONA-NOTE: t7e console errors = ${getErrors().length}`);
  expect(true).toBe(true);
});

// ── Check F — trial banner / upgrade touchpoint ───────────────────────────────
test('Task 7F: trial / upgrade touchpoint', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const getErrors = collectConsoleErrors(page);
  await boot(page);
  const chip = page.getByTestId('status-bar-trial-chip');
  await dump(page, 't7f-chip', '[data-testid="status-bar"]');
  if (await chip.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log(`PERSONA-NOTE: trial chip = "${(await chip.innerText()).replace(/\n/g, ' ')}"`);
    await chip.click();
    await page.getByTestId('settings-modal').waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(600);
    await dump(page, 't7f-license', '[data-testid="settings-modal"]');
    await snap(page, testInfo, 't7f-01-license-settings');
    // Pricing tiers present?
    const pricing = page.getByTestId('pricing-tiers');
    if (await pricing.isVisible({ timeout: 2000 }).catch(() => false)) {
      await dump(page, 't7f-pricing', '[data-testid="pricing-tiers"]');
      await snap(page, testInfo, 't7f-02-pricing-tiers');
    } else {
      const buy = page.getByTestId('license-buy-button');
      console.log(`PERSONA-NOTE: license-buy-button visible = ${await buy.isVisible({ timeout: 1500 }).catch(() => false)}`);
    }
  } else {
    console.log('PERSONA-NOTE: status-bar trial chip not visible');
  }
  console.log(`PERSONA-NOTE: t7f console errors = ${getErrors().length}`);
  expect(true).toBe(true);
});

// ── Check G — F-009 probe: can she find matter management unaided? ────────────
test('Task 7G: F-009 find matter management unaided', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const getErrors = collectConsoleErrors(page);
  await boot(page);
  // Enumerate the sidebar tabs a cold user would scan.
  const tabs = await page.locator('[data-testid^="sidebar-tab-"]:not([data-testid$="-icon"]):not([data-testid$="-tooltip"])').allInnerTexts().catch(() => []);
  const tabIds = await page.locator('[data-testid^="sidebar-tab-"]').evaluateAll(
    (els) => els.map((e) => (e as HTMLElement).getAttribute('data-testid')).filter((t) => t && !t.endsWith('-icon') && !t.endsWith('-tooltip')),
  ).catch(() => []);
  console.log(`PERSONA-NOTE: sidebar tab ids = ${JSON.stringify(tabIds)}`);
  console.log(`PERSONA-NOTE: sidebar tab labels = ${JSON.stringify(tabs)}`);
  const hasMatterTab = tabIds.some((t) => /matter/i.test(t ?? ''));
  console.log(`PERSONA-NOTE: dedicated 'Matters' sidebar tab exists = ${hasMatterTab}`);
  // Is there ANY top-level "matter" affordance outside the AI chat?
  const matterMenuOutsideChat = await page.getByText(/matter/i).first().isVisible({ timeout: 1500 }).catch(() => false);
  console.log(`PERSONA-NOTE: any visible 'matter' text on cold workspace = ${matterMenuOutsideChat}`);
  await snap(page, testInfo, 't7g-01-cold-workspace-sidebar');
  console.log(`PERSONA-NOTE: t7g console errors = ${getErrors().length}`);
  expect(true).toBe(true);
});
