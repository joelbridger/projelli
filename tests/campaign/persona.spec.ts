/**
 * persona.spec.ts — Diane Marchetti moderated usability study driver.
 *
 * This spec is the DRIVER for the persona study documented in
 * docs/quality/2026-06-10-v3-usability-campaign/persona-study-transcript.md.
 * It plays the participant's hands; the think-aloud is written from the
 * captured screenshots + text dumps. It does NOT hard-assert UX expectations —
 * a usability study records what happens; findings go in persona-findings.md.
 *
 * Run (task-scoped):
 *   CAMPAIGN_KEEP_SHOTS=1 npx playwright test -c playwright.campaign.config.ts \
 *     tests/campaign/persona.spec.ts --project=1366 -g "Task 1"
 */

import { test, expect, type Page } from '@playwright/test';
import { snap, collectConsoleErrors } from './helpers/campaign';

test.describe.configure({ mode: 'serial' });

const REALISTIC_INTAKE_MD = `# Client Intake Package — Teresa Okafor

## Matter Summary

**Prospective client:** Teresa Okafor
**Matter type:** Employment — wrongful termination / whistleblower retaliation
**Intake date:** June 8, 2026

Teresa Okafor worked at Lakeshore Medical Billing for nine years, most recently as
operations supervisor. She was terminated on May 27, 2026 and told the reason was
"restructuring," but her duties were reassigned to two recently hired employees within
weeks. In April she reported billing irregularities to the compliance officer, Dana
Whitfield, by email. She received a written warning on May 12 that she believes was
pretextual.

## Conflict Check Memo

| Name to Check | Relationship to Matter | Why to Check | Result |
|---|---|---|---|
| Teresa Okafor | Prospective client | Standard | (fill in) |
| Lakeshore Medical Billing | Adverse party | Employer / defendant | (fill in) |
| Dana Whitfield | Witness | Compliance officer who received report | (fill in) |
| Robert Okafor / Okafor IT Solutions LLC | Client spouse / vendor | Vendor to adverse party | (fill in) |
| Lakeshore Pediatrics | Former firm client (2019) | Name similarity — verify separate entity | (fill in) |

## Preliminary Scope of Work

1. Verify Ohio whistleblower statute notice and the 90-day filing window.
2. Collect and preserve the April compliance emails and the May 12 warning.
3. Evaluate severance posture and reinstatement demand.
4. Conflict check the parties above before engagement.
`;


/** Dump visible text to stdout so the moderator can quote exact copy. */
async function dump(page: Page, label: string, selector?: string): Promise<void> {
  const text = await page.evaluate((sel) => {
    const el = sel ? document.querySelector(sel) : document.body;
    return el ? (el as HTMLElement).innerText : `(selector not found: ${sel ?? 'body'})`;
  }, selector ?? null);
  console.log(`\n===PERSONA-DUMP[${label}]===\n${text}\n===END-DUMP[${label}]===`);
}

