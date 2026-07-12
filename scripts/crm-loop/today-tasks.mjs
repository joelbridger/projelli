#!/usr/bin/env node
// Real desktop smoke path for Home > Tasks and Home > Today.
// Run only after `npm run tauri:dev` is open with the Linux bridge on :9250.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const port =
  process.env.LANTERN_DEV_BRIDGE_PORT || process.env.DESKTOP_CDP_PORT || '9250';
const root =
  process.env.CRM_LOOP_WORKSPACE || '/tmp/lantern-crm-today-tasks-loop';
const verifyOnly = process.argv.includes('--verify-persisted');
const base = `http://127.0.0.1:${port}`;
const stamp = new Date().toISOString().slice(0, 10);
const id = `loop-${Date.now()}`;
const taskTitle = `Pay attention today ${id}`;

function fail(message) {
  throw new Error(`FAIL: ${message}`);
}
async function request(path, query = {}) {
  const url = new URL(`${base}${path}`);
  for (const [key, value] of Object.entries(query))
    url.searchParams.set(key, String(value));
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || !body.ok) fail(body.error || `${path} failed`);
  return body.result;
}
async function evaluate(js) {
  return request('/eval', { js });
}
async function click(testid) {
  return request('/click', { testid });
}
async function fill(testid, text) {
  return request('/fill', { testid, text });
}
async function waitFor(testid, seconds = 10) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (
      await evaluate(
        `Boolean(document.querySelector('[data-testid="${testid}"]'))`
      )
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  fail(`timed out waiting for ${testid}`);
}
async function waitForEnabled(testid, seconds = 10) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (
      await evaluate(
        `(() => { const element = document.querySelector('[data-testid="${testid}"]'); return Boolean(element && !element.disabled); })()`
      )
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  fail(`timed out waiting for ${testid} to become available`);
}
async function waitForText(text, seconds = 10) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (String(await evaluate('document.body.innerText')).includes(text))
      return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  fail(`timed out waiting for text: ${text}`);
}
async function waitForCondition(label, js, seconds = 10) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (await evaluate(js)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  fail(`timed out waiting for ${label}`);
}
async function setSelect(testid, value) {
  await evaluate(
    `(() => { const element = document.querySelector('[data-testid="${testid}"]'); if (!element) throw new Error('missing ${testid}'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(element, ${JSON.stringify(value)}); element.dispatchEvent(new Event('change', { bubbles: true })); })()`
  );
}

mkdirSync(root, { recursive: true });
await request('/health');

// Seed only the two records the Tasks screen needs. They use the same real Tauri
// commands as the UI, not browser storage or a test adapter.
await evaluate(`(async () => {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke) throw new Error('Tauri invoke is unavailable');
  await invoke('crm_set_workspace', { path: ${JSON.stringify(root)} });
  await invoke('crm_live_upsert', { record: {
    id: 'household-${id}', kind: 'household', matterId: 'household-${id}', name: 'Loop household', status: 'active'
  }});
  await invoke('crm_live_upsert', { record: {
    id: 'proposal-${id}', kind: 'proposalRecord', matterId: 'firm_home', householdRef: { kind: 'household', id: 'household-${id}', matterId: 'household-${id}' },
    proposalKind: 'task_create', rationale: 'A real approval for this desktop loop.', state: 'pending',
    proposedMutation: { kind: 'task_create', task: { title: 'Proposal task', householdRef: { kind: 'household', id: 'household-${id}' }, assigneeUserId: 'loop-user', due: '${stamp}', priority: 'normal', contextRefs: [] } }
  }});
})()`);

// Match the native workspace command in the mounted screen's Zustand store,
// so its live-record hook reloads from the exact workspace the bridge seeded.
await evaluate(`(async () => {
  const { useWorkspaceStore } = await import('/src/platform/fs/workspaceStore.ts');
  useWorkspaceStore.getState().setRootPath(${JSON.stringify(root)});
  return true;
})()`);

