#!/usr/bin/env node
// Real desktop drive for Clients > household > Timeline. It seeds only the
// encrypted live-record bridge, then checks the rendered, filterable feed.
import { mkdirSync } from 'node:fs';

const port = process.env.LANTERN_DEV_BRIDGE_PORT || '9261';
const base = `http://127.0.0.1:${port}`;
const workspace = process.env.CRM_LOOP_WORKSPACE || '/tmp/crm-timeline';
const suffix = `Timeline household ${Date.now()}`;
const id = `timeline-${Date.now()}`;

function fail(message) { throw new Error(`FAIL: ${message}`); }
async function request(path, query = {}) {
  const url = new URL(path, base);
  Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || !body.ok) fail(body.error || `${path} failed`);
  return body.result;
}
const evaluate = (js) => request('/eval', { js, timeout_ms: 20_000 });
const click = (testid) => request('/click', { testid });
async function waitFor(testid, seconds = 15) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    if (await evaluate(`Boolean(document.querySelector('[data-testid="${testid}"]'))`)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  fail(`timed out waiting for ${testid}`);
}

try {
  mkdirSync(workspace, { recursive: true });
  await request('/health');
  const records = [
    { id: `household-${id}`, kind: 'household', matterId: `matter-${id}`, name: suffix, lifecycle: 'Active', primaryAdvisor: 'Maya', serviceTier: 'Standard', ownership: 'mine', facts: [], accounts: [], members: [], externalParties: [], notes: [{ id: `note-${id}`, body: 'Timeline note saved in the household.', audience: 'internal', createdAt: '2026-07-07T10:00:00.000Z' }], customFields: [], tags: [] },
    { id: `fact-${id}`, kind: 'fact', matterId: `matter-${id}`, householdId: `household-${id}`, label: 'Risk tolerance', text: 'Balanced', observedAt: '2026-07-08T10:00:00.000Z', source: { sources: [{ kind: 'document', id: `doc-${id}`, label: 'Review notes' }] } },
    { id: `task-${id}`, kind: 'task', matterId: `matter-${id}`, householdRef: { kind: 'household', id: `household-${id}` }, status: 'done', title: 'Send review packet', completedAt: '2026-07-09T10:00:00.000Z', completedBy: 'Maya' },
    { id: `workflow-${id}`, kind: 'workflowInstance', matterId: `matter-${id}`, householdId: `household-${id}`, name: 'Annual review', status: 'open', updatedAt: '2026-07-10T10:00:00.000Z', steps: { prep: { status: 'done', titleSnapshot: 'Prepare review' } } },
    { id: `activity-${id}`, kind: 'activityEvent', matterId: `matter-${id}`, householdId: `household-${id}`, at: '2026-07-11T10:00:00.000Z', actor: { display: 'Priya' }, summary: 'Annual review scheduled.', targetRef: { kind: 'meeting', id: `meeting-${id}`, label: 'Annual review' } },
    { id: `email-${id}`, kind: 'email', matterId: `matter-${id}`, title: 'Review packet sent', createdAt: '2026-07-11T11:00:00.000Z', actor: { display: 'Maya' } },
  ];
  await evaluate(`(async () => { const invoke = window.__TAURI_INTERNALS__?.invoke; if (!invoke) throw new Error('Tauri invoke is unavailable'); await invoke('crm_set_workspace', { path: ${JSON.stringify(workspace)} }); for (const record of ${JSON.stringify(records)}) await invoke('crm_live_upsert', { record }); const { useWorkspaceStore } = await import('/src/platform/fs/workspaceStore.ts'); useWorkspaceStore.getState().setRootPath(${JSON.stringify(workspace)}); return true; })()`);
  await waitFor('spine-nav-matters', 30);
  await click('spine-nav-matters');
  await waitFor('crm-directory-surface');
  await click(`crm-directory-household-household-${id}`);
  await waitFor('crm-household-record');
  await evaluate(`Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Timeline')?.click()`);
  await waitFor('crm-household-timeline');
  const page = String(await evaluate('document.body.innerText'));
  for (const expected of ['Review packet sent', 'Annual review scheduled.', 'Completed task: Send review packet', 'Completed workflow step: Prepare review', 'Timeline note saved in the household.']) if (!page.includes(expected)) fail(`missing timeline entry: ${expected}`);
  const source = await evaluate(`document.querySelector('[data-testid="crm-timeline-source-document-doc-${id}"]')?.textContent`);
  if (source !== 'Open Review notes') fail('fact provenance is not clickable');
  await evaluate(`(() => { const select = document.querySelector('[data-testid="crm-timeline-type"]'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(select, 'task'); select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const filtered = String(await evaluate('document.body.innerText'));
  if (!filtered.includes('Completed task: Send review packet') || filtered.includes('Review packet sent')) fail('type filter did not change the visible timeline');
  console.log('PASS: Timeline is live-driven, dated, sourced, filtered, and rendered from durable CRM records.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