function logErrors(label: string, errors: string[]): void {
  console.log(`\n===PERSONA-CONSOLE[${label}]=== count=${errors.length}`);
  for (const e of errors) console.log(e.slice(0, 500));
  console.log(`===END-CONSOLE[${label}]===`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 1 — First run → working workspace (NO testMode, fresh context)
// ─────────────────────────────────────────────────────────────────────────────

test('Task 1: first run wizard to workspace', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const getErrors = collectConsoleErrors(page);

  // 1. Cold open — true first run, no testMode.
  await page.goto('/');
  await page.getByTestId('onboarding-next-welcome').waitFor({ state: 'visible', timeout: 20_000 });
  await dump(page, 't1-welcome');
  await snap(page, testInfo, 't1-01-first-launch');

  // 2. "Let's go" → profession picker.
  await page.getByTestId('onboarding-next-welcome').click();
  await page.getByTestId('profession-card-legal').waitFor({ state: 'visible', timeout: 5000 });
  await dump(page, 't1-profession');
  await snap(page, testInfo, 't1-02-profession-picker');

  // 3. Pick Legal.
  await page.getByTestId('profession-card-legal').click();
  await snap(page, testInfo, 't1-03-after-legal-pick');
  // Button label changes once profession picked — capture it.
  await dump(page, 't1-profession-cta', '[data-testid="onboarding-next-profession"]');
  await page.getByTestId('onboarding-next-profession').click();

  // 4. Workspace (folder) explainer step.
  await page.getByTestId('onboarding-workspace-next').waitFor({ state: 'visible', timeout: 5000 });
  await dump(page, 't1-workspace-step');
  await snap(page, testInfo, 't1-04-folder-explainer');
  await page.getByTestId('onboarding-workspace-next').click();

  // 5. Data-map step. Expand every accordion section and read it.
  await page.getByTestId('onboarding-data-continue').waitFor({ state: 'visible', timeout: 5000 });
  await snap(page, testInfo, 't1-05-data-map-step');
  const triggers = page.locator('[data-testid="onboarding-data-step"] button[aria-expanded]');
  const nTriggers = await triggers.count();
  console.log(`PERSONA-NOTE: data-map accordion sections = ${nTriggers}`);
  for (let i = 0; i < nTriggers; i++) {
    const trig = triggers.nth(i);
    const expanded = await trig.getAttribute('aria-expanded');
    if (expanded === 'false') {
      await trig.click();
      await page.waitForTimeout(150);
    }
  }
  await dump(page, 't1-data-map-expanded', '[data-testid="onboarding-data-step"]');
  await snap(page, testInfo, 't1-06-data-map-expanded');

  // 6. Continue → AI setup, three paths.
  await page.getByTestId('onboarding-data-continue').click();
  await page.getByTestId('ai-path-own-account').waitFor({ state: 'visible', timeout: 5000 });
  await dump(page, 't1-ai-choice');
  await snap(page, testInfo, 't1-07-ai-setup-choice');

  // 7. Diane peeks at the "own account" (BYOK) path first — the recommended one.
  await page.getByTestId('ai-path-own-account').click();
  await page.getByTestId('ai-setup-key-input').waitFor({ state: 'visible', timeout: 5000 });
  await dump(page, 't1-byok-claude');
  await snap(page, testInfo, 't1-08-byok-claude-steps');

  // She backs out ("Other options") without entering a key.
  await page.getByRole('button', { name: 'Other options' }).click();
  await page.getByTestId('ai-path-local').waitFor({ state: 'visible', timeout: 5000 });

  // 8. She picks "Keep everything on your computer" (Ollama).
  await page.getByTestId('ai-path-local').click();
  await page.getByTestId('ollama-status').waitFor({ state: 'visible', timeout: 5000 });
  // Wait for the detection to settle (ready / missing / no-models).
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="ollama-status"]');
    return el && !el.textContent?.includes('Checking');
  }, undefined, { timeout: 15_000 });
  await dump(page, 't1-local-ai');
  await snap(page, testInfo, 't1-09-local-ai-detected');

  // 9. Use local AI and continue → demo / samples step.
  const useLocal = page.getByTestId('ai-setup-use-local');
  const enabled = await useLocal.isEnabled();
  console.log(`PERSONA-NOTE: "Use local AI and continue" enabled=${enabled}`);
  if (enabled) {
    await useLocal.click();
  } else {
    // Ollama not detected — fall back to skip path, note it.
    await page.getByRole('button', { name: 'Other options' }).click();
    await page.getByTestId('ai-path-later').click();
  }
  await page.getByTestId('first-run-samples-toggle').waitFor({ state: 'visible', timeout: 5000 });
  await dump(page, 't1-demo-step');
  await snap(page, testInfo, 't1-10-first-workflow-step');

  // 10. "Open my workspace" — wizard completes.
  await page.getByRole('button', { name: 'Open my workspace' }).click();
  await page.waitForTimeout(1000);

  // 11. The REAL folder picker moment (WorkspaceSelector, browser mode).
  await dump(page, 't1-workspace-selector');
  await snap(page, testInfo, 't1-11-real-folder-picker');

  // Diane clicks "new workspace" — in a headless browser the native directory
  // picker cannot open. Capture exactly what she sees.
  const newWs = page.getByTestId('new-workspace');
  if (await newWs.isVisible({ timeout: 3000 }).catch(() => false)) {
    await newWs.click();
    await page.waitForTimeout(1500);
    await dump(page, 't1-folder-pick-result');
    await snap(page, testInfo, 't1-12-folder-pick-result');
  } else {
    console.log('PERSONA-NOTE: new-workspace button not visible after wizard');
  }

  logErrors('t1-pre-testmode', getErrors());

  // 12. HARNESS NOTE: the browser cannot complete a native folder pick.
  // Continue via ?testMode=true (mock workspace) — stated in the transcript.
  await page.goto('/?testMode=true');
  await page.getByTestId('sidebar').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(1500);
  await dump(page, 't1-workspace-first-view');
  await snap(page, testInfo, 't1-13-workspace-first-view');

  logErrors('t1-final', getErrors());
  expect(true).toBe(true);
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 2 — Workflow → Word deliverable (testMode workspace, Ollama running)
// ─────────────────────────────────────────────────────────────────────────────

