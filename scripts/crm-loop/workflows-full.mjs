#!/usr/bin/env node
// Real desktop proof for workflow completion. This uses visible controls and
// checks that the records return after a full desktop relaunch.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const driver = resolve(root, 'scripts/desktop-drive.mjs');
const env = { ...process.env, DESKTOP_CDP_PORT: process.env.DESKTOP_CDP_PORT || '9264' };
const run = (...args) => execFileSync('node', [driver, ...args], { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const click = (id) => run('click', id);
const fill = (id, value) => run('type', id, value);
const evaluate = (js) => JSON.parse(run('eval', js));
const ids = (prefix) => evaluate(`Array.from(document.querySelectorAll('[data-testid]')).map((item) => item.getAttribute('data-testid')).filter((id) => id && id.startsWith(${JSON.stringify(prefix)}))`);
const need = (prefix) => { const id = ids(prefix)[0]; if (!id) throw new Error(`Could not find ${prefix}`); return id; };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const select = (id, value) => evaluate(`(() => { const element = document.querySelector('[data-testid="${id}"]'); element.value = ${JSON.stringify(value)}; element.dispatchEvent(new Event('change', { bubbles: true })); return element.value; })()`);
const restart = () => {
  try { run('eval', "(async () => { const { relaunch } = await import('@tauri-apps/plugin-process'); await relaunch(); return true; })()"); } catch { /* closing the old webview is expected */ }
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) { try { run('pages'); return; } catch { /* relaunch in progress */ } }
  throw new Error('Desktop app did not return after relaunch.');
};

try {
  click('crm-home-nav-workflows');
  click('crm-starter-workflow-annual-review');
  click('crm-live-workflow-create-template');
  fill('crm-live-workflow-new-household', 'Workflow proof household');
  click('crm-live-workflow-start');

  click('crm-live-workflow-edit-template');
  const firstStepId = ids('crm-live-workflow-add-outcome-')[0].replace('crm-live-workflow-add-outcome-', '');
  click(`crm-live-workflow-add-outcome-${firstStepId}`);
  const outcomeInput = need('crm-live-workflow-outcome-label-');
  fill(outcomeInput, 'Prepared for meeting');
  click('crm-live-workflow-schedule-enabled');
  select('crm-live-workflow-schedule-frequency', 'annual');
  fill('crm-live-workflow-schedule-starts-at', '2026-01-01');
  const householdSelect = 'crm-live-workflow-schedule-households';
  evaluate(`(() => { const element = document.querySelector('[data-testid="${householdSelect}"]'); const option = element.options[0]; option.selected = true; element.dispatchEvent(new Event('change', { bubbles: true })); return option.value; })()`);
  click('crm-live-workflow-save-settings');

  const instance = need('crm-live-workflow-instance-');
  const instanceId = instance.replace('crm-live-workflow-instance-', '');
  const note = need(`crm-live-workflow-step-note-${instanceId}-`);
  const stepId = note.slice(`crm-live-workflow-step-note-${instanceId}-`.length);
  fill(note, 'Household asked for a tax projection.');
  click(`crm-live-workflow-save-note-${instanceId}-${stepId}`);
  select(`crm-live-workflow-outcome-choice-${instanceId}-${stepId}`, evaluate(`document.querySelector('[data-testid="crm-live-workflow-outcome-choice-${instanceId}-${stepId}"]').options[1].value`));
  click(`crm-live-workflow-complete-${instanceId}-${stepId}`);
  assert(evaluate('document.body.innerText').includes('Prepared for meeting'), 'Outcome did not appear after completing the step.');
  assert(evaluate('document.body.innerText').includes('Household asked for a tax projection.'), 'Step comment did not appear after saving.');
  assert(ids('crm-live-workflow-instance-').length >= 2, 'The past-due schedule did not create a workflow for the selected household.');

  restart();
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    try { if (evaluate("document.body.innerText.includes('Annual review') && document.body.innerText.includes('Household asked for a tax projection.')")) break; } catch { /* webview still loads */ }
  }
  assert(evaluate("document.body.innerText.includes('Annual review')"), 'Starter template did not return after restart.');
  assert(evaluate("document.body.innerText.includes('Household asked for a tax projection.')"), 'Step comment did not return after restart.');
  console.log('PASS: starter template, schedule, outcome, step comment, and restart persistence worked through the desktop bridge.');
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
