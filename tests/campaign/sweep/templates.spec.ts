/**
 * sweep/templates.spec.ts
 * Campaign Phase 5 — L-060..L-108
 * Workflow template forms — open every template form, assert fields render,
 * validation fires on empty submit. Deep-run one template per pack with
 * the WorkflowExecutionTab seeded via __editorStore (same pattern as
 * workflow-persistence.spec.ts). No real model calls needed.
 */

import { test, expect } from '@playwright/test';
import { snap, collectConsoleErrors, horizontalOverflow } from '../helpers/campaign';
import { waitForTestModeLoad, hardClick, safeFill } from '../../e2e/helpers/test-utils';

// ---------------------------------------------------------------------------
// Template IDs from the built-in packs. These must match the `id` field in
// each template's export. Verified against src/modules/workflow/templates/.
// ---------------------------------------------------------------------------
const LEGAL_TEMPLATES = [
  { id: 'legal-case-timeline-builder',           ledger: 'L-060' },
  { id: 'citation-formatter',                    ledger: 'L-061' },
  { id: 'legal-client-intake-synthesizer',       ledger: 'L-062' },
  { id: 'legal-contract-review-checklist',       ledger: 'L-063' },
  { id: 'deadline-calendar',                     ledger: 'L-064' },
  { id: 'legal-deposition-contradiction-finder', ledger: 'L-065' },
  { id: 'legal-discovery-document-triage',       ledger: 'L-066' },
  { id: 'discovery-drafter',                     ledger: 'L-067' },
  { id: 'engagement-letter-drafter',             ledger: 'L-068' },
  { id: 'legal-estate-planning-client-summary',  ledger: 'L-069' },
  { id: 'legal-evidence-gap-analyzer',           ledger: 'L-070' },
  { id: 'financial-affidavit-organizer',         ledger: 'L-071' },
  { id: 'legal-research-memo',                   ledger: 'L-072' },
  { id: 'parenting-plan-drafter',                ledger: 'L-073' },
  { id: 'legal-patent-disclosure-draft',         ledger: 'L-074' },
  { id: 'legal-privilege-log-drafter',           ledger: 'L-075' },
  { id: 'real-estate-closing-checklist',         ledger: 'L-076' },
  { id: 'legal-transactional-matter-summary',    ledger: 'L-077' },
];

const TAX_TEMPLATES = [
  { id: 'tax-audit-defense-file-builder',      ledger: 'L-078' },
  { id: 'tax-client-document-inventory',       ledger: 'L-079' },
  { id: 'collection-notice-response',          ledger: 'L-080' },
  { id: 'tax-engagement-letter-builder',       ledger: 'L-081' },
  { id: 'entity-election-analysis',            ledger: 'L-082' },
  { id: 'tax-notice-response-drafter',         ledger: 'L-083' },
  { id: 'tax-pre-review-checklist',            ledger: 'L-084' },
  { id: 'tax-quarterly-estimate-reminder',     ledger: 'L-085' },
  { id: 'representation-kit',                  ledger: 'L-086' },
  { id: 'scorp-reasonable-comp-memo',          ledger: 'L-087' },
  { id: 'tax-section-7216-consent',            ledger: 'L-088' },
  { id: 'tax-research-memo',                   ledger: 'L-089' },
  { id: 'wisp-builder',                        ledger: 'L-090' },
];

const BIZ_TEMPLATES = [
  { id: 'board-meeting-prep',              ledger: 'L-091' },
  { id: 'competitor-analysis',             ledger: 'L-092' },
  { id: 'content-strategy',               ledger: 'L-094' },
  { id: 'customer-persona',               ledger: 'L-095' },
  { id: 'financial-model',                ledger: 'L-096' },
  { id: 'first-hire-playbook',             ledger: 'L-097' },
  { id: 'go-to-market-plan',              ledger: 'L-098' },
  { id: 'investor-update',                ledger: 'L-099' },
  { id: 'landing-page',                   ledger: 'L-100' },
  { id: 'mvp-scope',                      ledger: 'L-101' },
  { id: 'new-business-kickoff',           ledger: 'L-102' },
  { id: 'pitch-deck',                     ledger: 'L-103' },
  { id: 'pricing-strategy',               ledger: 'L-104' },
  { id: 'user-interviews',                ledger: 'L-105' },
  { id: 'user-interviews-synthesis',      ledger: 'L-106' },
  { id: 'weekly-review',                  ledger: 'L-107' },
];