test('Task 2: legal workflow to Word deliverable', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const getErrors = collectConsoleErrors(page);
  const providerLogs: string[] = [];
  page.on('console', (m) => {
    const t = m.text();
    if (/provider|API|mock|ollama/i.test(t)) providerLogs.push(`[${m.type()}] ${t}`);
  });

  await page.goto('/?testMode=true');
  await page.getByTestId('sidebar').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(1000);

  // 1. Diane looks for "Workflows" in the sidebar.
  await page.getByTestId('sidebar-tab-workflows').click();
  await page.getByTestId('workflows-panel').waitFor({ state: 'visible', timeout: 5000 });
  await dump(page, 't2-workflows-panel', '[data-testid="workflows-panel"]');
  await snap(page, testInfo, 't2-01-workflows-panel');

  // 2. Full view modal — the template gallery.
  const openFull = page.getByTestId('workflows-open-full-view');
  if (await openFull.isVisible({ timeout: 2000 }).catch(() => false)) {
    await openFull.click();
    await page.getByTestId('workflows-modal').waitFor({ state: 'visible', timeout: 5000 });
    await dump(page, 't2-workflows-modal', '[data-testid="workflows-modal"]');
    await snap(page, testInfo, 't2-02-workflows-gallery');
  }

  // 3. Launch the Client Intake Synthesizer from the gallery (Start button).
  const modalCard = page.getByTestId('workflow-modal-card-legal-client-intake-synthesizer');
  await modalCard.scrollIntoViewIfNeeded();
  await modalCard.getByRole('button', { name: 'Start' }).click();

  // Estimate modal may appear first — capture its copy.
  const estimate = page.getByTestId('workflow-estimate-modal');
  const exec = page.getByTestId('workflow-execution-tab');
  const which = await Promise.race([
    estimate.waitFor({ state: 'visible', timeout: 8000 }).then(() => 'estimate'),
    exec.waitFor({ state: 'visible', timeout: 8000 }).then(() => 'exec'),
  ]).catch(() => 'none');
  console.log(`PERSONA-NOTE: after card click -> ${which}`);
  if (which === 'estimate') {
    await dump(page, 't2-estimate-modal', '[data-testid="workflow-estimate-modal"]');
    await snap(page, testInfo, 't2-03-estimate-modal');
    //

    await page.getByTestId('workflow-estimate-confirm').click();
    await exec.waitFor({ state: 'visible', timeout: 8000 });
  }
  await dump(page, 't2-execution-tab', '[data-testid="workflow-execution-tab"]');
  await snap(page, testInfo, 't2-04-execution-tab');

  // 4. The run starts immediately and pops a "Workflow Questions" dialog.
  // Fill THAT (it is the topmost surface a real user sees).
  const qDialog = page.getByRole('dialog').filter({ hasText: 'Workflow Questions' });
  await qDialog.waitFor({ state: 'visible', timeout: 10_000 });
  await dump(page, 't2-questions-dialog');
  const form = qDialog.locator('form').first();
  const formVisible = await form.isVisible({ timeout: 2000 }).catch(() => false);
  const scope = formVisible ? form : qDialog;

  // text input: client name
  await scope.locator('input[type="text"]').first().fill('Teresa Okafor');
  // selects: matterType, howTheyFoundYou, matterComplexity
  const selects = scope.locator('select');
  const nSel = await selects.count();
  for (let i = 0; i < nSel; i++) {
    const sel = selects.nth(i);
    const opts = await sel.locator('option').allInnerTexts();
    let pick = opts.findIndex((o) => /employment/i.test(o));
    if (pick < 0) pick = opts.findIndex((o) => /referral from existing/i.test(o));
    if (pick < 0) pick = opts.findIndex((o) => /moderate/i.test(o));
    if (pick < 0) pick = Math.min(1, opts.length - 1);
    await sel.selectOption({ index: pick });
    console.log(`PERSONA-NOTE: select#${i} options=[${opts.join(' | ')}] picked="${opts[pick]}"`);
  }
  // textareas: intake notes + potential conflicts
  const tas = scope.locator('textarea');
  await tas.nth(0).fill(
    'Call w/ Teresa Okafor 6/8. Worked at Lakeshore Medical Billing 9 yrs, ops supervisor. ' +
      'Terminated 5/27, told "restructuring" but her duties given to two younger hires within weeks. ' +
      'She raised billing irregularities w/ compliance in April (emailed Dana Whitfield, compliance officer). ' +
      'Wants reinstatement or severance bump. Has written warning from 5/12 she says was pretextual. ' +
      'Husband Robert Okafor runs a vendor co. that did IT work for Lakeshore — check conflict. ' +
      'Statute concerns: Ohio whistleblower 90-day window?? verify. She has copies of emails on personal laptop.'
  );
  const nTas = await tas.count();
  if (nTas > 1) {
    await tas.nth(1).fill('Robert Okafor / Okafor IT Solutions LLC (vendor to Lakeshore Medical Billing). We represented Lakeshore Pediatrics 2019 — different entity? verify.');
  }
  await snap(page, testInfo, 't2-05-interview-filled');

  // 5. Generate.
  await snap(page, testInfo, 't2-05b-questions-filled');
  const contBtn = scope.locator('button[type="submit"]').first();
  const haveSubmit = await contBtn.isVisible({ timeout: 1500 }).catch(() => false);
  if (haveSubmit) {
    await contBtn.click({ force: true });
  } else {
    await qDialog.getByRole('button', { name: /continue|submit|start/i }).first().click({ force: true });
  }
  console.log('PERSONA-NOTE: submitted interview');

  // 6. Wait for the run to finish — "Generated Output" panel or file links.
  const doneSignal = page.getByText('Generated Output').first();
  const fileLink = page.locator('[data-testid^="workflow-file-link-"]').first();
  await Promise.race([
    doneSignal.waitFor({ state: 'visible', timeout: 60_000 }),
    fileLink.waitFor({ state: 'visible', timeout: 60_000 }),
  ]);
  await page.waitForTimeout(800);
  await dump(page, 't2-run-complete', '[data-testid="workflow-execution-tab"]');
  await snap(page, testInfo, 't2-06-run-complete');

  // 7. Fill the firm name and export the .docx deliverable right from the
  // completion panel (this is the export surface Diane sees first).
  const firmName = page.getByPlaceholder(/acme law/i).first();
  if (await firmName.isVisible({ timeout: 2000 }).catch(() => false)) {
    await firmName.fill('Marchetti Law LLC');
  }
  const exportDocxBtn = page.getByRole('button', { name: /export \.docx/i }).first();
  if (await exportDocxBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    const dlPromise = page.waitForEvent('download', { timeout: 20_000 }).catch(() => null);
    await exportDocxBtn.click();
    const dl = await dlPromise;
    if (dl) {
      await dl.saveAs('/tmp/persona-t2-intake.docx');
      console.log(`PERSONA-NOTE: workflow export docx -> /tmp/persona-t2-intake.docx (${dl.suggestedFilename()})`);
    } else {
      console.log('PERSONA-NOTE: no download event from Export .docx');
      await page.waitForTimeout(1000);
      await dump(page, 't2-after-docx-export');
    }
    await snap(page, testInfo, 't2-07-after-docx-export');
  }

  // 8. Find the written deliverable in the Files tree and open it — how does
  // the document read in the editor (document or code)?
  await page.getByTestId('sidebar-tab-files').click();
  await page.waitForTimeout(600);
  await dump(page, 't2-file-tree-after-run', '[data-testid="sidebar"]');
  await snap(page, testInfo, 't2-08-file-tree-after-run');
  // Open the .workflow record's folder deliverable if visible.
  const intakeFile = page.getByText('CLIENT_INTAKE_PACKAGE', { exact: false }).first();
  if (await intakeFile.isVisible({ timeout: 2000 }).catch(() => false)) {
    await intakeFile.click();
    await page.waitForTimeout(1000);
    await dump(page, 't2-deliverable-open');
    await snap(page, testInfo, 't2-09-deliverable-open');
  } else {
    console.log('PERSONA-NOTE: CLIENT_INTAKE_PACKAGE not visible in tree');
  }

  // 9. MODERATOR BRIDGE (declared): the mock provider produced placeholder
  // content, so to judge the Word pipeline against her letterhead bar we
  // export a realistic intake package through the editor's own
  // "Export as" path (identical markdownToDocxBytes pipeline).
  await page.keyboard.press('Control+n');
  await page.waitForTimeout(800);
  const cmEditor = page.locator('.cm-content').first();
  if (await cmEditor.isVisible({ timeout: 3000 }).catch(() => false)) {
    await cmEditor.click();
    await page.keyboard.insertText(REALISTIC_INTAKE_MD);
    await page.waitForTimeout(2500); // autosave
    const exportAs = page.getByRole('button', { name: /export as/i }).first();
    if (await exportAs.isVisible({ timeout: 2000 }).catch(() => false)) {
      await exportAs.click();
      await page.waitForTimeout(400);
      await dump(page, 't2-export-as-menu');
      await snap(page, testInfo, 't2-10-export-as-menu');
      const wordItem = page.getByRole('menuitem', { name: /word|docx/i }).first();
      if (await wordItem.isVisible({ timeout: 1500 }).catch(() => false)) {
        const dl2P = page.waitForEvent('download', { timeout: 20_000 }).catch(() => null);
        await wordItem.click();
        const dl2 = await dl2P;
        if (dl2) {
          await dl2.saveAs('/tmp/persona-t2-realistic.docx');
          console.log(`PERSONA-NOTE: editor export docx -> /tmp/persona-t2-realistic.docx (${dl2.suggestedFilename()})`);
        } else {
          console.log('PERSONA-NOTE: no download from editor Export as');
        }
      } else {
        console.log('PERSONA-NOTE: Export as menu has no Word item');
        await dump(page, 't2-export-as-menu-missing-word');
      }
    } else {
      console.log('PERSONA-NOTE: editor has no Export as button');
    }
  }

  // 10. Moderator peek: Settings → template models (is Ollama offered there?)
  await page.keyboard.press('Escape');
  await page.getByTestId('settings-gear').click();
  await page.getByTestId('settings-modal').waitFor({ state: 'visible', timeout: 8000 });
  await dump(page, 't2-settings-categories', '[data-testid="settings-modal"]');
  const tmCat = page.locator('[data-testid^="settings-category-"]').filter({ hasText: /template|model/i }).first();
  if (await tmCat.isVisible({ timeout: 2000 }).catch(() => false)) {
    await tmCat.click();
    await page.waitForTimeout(500);
    await dump(page, 't2-template-models', '[data-testid="settings-modal"]');
    await snap(page, testInfo, 't2-11-template-model-settings');
  }
  await page.keyboard.press('Escape');

  console.log(`\n===PERSONA-PROVIDER-LOGS===\n${providerLogs.join('\n')}\n===END===`);
  logErrors('t2-final', getErrors());
  expect(true).toBe(true);
});