await waitFor('crm-home-nav-tasks');
if (verifyOnly) {
  const records = await evaluate(
    `window.__TAURI_INTERNALS__.invoke('crm_live_list')`
  );
  const task = records.find(
    (record) =>
      record.kind === 'task' && record.body === 'Saved by the desktop loop.'
  );
  const view = records.find(
    (record) => record.kind === 'savedView' && record.name === 'Loop view'
  );
  const approval = records.find(
    (record) => record.kind === 'proposalRecord' && record.state === 'approved'
  );
  if (!task || !view || !approval)
    fail(
      'task, saved view, or approved proposal did not survive the desktop restart'
    );
  await click('crm-home-nav-tasks');
  await waitForText(task.title);
  await click('crm-home-nav-today');
  await waitForText(task.title);
  console.log(
    'PASS persistence: Tasks, Today, saved view, and approval records survived the desktop restart.'
  );
  process.exit(0);
}
await click('crm-home-nav-tasks');
await waitFor('crm-task-new');
await waitForEnabled('crm-task-new');
await click('crm-task-new');
await waitFor('crm-task-detail');
await fill('crm-task-title-input', taskTitle);
await fill('crm-task-body', 'Saved by the desktop loop.');
await setSelect('crm-task-household', `household-${id}`);
await fill('crm-task-assignee', 'loop-user');
await setSelect('crm-task-priority', 'high');
await fill('crm-task-due', stamp);
await setSelect('crm-task-recurrence', 'weekly');
await click('crm-task-save');
await waitForText(taskTitle);

const textAfterCreate = await evaluate('document.body.innerText');
if (!String(textAfterCreate).includes(taskTitle))
  fail('created task is not in the list');

await click('crm-task-board-view');
await waitFor('crm-task-board');
await click('crm-task-save-view-open');
await fill('crm-task-view-name', 'Loop view');
await click('crm-task-save-view');
await waitForText('Loop view');
const afterView = await evaluate('document.body.innerText');
if (!String(afterView).includes('Loop view'))
  fail('saved task view did not render');

await click('crm-home-nav-today');
await waitFor('crm-today-triage');
const todayText = await evaluate('document.body.innerText');
if (!String(todayText).includes(taskTitle))
  fail('Today did not compute the due task from the live store');
if (!String(todayText).includes('Due today'))
  fail('Today did not explain why the saved task is first.');

await click(`crm-approval-approve-proposal-${id}`);
await waitFor('crm-approval-history');
await waitForCondition(
  'approved proposal to be stored',
  `window.__TAURI_INTERNALS__.invoke('crm_live_list').then((records) => records.some((record) => record.id === ${JSON.stringify(`proposal-${id}`)} && record.state === 'approved'))`
);
const records = await evaluate(
  `window.__TAURI_INTERNALS__.invoke('crm_live_list')`
);
const task = records.find(
  (record) => record.kind === 'task' && record.title === taskTitle
);
const view = records.find(
  (record) => record.kind === 'savedView' && record.name === 'Loop view'
);
const approval = records.find((record) => record.id === 'proposal-${id}');
const activity = records.filter((record) => record.kind === 'activityEvent');
if (
  !task ||
  task.householdRef?.id !== 'household-${id}' ||
  task.recurrence?.freq !== 'weekly'
)
  fail('task was not durably stored with its household link and recurrence');
if (
  !view ||
  !approval ||
  approval.state !== 'approved' ||
  activity.length === 0
)
  fail('view, approval history, or activity was not durably stored');

const evidence = resolve(
  process.env.CRM_LOOP_SCREENSHOTS_DIR || 'docs/evidence/golden-loop'
);
mkdirSync(evidence, { recursive: true });
execFileSync('scrot', ['-o', resolve(evidence, '02-today-tasks.png')], {
  env: { ...process.env, DISPLAY: process.env.DISPLAY || ':111' },
  stdio: 'ignore',
});

console.log(
  'PASS: Tasks, saved view, Today triage, approval history, and activity are durable CRM records.'
);