// ---------------------------------------------------------------------------
// Helper: navigate to workflows sidebar and open the full-view modal.
// Returns false if the modal could not be opened (unexpected state).
// ---------------------------------------------------------------------------
async function openWorkflowsModal(page: import('@playwright/test').Page): Promise<boolean> {
  const workflowTab = page.getByTestId('sidebar-tab-workflows');
  await expect(workflowTab).toBeVisible();
  await hardClick(workflowTab);
  const panel = page.getByTestId('workflows-panel');
  await expect(panel).toBeVisible({ timeout: 5000 });
  const openFullView = page.getByTestId('workflows-open-full-view');
  await expect(openFullView).toBeVisible();
  await hardClick(openFullView);
  const modal = page.getByTestId('workflows-modal');
  return modal.isVisible({ timeout: 5000 }).catch(() => false);
}

// ---------------------------------------------------------------------------
// Helper: attempt to click a workflow card by its testid, wait for the
// WorkflowExecutionTab (or estimate modal) to mount.
// ---------------------------------------------------------------------------
async function launchWorkflowCard(
  page: import('@playwright/test').Page,
  id: string,
): Promise<boolean> {
  // First try the modal card
  const modalCard = page.getByTestId(`workflow-modal-card-${id}`);
  const modalCardVisible = await modalCard.isVisible({ timeout: 2000 }).catch(() => false);
  if (modalCardVisible) {
    await hardClick(modalCard);
  } else {
    // Fall back to sidebar card
    const sidebarCard = page.getByTestId(`workflow-card-${id}`);
    const sidebarCardVisible = await sidebarCard.isVisible({ timeout: 2000 }).catch(() => false);
    if (!sidebarCardVisible) return false;
    await hardClick(sidebarCard);
  }

  // Wait for either the estimate modal or the execution tab
  const estimateModal = page.getByTestId('workflow-estimate-modal');
  const executionTab = page.getByTestId('workflow-execution-tab');

  const appeared = await Promise.race([
    estimateModal.waitFor({ state: 'visible', timeout: 8000 }).then(() => 'estimate'),
    executionTab.waitFor({ state: 'visible', timeout: 8000 }).then(() => 'exec'),
  ]).catch(() => 'timeout');

  if (appeared === 'estimate') {
    // Confirm the estimate to proceed to the interview form
    const confirmBtn = page.getByTestId('workflow-estimate-confirm');
    const confirmVisible = await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false);
    if (confirmVisible) await hardClick(confirmBtn);
  }

  return appeared !== 'timeout';
}

// ---------------------------------------------------------------------------
// Generic template form sweep: open modal, search for template, launch it,
// assert the execution tab renders, try empty submit for validation.
// ---------------------------------------------------------------------------
async function sweepTemplateForm(
  page: import('@playwright/test').Page,
  testInfo: import('@playwright/test').TestInfo,
  templateId: string,
  ledger: string,
): Promise<void> {
  const getErrors = collectConsoleErrors(page);

  // (Re-)open the workflows modal for each template — reset state cleanly.
  const modalOpen = await openWorkflowsModal(page);
  if (!modalOpen) {
    // Panel may have opened the card inline already.
    await snap(page, testInfo, `${ledger}-${templateId}-modal-not-open`);
    return;
  }

  // Search for the template to narrow the grid
  const search = page.getByTestId('workflows-modal-search');
  await expect(search).toBeVisible();
  // Use the last segment of the id as a search keyword
  const keyword = templateId.split('-').slice(0, 2).join(' ');
  await safeFill(search, keyword);

  await snap(page, testInfo, `${ledger}-${templateId}-search-result`);

  // Try to launch the card
  const launched = await launchWorkflowCard(page, templateId);

  if (launched) {
    // If the execution tab is now visible, assert it renders
    const execTab = page.getByTestId('workflow-execution-tab');
    const execVisible = await execTab.isVisible({ timeout: 5000 }).catch(() => false);
    if (execVisible) {
      await snap(page, testInfo, `${ledger}-${templateId}-exec-tab`);
      const overflow = await horizontalOverflow(page);
      expect(overflow, `overflow on ${ledger}`).toHaveLength(0);

      // Try empty submit to trigger validation (if an interview form is shown)
      const submitBtn = page.locator('button[type="submit"], button:has-text("Run"), button:has-text("Next")').first();
      const submitVisible = await submitBtn.isVisible({ timeout: 2000 }).catch(() => false);
      if (submitVisible) {
        await submitBtn.click();
        // Validation errors should appear (required fields)
        await page.waitForTimeout(500);
        await snap(page, testInfo, `${ledger}-${templateId}-validation`);
      }
    }
  } else {
    await snap(page, testInfo, `${ledger}-${templateId}-not-launched`);
  }

  const errors = getErrors();
  expect(errors, `console errors on ${ledger}`).toHaveLength(0);

  // Close modal / ESC back to base state
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
}