// Task 2b — editor "Export as" Word pipeline with realistic content (bridge).
test('Task 2b: editor export-as Word with realistic intake', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const getErrors = collectConsoleErrors(page);
  await page.goto('/?testMode=true');
  await page.getByTestId('sidebar').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(1000);

  // Open the markdown demo tab (test1).
  await page.getByRole('tab', { name: /test1/ }).click().catch(async () => {
    await page.getByText('test1', { exact: true }).first().click();
  });
  await page.waitForTimeout(600);
  const cm = page.locator('.cm-content').first();
  await cm.waitFor({ state: 'visible', timeout: 5000 });
  await cm.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(REALISTIC_INTAKE_MD);
  await page.waitForTimeout(2600); // autosave tick
  await snap(page, testInfo, 't2-12-realistic-md-in-editor');
  await dump(page, 't2-editor-toolbar-buttons', '[data-testid="main-panel"]');

  // Capture BOTH export menus.
  const exportPlain = page.getByRole('button', { name: /^export$/i }).first();
  if (await exportPlain.isVisible({ timeout: 1500 }).catch(() => false)) {
    await exportPlain.click();
    await page.waitForTimeout(400);
    await dump(page, 't2-export-menu-plain');
    await snap(page, testInfo, 't2-13-export-menu-plain');
    await page.keyboard.press('Escape');
  }
  const exportAs = page.getByRole('button', { name: /export as/i }).first();
  if (await exportAs.isVisible({ timeout: 1500 }).catch(() => false)) {
    await exportAs.click();
    await page.waitForTimeout(400);
    await dump(page, 't2-export-as-menu');
    await snap(page, testInfo, 't2-14-export-as-menu');
    const items = page.getByRole('menuitem');
    console.log(`PERSONA-NOTE: export-as items = ${JSON.stringify(await items.allInnerTexts().catch(() => []))}`);
    const wordItem = items.filter({ hasText: /word|docx/i }).first();
    if (await wordItem.isVisible({ timeout: 1500 }).catch(() => false)) {
      const dlP = page.waitForEvent('download', { timeout: 20_000 }).catch(() => null);
      await wordItem.click();
      const dl = await dlP;
      if (dl) {
        await dl.saveAs('/tmp/persona-t2-realistic.docx');
        console.log(`PERSONA-NOTE: editor export docx saved (${dl.suggestedFilename()})`);
      } else {
        console.log('PERSONA-NOTE: no download from editor export-as Word');
        await page.waitForTimeout(1200);
        await dump(page, 't2-after-editor-word-export');
        await snap(page, testInfo, 't2-15-after-editor-word-export');
      }
    }
  } else {
    console.log('PERSONA-NOTE: no Export as button with md tab open');
  }
  logErrors('t2b-final', getErrors());
  expect(true).toBe(true);
});

