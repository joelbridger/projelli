#!/usr/bin/env node
// Real desktop drive for a CRM household's linked Documents tab. Files are
// normal workspace files; this seeds only the live CRM records that point at
// them, then verifies those pointers survive a relaunch.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const port = process.env.LANTERN_DEV_BRIDGE_PORT || '9262';
const base = `http://127.0.0.1:${port}`;
const workspace = process.env.CRM_LOOP_WORKSPACE || '/tmp/crm-docs';
const verifyOnly = process.argv.includes('--verify-persisted');
const householdId = 'documents-loop-household';
const taskId = 'documents-loop-task';
const noteId = 'documents-loop-note';
const documentName = 'Northcrest financial plan.txt';
const documentPath = join(workspace, documentName);

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
async function waitFor(testid, seconds = 20) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    if (await evaluate(`Boolean(document.querySelector('[data-testid="${testid}"]'))`)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  fail(`timed out waiting for ${testid}`);
}
async function choose(testid, value) {
  await evaluate(`(() => { const element = document.querySelector('[data-testid="${testid}"]'); if (!element) throw new Error('missing ${testid}'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(element, ${JSON.stringify(value)}); element.dispatchEvent(new Event('change', { bubbles: true })); })()`);
}
async function records() {
  return evaluate(`window.__TAURI_INTERNALS__.invoke('crm_live_list')`);
}
async function waitForLink(check, seconds = 12) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    if (await evaluate(check)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  fail('the document link was not saved through the live CRM record bridge');
}

try {
  mkdirSync(workspace, { recursive: true });
  writeFileSync(documentPath, 'Northcrest financial plan. This is the real workspace file.\n');
  await request('/health');
  if (!verifyOnly) {
    const seeded = [
      { id: householdId, kind: 'household', matterId: householdId, name: 'Northcrest documents loop', lifecycle: 'Active', primaryAdvisor: 'Maya', serviceTier: 'Standard', ownership: 'mine', facts: [], accounts: [], members: [], externalParties: [], notes: [{ id: noteId, body: 'Annual review note', audience: 'internal' }], customFields: [], tags: [] },
      { id: taskId, kind: 'task', matterId: 'firm_home', householdRef: { kind: 'household', id: householdId }, title: 'Send financial plan', status: 'open', contextRefs: [] },
    ];
    await evaluate(`(async () => { const invoke = window.__TAURI_INTERNALS__?.invoke; if (!invoke) throw new Error('Tauri invoke is unavailable'); await invoke('crm_set_workspace', { path: ${JSON.stringify(workspace)} }); for (const record of ${JSON.stringify(seeded)}) await invoke('crm_live_upsert', { record }); const { useWorkspaceStore } = await import('/src/platform/fs/workspaceStore.ts'); useWorkspaceStore.getState().setRootPath(${JSON.stringify(workspace)}); useWorkspaceStore.getState().setFileTree([{ id: ${JSON.stringify(documentPath)}, name: ${JSON.stringify(documentName)}, path: ${JSON.stringify(documentPath)}, type: 'file', size: 58 }]); return true; })()`);
  } else {
    await evaluate(`(async () => { const invoke = window.__TAURI_INTERNALS__?.invoke; await invoke('crm_set_workspace', { path: ${JSON.stringify(workspace)} }); const { useWorkspaceStore } = await import('/src/platform/fs/workspaceStore.ts'); useWorkspaceStore.getState().setRootPath(${JSON.stringify(workspace)}); useWorkspaceStore.getState().setFileTree([{ id: ${JSON.stringify(documentPath)}, name: ${JSON.stringify(documentName)}, path: ${JSON.stringify(documentPath)}, type: 'file', size: 58 }]); })()`);
  }
  await waitFor('spine-nav-matters', 30);
  await click('spine-nav-matters');
  await waitFor('crm-directory-surface');
  await click(`crm-directory-household-${householdId}`);
  await waitFor('crm-household-record');
  await evaluate(`Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Documents')?.click()`);
  await waitFor('crm-household-documents');
  if (verifyOnly) {
    const page = String(await evaluate('document.body.innerText'));
    for (const text of [documentName, 'Northcrest documents loop household', 'Annual review note', 'Send financial plan']) if (!page.includes(text)) fail(`saved document link is missing after restart: ${text}`);
    console.log('PASS: household, note, and task document links survived restart through the encrypted live CRM record bridge.');
    process.exit(0);
  }
  await choose('crm-document-file', documentPath);
  await click('crm-document-attach');
  await waitForLink(`window.__TAURI_INTERNALS__.invoke('crm_live_list').then((rows) => rows.some((row) => row.id === ${JSON.stringify(householdId)} && row.contextRefs?.some((ref) => ref.kind === 'document' && ref.id === ${JSON.stringify(documentPath)})))`);
  await choose('crm-document-target', `embedded-note:${noteId}`);
  await choose('crm-document-file', documentPath);
  await click('crm-document-attach');
  await waitForLink(`window.__TAURI_INTERNALS__.invoke('crm_live_list').then((rows) => rows.some((row) => row.id === ${JSON.stringify(householdId)} && row.notes?.some((note) => note.id === ${JSON.stringify(noteId)} && note.links?.some((ref) => ref.kind === 'document' && ref.id === ${JSON.stringify(documentPath)})))`);
  await choose('crm-document-target', `task:${taskId}`);
  await choose('crm-document-file', documentPath);
  await click('crm-document-attach');
  await waitForLink(`window.__TAURI_INTERNALS__.invoke('crm_live_list').then((rows) => rows.some((row) => row.id === ${JSON.stringify(taskId)} && row.contextRefs?.some((ref) => ref.kind === 'document' && ref.id === ${JSON.stringify(documentPath)})))`);
  await click(`crm-document-detach-task-${taskId}`);
  await waitForLink(`window.__TAURI_INTERNALS__.invoke('crm_live_list').then((rows) => !rows.some((row) => row.id === ${JSON.stringify(taskId)} && row.contextRefs?.some((ref) => ref.kind === 'document' && ref.id === ${JSON.stringify(documentPath)})))`);
  // Re-link the task so the restart pass proves all three supported targets.
  await choose('crm-document-target', `task:${taskId}`);
  await choose('crm-document-file', documentPath);
  await click('crm-document-attach');
  await waitForLink(`window.__TAURI_INTERNALS__.invoke('crm_live_list').then((rows) => rows.some((row) => row.id === ${JSON.stringify(taskId)} && row.contextRefs?.some((ref) => ref.kind === 'document' && ref.id === ${JSON.stringify(documentPath)})))`);
  await evaluate(`Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Timeline')?.click()`);
  await waitFor('crm-household-timeline');
  if (!String(await evaluate('document.body.innerText')).includes(`Linked document: ${documentName}`)) fail('linked document does not appear on the household timeline');
  console.log('PASS: live household, note, and task links attached/detached through EntityRefs and appeared on the household timeline. Restart the app, then run documents.mjs --verify-persisted.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
