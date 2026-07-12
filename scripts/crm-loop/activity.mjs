#!/usr/bin/env node
// Desktop proof for Home > Activity. It seeds the encrypted CRM bridge, checks
// the dated feed and notification disclosure, creates an internal @mention,
// then verifies the saved note and activity after a restart.
import { mkdirSync } from 'node:fs';

const base = `http://127.0.0.1:${process.env.LANTERN_DEV_BRIDGE_PORT || '9271'}`;
const workspace = process.env.CRM_LOOP_WORKSPACE || '/tmp/lantern-crm-activity-loop';
const id = `activity-${Date.now()}`;
const noteBody = `Please check this annual review ${id}.`;

function fail(message) { throw new Error(`FAIL activity: ${message}`); }
async function request(path, params = {}) {
  const url = new URL(path, base);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || !body.ok) fail(body.error || `${path} failed`);
  return body.result;
}
const evaluate = (js) => request('/eval', { js, timeout_ms: 20_000 });
const click = (testid) => request('/click', { testid });
const fill = (testid, text) => request('/fill', { testid, text });
async function waitFor(testid, seconds = 20) { const until = Date.now() + seconds * 1000; while (Date.now() < until) { if (await evaluate(`Boolean(document.querySelector('[data-testid="${testid}"]'))`)) return; await new Promise((done) => setTimeout(done, 150)); } fail(`timed out waiting for ${testid}`); }

try {
  mkdirSync(workspace, { recursive: true });
  await request('/health');
  await evaluate(`(async () => { const invoke = window.__TAURI_INTERNALS__?.invoke; if (!invoke) throw new Error('Tauri invoke is unavailable'); await invoke('crm_set_workspace', { path: ${JSON.stringify(workspace)} }); const records = ${JSON.stringify([
    { id: `member-${id}`, kind: 'firmDirectoryEntry', matterId: 'firm_home', userId: `maya-${id}`, displayName: 'Maya Patel', active: true, teamLabels: [] },
    { id: `activity-${id}`, kind: 'activityEvent', matterId: 'firm_home', at: '2026-07-12T10:00:00.000Z', summary: 'Maya assigned the annual review.', targetRef: { kind: 'task', id: `task-${id}` }, payload: {}, important: false },
    { id: `notice-${id}`, kind: 'notificationEnvelope', matterId: 'firm_home', recipientUserId: `maya-${id}`, type: 'task_assigned', createdAt: '2026-07-12T10:01:00.000Z', opaqueId: 'abc123', ciphertextBand: '1 KiB', targetRef: { kind: 'task', id: `task-${id}` } },
  ])}; for (const record of records) await invoke('crm_live_upsert', { record }); const { useWorkspaceStore } = await import('/src/platform/fs/workspaceStore.ts'); useWorkspaceStore.getState().setRootPath(${JSON.stringify(workspace)}); return true; })()`);
  await waitFor('spine-nav-home', 30);
  await click('spine-nav-home');
  await waitFor('crm-home');
  await click('crm-home-nav-activity');
  await waitFor('crm-activity-surface');
  const page = String(await evaluate('document.body.innerText'));
  for (const expected of ['Maya assigned the annual review.', 'The relay can see the recipient', 'Read marks stay on this device']) if (!page.includes(expected)) fail(`missing visible truth: ${expected}`);
  await fill('crm-activity-note-body', noteBody);
  await click(`crm-activity-mention-maya-${id}`);
  await click('crm-activity-note-save');
  await new Promise((done) => setTimeout(done, 250));
  const saved = await evaluate(`window.__TAURI_INTERNALS__.invoke('crm_live_list')`);
  if (!saved.some((record) => record.kind === 'note' && record.body === ${JSON.stringify(noteBody)}) || !saved.some((record) => record.kind === 'activityEvent' && record.verb === 'note.created')) fail('note or dated activity was not saved through the encrypted CRM bridge');
  await evaluate('location.reload()');
  await waitFor('spine-nav-home', 30);
  await evaluate(`(async () => { const { useWorkspaceStore } = await import('/src/platform/fs/workspaceStore.ts'); useWorkspaceStore.getState().setRootPath(${JSON.stringify(workspace)}); return true; })()`);
  await click('spine-nav-home'); await click('crm-home-nav-activity'); await waitFor('crm-activity-surface');
  if (!String(await evaluate('document.body.innerText')).includes(noteBody)) fail('saved activity did not survive restart');
  console.log('PASS activity: firm activity, truthful notification inbox, local read wording, @mention save, and restart persistence are live.');
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
