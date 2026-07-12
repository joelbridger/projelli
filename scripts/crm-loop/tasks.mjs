#!/usr/bin/env node
// Desktop proof for task priority, recurrence, firm-member assignment, activity,
// daily capacity, and persistence across a screen restart.
import { mkdirSync } from 'node:fs';

const port = process.env.LANTERN_DEV_BRIDGE_PORT || '9262';
const root = process.env.CRM_LOOP_WORKSPACE || '/tmp/lantern-crm-tasks-loop';
const base = `http://127.0.0.1:${port}`;
const stamp = new Date().toISOString().slice(0, 10);
const id = `task-loop-${Date.now()}`;
const taskTitle = `Annual review follow-up ${id}`;

function fail(message) { throw new Error(`FAIL: ${message}`); }
async function request(path, query = {}) {
  const url = new URL(`${base}${path}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || !body.ok) fail(body.error || `${path} failed`);
  return body.result;
}
const evaluate = (js) => request('/eval', { js });
const click = (testid) => request('/click', { testid });
const fill = (testid, text) => request('/fill', { testid, text });
async function waitFor(testid, seconds = 12) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    if (await evaluate(`Boolean(document.querySelector('[data-testid="${testid}"]'))`)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  fail(`timed out waiting for ${testid}`);
}
async function waitForText(text, seconds = 12) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    if (String(await evaluate('document.body.innerText')).includes(text)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  fail(`timed out waiting for ${text}`);
}
async function setSelect(testid, value) {
  await evaluate(`(() => { const element = document.querySelector('[data-testid="${testid}"]'); if (!element) throw new Error('missing ${testid}'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(element, ${JSON.stringify(value)}); element.dispatchEvent(new Event('change', { bubbles: true })); })()`);
}

mkdirSync(root, { recursive: true });
await request('/health');
await evaluate(`(async () => {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke) throw new Error('Tauri invoke is unavailable');
  await invoke('crm_set_workspace', { path: ${JSON.stringify(root)} });
  await invoke('crm_live_upsert', { record: { id: 'household-${id}', kind: 'household', matterId: 'household-${id}', name: 'Loop household', status: 'active' }});
  await invoke('crm_live_upsert', { record: { id: 'member-${id}', kind: 'firmDirectoryEntry', matterId: 'firm_home', userId: 'advisor-${id}', displayName: 'Loop Advisor', title: 'Advisor', active: true, teamLabels: [] }});
})()`);
await evaluate(`(async () => { const { useWorkspaceStore } = await import('/src/platform/fs/workspaceStore.ts'); useWorkspaceStore.getState().setRootPath(${JSON.stringify(root)}); return true; })()`);

await waitFor('crm-home-nav-tasks');
await click('crm-home-nav-tasks');
await waitFor('crm-task-new');
await click('crm-task-new');
await fill('crm-task-title-input', taskTitle);
await setSelect('crm-task-household', `household-${id}`);
await setSelect('crm-task-assignee', `advisor-${id}`);
await setSelect('crm-task-priority', 'high');
await fill('crm-task-due', stamp);
await setSelect('crm-task-recurrence', 'weekly');
await click('crm-task-save');
await waitForText(taskTitle);
await click(`crm-task-complete-${await evaluate(`window.__TAURI_INTERNALS__.invoke('crm_live_list').then((records) => records.find((record) => record.kind === 'task' && record.title === ${JSON.stringify(taskTitle)})?.id)`)}`);
await new Promise((resolve) => setTimeout(resolve, 300));

const records = await evaluate(`window.__TAURI_INTERNALS__.invoke('crm_live_list')`);
const recurring = records.filter((record) => record.kind === 'task' && record.title === taskTitle);
const activity = records.filter((record) => record.kind === 'activityEvent' && record.targetRef?.kind === 'task');
if (recurring.length !== 2 || !recurring.some((record) => record.status === 'done') || !recurring.some((record) => record.status === 'open' && record.recurrence?.freq === 'weekly')) fail('completion did not retain the task and create its next saved recurring task');
if (!recurring.every((record) => record.assigneeUserId === `advisor-${id}` && record.priority === 'high') || !activity.some((record) => record.verb === 'task.completed')) fail('task priority, firm-member assignment, or client change trail was not saved');

await click('crm-home-nav-today');
await waitFor('crm-today-triage');
await waitForText('fit the first pass');
// Reloading the mounted app proves that the same SQLCipher-backed records are read again.
await evaluate('location.reload()');
await waitFor('crm-home-nav-tasks');
await evaluate(`(async () => { const { useWorkspaceStore } = await import('/src/platform/fs/workspaceStore.ts'); useWorkspaceStore.getState().setRootPath(${JSON.stringify(root)}); return true; })()`);
await click('crm-home-nav-tasks');
await waitForText(taskTitle);

console.log('PASS: Task priority, real firm assignment, recurrence, client activity, capacity triage, and restart persistence are durable CRM records.');
