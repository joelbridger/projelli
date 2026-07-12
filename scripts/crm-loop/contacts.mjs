#!/usr/bin/env node
/**
 * Real desktop proof for the Contacts completion lane.
 * Run once to add data, restart the app, then run with --verify-persisted.
 */
const base = `http://127.0.0.1:${process.env.LANTERN_DEV_BRIDGE_PORT || '9263'}`;
const workspace = process.env.CRM_LOOP_WORKSPACE || '/tmp/crm-contacts-loop';
const name = 'Contacts persistence check';
const verifyOnly = process.argv.includes('--verify-persisted');

async function request(path, params = {}) {
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body.error || `${path} failed`);
  return body.result;
}
const click = (testid) => request('/click', { testid });
const fill = (testid, text) => request('/fill', { testid, text });
const evalApp = (js) => request('/eval', { js });
async function waitFor(testid, seconds = 20) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (await evalApp(`Boolean(document.querySelector('[data-testid="${testid}"]'))`)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${testid}`);
}
async function clickText(text) {
  const clicked = await evalApp(`(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === ${JSON.stringify(text)}); if (!button) return false; button.click(); return true; })()`);
  if (!clicked) throw new Error(`Could not find button: ${text}`);
}
async function openHousehold() {
  await evalApp(`(async () => { const invoke = window.__TAURI_INTERNALS__?.invoke; if (!invoke) throw new Error('Tauri bridge is not ready'); await invoke('crm_set_workspace', { path: ${JSON.stringify(workspace)} }); const { useWorkspaceStore } = await import('/src/platform/fs/workspaceStore.ts'); useWorkspaceStore.getState().setRootPath(${JSON.stringify(workspace)}); })()`);
  await waitFor('spine-nav-matters', 30);
  await click('spine-nav-matters');
  await waitFor('crm-directory-surface');
  const existing = await evalApp(`Array.from(document.querySelectorAll('[data-testid^="crm-directory-household-"]')).find((item) => item.textContent?.includes(${JSON.stringify(name)}))?.getAttribute('data-testid') || null`);
  if (existing) await click(existing);
  else {
    await click('crm-directory-add'); await fill('crm-household-name', name); await click('crm-household-save');
  }
  await waitFor('crm-household-record');
}
async function addRecords() {
  await openHousehold();
  await click('crm-household-add'); await click('crm-household-add-person'); await waitFor('crm-person-editor');
  await evalApp(`(() => { const el = document.querySelector('[data-testid="crm-person-type"]'); el.value = 'organization'; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await fill('crm-person-name', 'Northstar Tax Group'); await fill('crm-person-roles', 'Accountant');
  await fill('crm-person-relationship', 'Accountant'); await clickText('Add email'); await fill('crm-contact-email-0', 'advisor@northstar.example');
  await clickText('Add phone'); await fill('crm-contact-phone-0', '(555) 010-2026'); await click('crm-person-save');
  await click('crm-household-add'); await click('crm-household-add-fact'); await waitFor('crm-fact-editor');
  await fill('crm-fact-label', 'Preferred review month'); await fill('crm-fact-value', 'October'); await fill('crm-fact-source', 'Annual review meeting'); await fill('crm-fact-source-ref', 'crm:meeting:annual-review'); await click('crm-fact-save');
}
async function verify() {
  await openHousehold();
  const text = String(await evalApp('document.body.innerText'));
  for (const expected of ['Northstar Tax Group', 'Accountant', 'advisor@northstar.example', 'Preferred review month', 'October', 'Annual review meeting']) {
    if (!text.includes(expected)) throw new Error(`Saved contact data is missing: ${expected}`);
  }
}
try {
  if (!verifyOnly) await addRecords();
  await verify();
  console.log(`PASS: Contacts are ${verifyOnly ? 'still present after restart' : 'saved; restart the app then rerun with --verify-persisted'}.`);
} catch (error) { console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