// Task 2c — capture the actual exported .docx bytes by stubbing the native
// save dialog (pipeline inspection; not a UX step).
test('Task 2c: capture exported docx bytes', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?testMode=true');
  await page.getByTestId('sidebar').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).showSaveFilePicker = async () => ({
      createWritable: async () => {
        const chunks: Uint8Array[] = [];
        return {
          write: async (d: ArrayBuffer | Uint8Array) => {
            chunks.push(d instanceof Uint8Array ? d : new Uint8Array(d));
          },
          close: async () => {
            const total = chunks.reduce((n, c) => n + c.length, 0);
            const all = new Uint8Array(total);
            let off = 0;
            for (const c of chunks) { all.set(c, off); off += c.length; }
            let bin = '';
            for (let i = 0; i < all.length; i++) bin += String.fromCharCode(all[i]);
            (window as unknown as Record<string, unknown>).__docxB64 = btoa(bin);
          },
        };
      },
    });
  });
  await page.getByText('test1', { exact: true }).first().click();
  await page.waitForTimeout(600);
  const cm = page.locator('.cm-content').first();
  await cm.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(REALISTIC_INTAKE_MD);
  await page.waitForTimeout(2600);
  await page.getByRole('button', { name: /export as/i }).first().click();
  await page.getByRole('menuitem').filter({ hasText: /word|docx/i }).first().click();
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__docxB64, undefined, { timeout: 20_000 });
  const b64 = await page.evaluate(() => (window as unknown as Record<string, unknown>).__docxB64 as string);
  const fs = await import('node:fs');
  fs.writeFileSync('/tmp/persona-t2-realistic.docx', Buffer.from(b64, 'base64'));
  console.log(`PERSONA-NOTE: captured docx bytes = ${Buffer.from(b64, 'base64').length}`);
  expect(true).toBe(true);
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 3 — Connect email (IMAP path) + encryption story (browser wall expected)
// ─────────────────────────────────────────────────────────────────────────────

