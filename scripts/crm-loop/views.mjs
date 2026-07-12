#!/usr/bin/env node
// Real desktop proof for saved task, household, and opportunity views. It uses
// visible controls, the encrypted live-record bridge, and an app relaunch.
import { mkdirSync } from 'node:fs';

const port =
  process.env.LANTERN_DEV_BRIDGE_PORT || process.env.DESKTOP_CDP_PORT || '9266';
const workspace = process.env.CRM_LOOP_WORKSPACE || '/tmp/crm-views';
const base = `http://127.0.0.1:${port}`;
const stamp = Date.now();
const taskId = `view-task-${stamp}`;
const doneTaskId = `view-task-done-${stamp}`;
const householdId = `view-household-${stamp}`;
const opportunityId = `view-opportunity-${stamp}`;
const viewName = `Open work ${stamp}`;

function fail(message) {
  throw new Error(`FAIL: ${message}`);
}
async function request(path, query = {}) {
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(query))
    url.searchParams.set(key, String(value));
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || !body.ok) fail(body.error || `${path} failed`);
  return body.result;
}
const evaluate = (js) => request('/eval', { js });
const click = (testid) => request('/click', { testid });
const fill = (testid, text) => request('/fill', { testid, text });
async function waitFor(testid, seconds = 20) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    try {
      if (
        await evaluate(
          `Boolean(document.querySelector('[data-testid="${testid}"]'))`
        )
      )
        return;
    } catch {
      /* app is restarting */
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  fail(`timed out waiting for ${testid}`);
}
async function setSelect(testid, value) {
  await evaluate(
    `(() => { const element = document.querySelector('[data-testid="${testid}"]'); if (!element) throw new Error('Missing ${testid}'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(element, ${JSON.stringify(value)}); element.dispatchEvent(new Event('change', { bubbles: true })); })()`
  );
}
async function setWorkspace() {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      await evaluate(
        `(async () => { const invoke = window.__TAURI_INTERNALS__?.invoke; if (!invoke) throw new Error('Tauri invoke is unavailable'); await invoke('crm_set_workspace', { path: ${JSON.stringify(workspace)} }); const { useWorkspaceStore } = await import('/src/platform/fs/workspaceStore.ts'); useWorkspaceStore.getState().setRootPath(${JSON.stringify(workspace)}); return true; })()`
      );
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  fail(
    `could not select the loop workspace: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}
async function relaunch() {
  try {
    await evaluate(
      "(async () => { const { relaunch } = await import('@tauri-apps/plugin-process'); await relaunch(); return true; })()"
    );
  } catch {
    /* closing the old app ends the bridge response */
  }
  await waitFor('spine-nav-matters', 30);
  await setWorkspace();
}

try {
  mkdirSync(workspace, { recursive: true });
  await request('/health');
  await setWorkspace();
  await evaluate(`(async () => {
    const save = (record) => window.__TAURI_INTERNALS__.invoke('crm_live_upsert', { record });
    await save({ id: ${JSON.stringify(householdId)}, kind: 'household', matterId: ${JSON.stringify(householdId)}, name: 'View loop household', lifecycle: 'Active', serviceTier: 'Gold', primaryAdvisor: 'Loop advisor' });
    await save({ id: ${JSON.stringify(taskId)}, kind: 'task', matterId: 'firm_home', title: 'Call view household', status: 'open', priority: 'high', householdId: ${JSON.stringify(householdId)} });
    await save({ id: ${JSON.stringify(doneTaskId)}, kind: 'task', matterId: 'firm_home', title: 'Finished view task', status: 'done', priority: 'normal' });
    await save({ id: ${JSON.stringify(opportunityId)}, kind: 'opportunity', matterId: 'firm_home', name: 'View loop opportunity', householdId: ${JSON.stringify(householdId)}, stageId: 'Discovery', status: 'open', amount: { value: 500000, currency: 'USD' } });
    return true;
  })()`);
  await click('spine-nav-matters').catch(() => {});
  await waitFor('crm-home-nav-views', 30).catch(() =>
    fail(
      'the app stayed on the workspace chooser after a workspace was selected; the known onboarding blocker prevented this live saved-view drive.'
    )
  );
  await click('crm-home-nav-views');
  await waitFor('crm-views-surface');
  await setSelect('crm-views-layout', 'kanban');
  await click('crm-views-add-filter');
  await setSelect('crm-views-filter-field-0', 'status');
  await setSelect('crm-views-filter-op-0', 'eq');
  await fill('crm-views-filter-value-0', 'open');
  await waitFor(`crm-view-card-${taskId}`);
  if (
    String(await evaluate('document.body.innerText')).includes(
      'Finished view task'
    )
  )
    fail('task filter did not remove the completed task');
  await fill('crm-views-name', viewName);
  await setSelect('crm-views-visibility', 'firm');
  await click('crm-views-save-button');
  const before = await evaluate(
    `window.__TAURI_INTERNALS__.invoke('crm_live_list')`
  );
  const saved = before.find(
    (record) => record.kind === 'savedView' && record.name === viewName
  );
  if (
    !saved ||
    saved.surface !== 'tasks' ||
    saved.visibility !== 'firm' ||
    saved.layout !== 'kanban' ||
    saved.query?.filters?.[0]?.value !== 'open'
  )
    fail(
      'the saved task board was not written through the live CRM record bridge'
    );
  await setSelect('crm-views-entity', 'households');
  await waitFor(`crm-view-card-${householdId}`);
  await setSelect('crm-views-entity', 'opportunities');
  await setSelect('crm-views-layout', 'kanban');
  await waitFor(`crm-view-card-${opportunityId}`);
  await relaunch();
  await click('spine-nav-matters');
  await waitFor('crm-home-nav-views');
  await click('crm-home-nav-views');
  await waitFor(`crm-views-open-${saved.id}`);
  await click(`crm-views-open-${saved.id}`);
  await waitFor(`crm-view-card-${taskId}`);
  console.log(
    'PASS: saved task, household, and opportunity views rendered as lists or boards; a firm view persisted through the encrypted CRM record bridge and app relaunch.'
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