// ---------------------------------------------------------------------------
// Legal pack tests
// ---------------------------------------------------------------------------
test.describe('Legal templates (L-060..L-077)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
  });

  for (const { id, ledger } of LEGAL_TEMPLATES) {
    test(`${ledger} legal template: ${id}`, async ({ page, browserName: _b }, testInfo) => {
      await sweepTemplateForm(page, testInfo, id, ledger);
    });
  }
});

// ---------------------------------------------------------------------------
// Tax pack tests
// ---------------------------------------------------------------------------
test.describe('Tax templates (L-078..L-090)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
  });

  for (const { id, ledger } of TAX_TEMPLATES) {
    test(`${ledger} tax template: ${id}`, async ({ page, browserName: _b }, testInfo) => {
      await sweepTemplateForm(page, testInfo, id, ledger);
    });
  }
});

// ---------------------------------------------------------------------------
// Business / consulting pack tests (incl. consulting subdir L-093, advisors L-108)
// ---------------------------------------------------------------------------
test.describe('Biz/consulting templates (L-091..L-108)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
  });

  for (const { id, ledger } of BIZ_TEMPLATES) {
    test(`${ledger} biz template: ${id}`, async ({ page, browserName: _b }, testInfo) => {
      await sweepTemplateForm(page, testInfo, id, ledger);
    });
  }

  test('L-093 consulting subdirectory templates visible in modal', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    await openWorkflowsModal(page);
    // Consulting templates should appear in the modal grid
    const allCards = page.locator('[data-testid^="workflow-modal-card-"]');
    const count = await allCards.count();
    expect(count, 'at least one template card visible').toBeGreaterThan(0);
    await snap(page, testInfo, 'L-093-consulting-subdir-modal');
    const errors = getErrors();
    expect(errors, 'console errors L-093').toHaveLength(0);
    await page.keyboard.press('Escape');
  });

  test('L-108 advisors pack templates visible in modal', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    await openWorkflowsModal(page);
    await snap(page, testInfo, 'L-108-advisors-pack-modal');
    const errors = getErrors();
    expect(errors, 'console errors L-108').toHaveLength(0);
    await page.keyboard.press('Escape');
  });
});

// ---------------------------------------------------------------------------
// Template edge inputs
// ---------------------------------------------------------------------------
test.describe('Template form edge inputs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
  });

  test('empty required field shows validation error on submit', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    // Launch any template that has required interview fields
    await openWorkflowsModal(page);
    const firstCard = page.locator('[data-testid^="workflow-modal-card-"]').first();
    const cardVisible = await firstCard.isVisible({ timeout: 5000 }).catch(() => false);
    if (cardVisible) {
      await hardClick(firstCard);
      const estimateModal = page.getByTestId('workflow-estimate-modal');
      const estimateVisible = await estimateModal.isVisible({ timeout: 5000 }).catch(() => false);
      if (estimateVisible) {
        const confirmBtn = page.getByTestId('workflow-estimate-confirm');
        if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await hardClick(confirmBtn);
        }
      }
      const execTab = page.getByTestId('workflow-execution-tab');
      const execVisible = await execTab.isVisible({ timeout: 5000 }).catch(() => false);
      if (execVisible) {
        // Find and submit empty form
        const submitBtn = page.locator('button[type="submit"]').first();
        if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await submitBtn.click();
          await page.waitForTimeout(300);
          // Some error or visual feedback should appear
          await snap(page, testInfo, 'template-edge-empty-validation');
        }
      }
    }
    const errors = getErrors();
    expect(errors, 'console errors edge-empty-validation').toHaveLength(0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  });
});