test('Task 3: connect email via IMAP settings', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const getErrors = collectConsoleErrors(page);
  await page.goto('/?testMode=true');
  await page.getByTestId('sidebar').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(800);

  // Settings → Integrations.
  await page.getByTestId('settings-gear').click();
  await page.getByTestId('settings-modal').waitFor({ state: 'visible', timeout: 8000 });
  await page.getByTestId('settings-category-integrations').click();
  await page.waitForTimeout(600);
  await dump(page, 't3-integrations-panel', '[data-testid="settings-modal"]');
  await snap(page, testInfo, 't3-01-integrations-panel');

  // Scroll the IMAP section into view and fill it with the seeded server.
  const imapHost = page.locator('#imap-host');
  if (await imapHost.isVisible({ timeout: 3000 }).catch(() => false)) {
    await imapHost.scrollIntoViewIfNeeded();
    await imapHost.fill('127.0.0.1');
    await page.locator('#imap-port').fill('3143');
    await page.locator('#imap-username').fill('diane@marchetti-law.test');
    await page.locator('#imap-password').fill('test');
    await snap(page, testInfo, 't3-02-imap-filled');
    await page.getByRole('button', { name: /^connect$/i }).click();
    await page.waitForTimeout(2500);
    await dump(page, 't3-imap-after-connect', '[data-testid="settings-modal"]');
    await snap(page, testInfo, 't3-03-imap-after-connect');
  } else {
    console.log('PERSONA-NOTE: imap host field not visible');
    await dump(page, 't3-imap-missing', '[data-testid="settings-modal"]');
  }

  logErrors('t3-final', getErrors());
  expect(true).toBe(true);
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 4 — THE WEDGE (in-harness analog): find what the record says, with
// citations, using Search + a LOCAL (Ollama) AI ask over the seeded matter.
// Mail itself is desktop-only (see Task 3) — declared in the transcript.
// ─────────────────────────────────────────────────────────────────────────────

test('Task 4: wedge — search + local AI ask with citations', async ({ page }, testInfo) => {
  test.setTimeout(360_000);
  const getErrors = collectConsoleErrors(page);
  await page.goto('/?testMode=true&recordMatter=1');
  await page.getByTestId('sidebar').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(1500);
  await dump(page, 't4-matter-first-view');
  await snap(page, testInfo, 't4-01-matter-first-view');

  // 1. Her instinct: Search.
  await page.getByTestId('sidebar-tab-search').click();
  const searchInput = page.getByTestId('search-input');
  await searchInput.waitFor({ state: 'visible', timeout: 5000 });
  await searchInput.fill('second appraisal');
  await page.waitForTimeout(1200);
  await dump(page, 't4-search-appraisal', '[data-testid="sidebar"]');
  await snap(page, testInfo, 't4-02-search-results');
  const results = page.locator('[data-testid^="search-result-"]');
  const nResults = await results.count();
  console.log(`PERSONA-NOTE: search results for "second appraisal" = ${nResults}`);
  if (nResults > 0) {
    await results.first().click();
    await page.waitForTimeout(800);
    await dump(page, 't4-search-opened');
    await snap(page, testInfo, 't4-03-search-result-opened');
  }
  // Second query: the deadline-ish one.
  await page.getByTestId('sidebar-tab-search').click();
  await searchInput.fill('closing date sale closed');
  await page.waitForTimeout(1200);
  await dump(page, 't4-search-deadline', '[data-testid="sidebar"]');
  await snap(page, testInfo, 't4-04-search-deadline');

  // 2. Restore her onboarding choice: Local-only mode ON via Settings → AI.
  await page.getByTestId('settings-gear').click();
  await page.getByTestId('settings-modal').waitFor({ state: 'visible', timeout: 8000 });
  await page.getByTestId('settings-category-ai').click();
  await page.waitForTimeout(500);
  const localCard = page.getByTestId('confidentiality-mode-local-only');
  if (await localCard.isVisible({ timeout: 3000 }).catch(() => false)) {
    await dump(page, 't4-confidentiality-settings', '[data-testid="confidentiality-mode-settings"]');
    await snap(page, testInfo, 't4-05-confidentiality-before');
    await localCard.click();
    await page.waitForTimeout(600);
    await snap(page, testInfo, 't4-06-local-only-active');
    await dump(page, 't4-local-only-note', '[data-testid="confidentiality-mode-settings"]');
  } else {
    console.log('PERSONA-NOTE: confidentiality-mode-local-only card not found');
    await dump(page, 't4-ai-settings-panel', '[data-testid="settings-modal"]');
  }
  await page.keyboard.press('Escape');

  // 3. Status bar / egress indicator state after switching.
  await dump(page, 't4-statusbar', '[data-testid="status-bar"]');
  await snap(page, testInfo, 't4-07-statusbar-local-only');

  // 4. AI Assistant → local model chat.
  await page.getByTestId('sidebar-tab-ai').click().catch(async () => {
    await page.getByText('AI Assistant', { exact: true }).click();
  });
  await page.waitForTimeout(800);
  await dump(page, 't4-ai-pane', '[data-testid="ai-assistant-pane"]');
  await snap(page, testInfo, 't4-08-ai-pane-local-only');
  const newOllama = page.getByTestId('new-chat-ollama');
  await newOllama.waitFor({ state: 'visible', timeout: 8000 });
  await newOllama.click();
  await page.waitForTimeout(1200);

  // 5. The chat tab opens. Turn ON "Ask workspace" grounding.
  const askToggle = page.getByTestId('ask-workspace-toggle');
  if (await askToggle.isVisible({ timeout: 4000 }).catch(() => false)) {
    const pressed = await askToggle.getAttribute('aria-pressed').catch(() => null);
    const cls = await askToggle.getAttribute('class').catch(() => '');
    console.log(`PERSONA-NOTE: ask-workspace-toggle pressed=${pressed} cls=${(cls || '').slice(0, 80)}`);
    await askToggle.click();
    await page.waitForTimeout(400);
  } else {
    console.log('PERSONA-NOTE: ask-workspace-toggle not visible');
  }
  await dump(page, 't4-chat-fresh', '[data-testid="ai-chat-viewer"]');
  await snap(page, testInfo, 't4-09-chat-fresh');

  // 6. Ask the wedge question.
  const chatInput = page.getByTestId('chat-input');
  await chatInput.waitFor({ state: 'visible', timeout: 5000 });
  await chatInput.fill('When did the sale close in the Halvorsen Estate matter, and what does the record say about whether Halvorsen saw the second appraisal? Keep it brief and cite the documents you used.');
  await snap(page, testInfo, 't4-10-question-typed');
  await page.getByTestId('chat-send-button').click();

  // Capture the egress indicator DURING the send.
  await page.waitForTimeout(700);
  await dump(page, 't4-egress-during-send', '[data-testid="status-bar"]');
  const egress = page.getByTestId('egress-indicator');
  if (await egress.isVisible({ timeout: 2000 }).catch(() => false)) {
    const egressText = await egress.innerText().catch(() => '');
    console.log(`PERSONA-NOTE: egress indicator during send = "${egressText.replace(/\n/g, ' | ')}"`);
  } else {
    const compact = page.getByTestId('egress-indicator-compact');
    const compactVis = await compact.isVisible({ timeout: 1000 }).catch(() => false);
    console.log(`PERSONA-NOTE: egress-indicator visible=false compact=${compactVis}`);
  }
  await snap(page, testInfo, 't4-11-during-generation');

  // 7. Wait for the answer to finish streaming.
  const loading = page.getByTestId('chat-loading-indicator');
  await loading.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  await loading.waitFor({ state: 'hidden', timeout: 240_000 }).catch(() => {
    console.log('PERSONA-NOTE: chat still streaming after 240s');
  });
  await page.waitForTimeout(1000);
  await dump(page, 't4-answer', '[data-testid="chat-messages"]');
  await snap(page, testInfo, 't4-12-answer');

  // 8. Citations: sources accordion?
  const sourcesAcc = page.getByTestId('chat-sources-accordion');
  if (await sourcesAcc.isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.getByTestId('chat-sources-toggle').click();
    await page.waitForTimeout(500);
    await dump(page, 't4-sources', '[data-testid="chat-sources-accordion"]');
    await snap(page, testInfo, 't4-13-sources-open');
    // Click the first source chip/link inside.
    const srcBtn = sourcesAcc.locator('button, a').nth(1);
    if (await srcBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await srcBtn.click();
      await page.waitForTimeout(1000);
      await dump(page, 't4-source-opened');
      await snap(page, testInfo, 't4-14-source-opened');
    }
  } else {
    console.log('PERSONA-NOTE: no chat-sources-accordion visible');
    // Try wiki-links inside the answer.
    const wikiLink = page.locator('[data-testid="chat-messages"] a').first();
    if (await wikiLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log(`PERSONA-NOTE: clicking in-answer link "${await wikiLink.innerText()}"`);
      await wikiLink.click();
      await page.waitForTimeout(1000);
      await snap(page, testInfo, 't4-14-source-opened');
    }
  }

  // 9. The seeded demo chat (designed experience) for contrast.
  await page.getByTestId('sidebar-tab-files').click().catch(() => {});
  await page.waitForTimeout(500);
  const demoChat = page.getByText('Deposition contradictions.aichat', { exact: false }).first();
  if (await demoChat.isVisible({ timeout: 3000 }).catch(() => false)) {
    await demoChat.click();
    await page.waitForTimeout(1000);
    await dump(page, 't4-demo-chat', '[data-testid="chat-messages"]');
    await snap(page, testInfo, 't4-15-demo-chat');
  }

  logErrors('t4-final', getErrors());
  expect(true).toBe(true);
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 5 — Trust & proof: AI Audit log, Data Map, egress; her verdict.
// ─────────────────────────────────────────────────────────────────────────────

test('Task 5: trust & proof — audit, data map, egress', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const getErrors = collectConsoleErrors(page);
  await page.goto('/?testMode=true&recordMatter=1');
  await page.getByTestId('sidebar').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(1200);

  // 1. AI Audit (sidebar).
  await page.getByTestId('sidebar-tab-audit').click();
  await page.waitForTimeout(800);
  await dump(page, 't5-audit-log', '[data-testid="sidebar"]');
  await snap(page, testInfo, 't5-01-audit-log');
  const protective = page.getByTestId('audit-log-protective-header');
  if (await protective.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log(`PERSONA-NOTE: audit protective header = "${(await protective.innerText()).replace(/\n/g, ' | ')}"`);
  }
  // Export buttons present?
  const exportJson = page.getByTestId('audit-log-export-json-btn');
  console.log(`PERSONA-NOTE: audit export JSON visible = ${await exportJson.isVisible({ timeout: 1500 }).catch(() => false)}`);

  // 2. Data Map from Settings → Privacy.
  await page.getByTestId('settings-gear').click();
  await page.getByTestId('settings-modal').waitFor({ state: 'visible', timeout: 8000 });
  const privacyCat = page.getByTestId('settings-category-privacy');
  if (await privacyCat.isVisible({ timeout: 2000 }).catch(() => false)) {
    await privacyCat.click();
    await page.waitForTimeout(500);
    await dump(page, 't5-privacy-settings', '[data-testid="settings-modal"]');
    await snap(page, testInfo, 't5-02-privacy-settings');
  }
  const openDataMap = page.getByTestId('privacy-open-data-map');
  if (await openDataMap.isVisible({ timeout: 2000 }).catch(() => false)) {
    await openDataMap.click();
    await page.getByTestId('data-map-dialog').waitFor({ state: 'visible', timeout: 5000 });
    // Expand all sections.
    const triggers = page.locator('[data-testid="data-map-section-trigger"]');
    const n = await triggers.count();
    for (let i = 0; i < n; i++) {
      const tr = triggers.nth(i);
      if ((await tr.getAttribute('aria-expanded')) === 'false') {
        await tr.click();
        await page.waitForTimeout(120);
      }
    }
    await dump(page, 't5-data-map', '[data-testid="data-map-content"]');
    await snap(page, testInfo, 't5-03-data-map-expanded');
    console.log(`PERSONA-NOTE: data-map print button visible = ${await page.getByTestId('data-map-print').isVisible({ timeout: 1500 }).catch(() => false)}`);
    await page.keyboard.press('Escape');
  } else {
    console.log('PERSONA-NOTE: open-data-map button not found in privacy settings');
  }

  // 3. Switch confidentiality Local-only → Direct and watch the egress indicator change.
  await page.getByTestId('settings-category-ai').click();
  await page.waitForTimeout(400);
  await page.getByTestId('confidentiality-mode-local-only').click();
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await dump(page, 't5-statusbar-localonly', '[data-testid="status-bar"]');
  await snap(page, testInfo, 't5-04-egress-localonly');

  await page.getByTestId('settings-gear').click();
  await page.getByTestId('settings-category-ai').click();
  await page.waitForTimeout(400);
  const directCard = page.getByTestId('confidentiality-mode-direct');
  if (await directCard.isVisible({ timeout: 2000 }).catch(() => false)) {
    await directCard.click();
    await page.waitForTimeout(400);
    await dump(page, 't5-direct-mode', '[data-testid="confidentiality-mode-settings"]');
    await snap(page, testInfo, 't5-05-direct-mode');
  }
  await page.keyboard.press('Escape');
  await dump(page, 't5-statusbar-direct', '[data-testid="status-bar"]');
  await snap(page, testInfo, 't5-06-egress-direct');

  // 4. Cost & usage view (the "what is it costing me" half).
  await page.getByTestId('settings-gear').click();
  const costCat = page.locator('[data-testid^="settings-category-"]').filter({ hasText: /cost|usage/i }).first();
  if (await costCat.isVisible({ timeout: 2000 }).catch(() => false)) {
    await costCat.click();
    await page.waitForTimeout(500);
    await dump(page, 't5-cost-usage', '[data-testid="settings-modal"]');
    await snap(page, testInfo, 't5-07-cost-usage');
  } else {
    console.log('PERSONA-NOTE: cost/usage settings category not found');
  }
  await page.keyboard.press('Escape');

  logErrors('t5-final', getErrors());
  expect(true).toBe(true);
});
