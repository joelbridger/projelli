#!/usr/bin/env node
/**
 * Real desktop proof for the Firm setup lane. Start the app with this lane's
 * bridge port, run once to save data, restart the app using the same workspace,
 * then rerun with --verify-persisted.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const base = `http://127.0.0.1:${process.env.LANTERN_DEV_BRIDGE_PORT || '9266'}`;
const verifyOnly = process.argv.includes('--verify-persisted');
const workspace = process.env.CRM_LOOP_WORKSPACE || '/tmp/crm-firm-loop';
const householdName = 'Firm setup loop household';

async function request(path, params = {}) {
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  let last;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url);
      const body = await response.json();
      if (response.ok && body.ok) return body.result;
      last = new Error(body.error || `${path} failed`);
      if (!last.message.includes('eval code@') && !last.message.includes('fetch failed')) throw last;
    } catch (error) {
      last = error;
      if (!(error instanceof Error) || (!error.message.includes('eval code@') && !error.message.includes('fetch failed'))) throw error;
    }
    await new Promise((done) => setTimeout(done, 150));
  }
  throw last ?? new Error(`${path} failed`);
}

const click = (testid) => request('/click', { testid });
const fill = (testid, text) => request('/fill', { testid, text });
const evaluate = (js) => request('/eval', { js, timeout_ms: 20_000 });
const select = (testid, value) => evaluate(`(() => { const e = document.querySelector('[data-testid="${testid}"]'); if (!e) throw new Error('missing ${testid}'); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('change', { bubbles: true })); return e.value; })()`);

async function waitFor(testid, seconds = 20) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (await evaluate(`Boolean(document.querySelector('[data-testid="${testid}"]'))`)) return;
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error(`Timed out waiting for ${testid}`);
}

async function waitForText(text, seconds = 20) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (String(await evaluate('document.body.innerText')).includes(text)) return;
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error(`Timed out waiting for text: ${text}`);
}

async function setWorkspace() {
  await evaluate(`(async () => { const invoke = window.__TAURI_INTERNALS__?.invoke; if (!invoke) throw new Error('Tauri invoke is not ready'); await invoke('crm_set_workspace', { path: ${JSON.stringify(workspace)} }); const { useWorkspaceStore } = await import('/src/platform/fs/workspaceStore.ts'); useWorkspaceStore.getState().setRootPath(${JSON.stringify(workspace)}); return true; })()`);
}

async function ensureHousehold() {
  await click('spine-nav-matters');
  await waitFor('crm-directory-surface');
  const existing = await evaluate(`Array.from(document.querySelectorAll('[data-testid^="crm-directory-household-"]')).map((node) => node.getAttribute('data-testid')).find((id) => document.querySelector('[data-testid="' + id + '"]')?.textContent?.includes(${JSON.stringify(householdName)})) || null`);
  if (existing) return;
  await click('crm-directory-add');
  await fill('crm-household-name', householdName);
  await click('crm-household-save');
  await waitFor('crm-household-record');
}

async function openFirm(tab) {
  await click('spine-nav-home');
  await waitFor('crm-home');
  await click('crm-home-nav-firm-setup');
  await waitFor('crm-firm-surface');
  await click(`crm-firm-tab-${tab}`);
}

async function saveFirmSetup() {
  await ensureHousehold();
  await openFirm('fields');
  await click('crm-field-create');
  await fill('crm-field-label', 'Service region');
  await fill('crm-field-key', 'service-region');
  await select('crm-field-type', 'enum');
  await fill('crm-field-options', 'North, South');
  await click('crm-field-save');
  await waitForText('Service region');
  await openFirm('tags');
  await click('crm-tag-create');
  await fill('crm-tag-name', 'New client');
  await click('crm-tag-save');
  await waitForText('New client');
  await openFirm('values');
  const householdId = await evaluate(`Array.from(document.querySelector('[data-testid="crm-record-values-select"]')?.options ?? []).find((option) => option.textContent?.includes(${JSON.stringify(householdName)}))?.value || ''`);
  if (!householdId) throw new Error('The saved household is not available to the firm values editor.');
  await select('crm-record-values-select', householdId);
  await waitFor('crm-record-value-service_region');
  await select('crm-record-value-service_region', 'North');
  const tagId = await evaluate(`Array.from(document.querySelectorAll('[data-testid^="crm-record-tag-"]')).find((node) => node.parentElement?.textContent?.includes('New client'))?.getAttribute('data-testid') || ''`);
  if (!tagId) throw new Error('The saved tag is not available in the record tag picker.');
  await click(tagId);
  await click('crm-record-values-save');
  const saved = await evaluate(`window.__TAURI_INTERNALS__.invoke('crm_live_list')`);
  const household = Array.isArray(saved) ? saved.find((record) => record.id === householdId) : null;
  if (household?.customFields?.service_region?.value !== 'North' || !Array.isArray(household.tagIds) || !household.tagIds.includes(tagId.replace('crm-record-tag-', ''))) {
    throw new Error('The custom-field value or tag was not saved to the selected household.');
  }
}

async function verifySaved() {
  await openFirm('fields');
  const fields = await evaluate('document.body.innerText');
  if (!String(fields).includes('Service region')) throw new Error('Saved custom field is missing after restart.');
  await openFirm('tags');
  const tags = await evaluate('document.body.innerText');
  if (!String(tags).includes('New client')) throw new Error('Saved tag is missing after restart.');
  await openFirm('values');
  const householdId = await evaluate(`Array.from(document.querySelector('[data-testid="crm-record-values-select"]')?.options ?? []).find((option) => option.textContent?.includes(${JSON.stringify(householdName)}))?.value || ''`);
  if (!householdId) throw new Error('Saved household is missing after restart.');
  await select('crm-record-values-select', householdId);
  const value = await evaluate(`document.querySelector('[data-testid="crm-record-value-service_region"]')?.value || ''`);
  const selectedTag = await evaluate(`Array.from(document.querySelectorAll('[data-testid^="crm-record-tag-"]')).some((node) => node.checked && node.parentElement?.textContent?.includes('New client'))`);
  if (value !== 'North' || !selectedTag) throw new Error(`Saved value or tag did not return after restart (value=${value}, tag=${selectedTag}).`);
}

try {
  await setWorkspace();
  await waitFor('spine-nav-home', 30);
  if (!verifyOnly) await saveFirmSetup();
  await verifySaved();
  const evidence = resolve(process.env.CRM_LOOP_SCREENSHOTS_DIR || 'docs/evidence/golden-loop');
  mkdirSync(evidence, { recursive: true });
  try { execFileSync('scrot', ['-o', resolve(evidence, 'firm-setup.png')], { env: { ...process.env, DISPLAY: process.env.DISPLAY || ':111' }, stdio: 'ignore' }); } catch { /* DOM proof remains valid when no X display is exposed. */ }
  console.log(`PASS firm: ${verifyOnly ? 'custom fields, tags, and record values survived restart' : 'saved custom field, tag, and record values; now restart and rerun with --verify-persisted'}`);
} catch (error) {
  console.error(`FAIL firm: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
