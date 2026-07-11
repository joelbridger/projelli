#!/usr/bin/env node
// Drives the real Linux Tauri dev bridge. It deliberately uses only visible
// controls, then reloads the webview to prove saved CRM records come back.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const driver = resolve(root, 'desktop-drive.mjs');
const env = { ...process.env, DESKTOP_CDP_PORT: process.env.DESKTOP_CDP_PORT || '9250' };
const run = (...args) => execFileSync('node', [driver, ...args], { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const click = (testid) => run('click', testid);
const fill = (testid, value) => run('type', testid, value);
const evaluate = (js) => JSON.parse(run('eval', js));
const ids = (prefix) => evaluate(`Array.from(document.querySelectorAll('[data-testid]')).map((e) => e.getAttribute('data-testid')).filter((id) => id && id.startsWith(${JSON.stringify(prefix)}))`);
const need = (prefix) => {
  const id = ids(prefix)[0];
  if (!id) throw new Error(`Could not find a visible control beginning ${prefix}`);
  return id;
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };

try {
  click('crm-home-nav-workflows');
  const create = ids('crm-live-workflow-create-first')[0] || ids('crm-live-workflow-new-template')[0];
  if (create) click(create);
  fill('crm-live-workflow-name', 'Northcrest annual review');
  fill('crm-live-workflow-step-title-1', 'Confirm household details');
  fill('crm-live-workflow-step-title-2', 'Open accounts');
  fill('crm-live-workflow-step-title-3', 'Send welcome packet');
  click('crm-live-workflow-create-template');
  if (ids('crm-live-workflow-new-household').length) fill('crm-live-workflow-new-household', 'Northcrest test household');
  else {
    const householdSelect = need('crm-live-workflow-household');
    evaluate(`(() => { const el = document.querySelector('[data-testid="${householdSelect}"]'); el.value = el.options[1].value; el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  }
  click('crm-live-workflow-start');
  const complete = need('crm-live-workflow-complete-');
  click(complete);
  click('crm-live-workflow-edit-template');
  fill('crm-live-workflow-change-title', 'Confirm household goals');
  fill('crm-live-workflow-add-title', 'Send welcome summary');
  click('crm-live-workflow-publish');
  const offer = need('crm-live-propagation-offer-');
  const accept = need('crm-live-propagation-accept-');
  click(accept);
  const apply = need('crm-live-propagation-apply-');
  click(apply);
  assert(evaluate('document.body.innerText').includes('Completed work and notes stayed as they were.'), 'Apply did not confirm that completed work stayed unchanged.');

  click('crm-home-nav-workflows');
  const localEdit = ids('crm-live-workflow-edit-local-').at(-1);
  if (!localEdit) throw new Error('Could not find the newly added workflow step to tailor for this household.');
  click(localEdit);
  const localInput = need('crm-live-workflow-local-title-');
  const localSave = need('crm-live-workflow-local-save-');
  fill(localInput, 'Household-specific confirmation');
  click(localSave);
  click('crm-home-nav-workflows');
  click('crm-live-workflow-open-propagation');
  const undo = need('crm-live-propagation-undo-');
  click(undo);
  const undoText = evaluate(`document.querySelector('[data-testid="crm-live-propagation-result"]')?.textContent || ''`);
  assert(undoText.includes('Kept 2 later household changes'), `Undo did not protect the later household edit: ${undoText}`);

  // Reloading re-mounts the running desktop app. The CRM bridge reloads from
  // SQLCipher rather than retaining component state, which is the persistence
  // proof available through the debug bridge.
  evaluate('location.reload(); true');
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      if (evaluate(`document.body.innerText.includes('Northcrest annual review')`)) break;
    } catch { /* webview is briefly reloading */ }
  }
  assert(evaluate(`document.body.innerText.includes('Northcrest annual review')`), 'Saved template did not return after the desktop screen restarted.');
  click('crm-home-nav-workflows');
  click('crm-live-workflow-open-propagation');
  assert(evaluate(`document.body.innerText.includes('No template updates waiting for review')`), 'Applied review decision did not persist after restart.');
  console.log('PASS: workflow template, household instance, review, protected undo, and persistence all worked through the desktop bridge.');
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
