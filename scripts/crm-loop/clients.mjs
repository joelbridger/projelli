#!/usr/bin/env node
/**
 * Drives the real Tauri dev bridge. Start the app first, then run once to
 * create the fixture and again with --verify-persisted after restarting it.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const base = `http://127.0.0.1:${process.env.DESKTOP_CDP_PORT || '9250'}`;
const verifyOnly = process.argv.includes('--verify-persisted');
const suffix = 'CRM loop household';
const workspace = process.env.CRM_LOOP_WORKSPACE || '/tmp/crm-golden-loop';

async function request(path, params = {}) {
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url);
      const body = await response.json();
      if (response.ok && body.ok) return body.result;
      const error = new Error(body.error || `${path} failed`);
      if (!error.message.includes('eval code@')) throw error;
      lastError = error;
    } catch (error) {
      if (!(error instanceof Error) || (!error.message.includes('eval code@') && !error.message.includes('fetch failed'))) throw error;
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`${lastError?.message ?? `${path} failed`} while running ${path}${params.js ? `: ${params.js}` : params.testid ? ` on ${params.testid}` : ''}`);
}

const click = async (testid) => { await request('/click', { testid }); };
const fill = async (testid, text) => {
  await request('/fill', { testid, text });
  const saved = await evaluate(`(() => { const element = document.querySelector('[data-testid="${testid}"]'); return element && 'value' in element ? element.value : null; })()`);
  if (saved !== text) throw new Error(`The app did not accept the value for ${testid}`);
};
const evaluate = (js) => request('/eval', { js, timeout_ms: 20_000 });

async function waitFor(testid, seconds = 15) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    try {
      const exists = await evaluate(`Boolean(document.querySelector('[data-testid="${testid}"]'))`);
      if (exists) return;
    } catch (error) {
      // The native WebView can accept the bridge connection a moment before
      // the first React frame is ready. Keep waiting for the actual control.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${testid} (current screen: ${await evaluate('document.querySelector("[data-testid]")?.getAttribute("data-testid") || "none"')})`);
}

async function waitForGone(testid, seconds = 15) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    const exists = await evaluate(`Boolean(document.querySelector('[data-testid="${testid}"]'))`);
    if (!exists) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${testid} to close`);
}

async function findHousehold() {
  return evaluate(`Array.from(document.querySelectorAll('[data-testid^="crm-directory-household-"]')).map((node) => node.getAttribute('data-testid')).find((id) => document.querySelector('[data-testid="' + id + '"]')?.textContent?.includes(${JSON.stringify(suffix)})) || null`);
}

async function openFixture() {
  await click('spine-nav-matters');
  await waitFor('crm-directory-surface');
  let id = await findHousehold();
  if (!id) {
    await click('crm-directory-add');
    await fill('crm-household-name', suffix);
    await click('crm-household-save');
    await waitFor('crm-household-record');
  } else {
    await click(id);
    await waitFor('crm-household-record');
  }
}

async function createAndEdit() {
  await openFixture();
  await click('crm-household-edit');
  await waitFor('crm-household-editor');
  await fill('crm-household-edit-tier', 'Platinum');
  await fill('crm-household-edit-advisor', 'Maya Patel');
  await click('crm-household-edit-save');
  await waitForGone('crm-household-editor');

  await click('crm-household-add');
  await click('crm-household-add-person');
  await waitFor('crm-person-editor');
  await fill('crm-person-name', 'Avery CRM Loop');
  await fill('crm-person-roles', 'CPA, tax planner');
  await fill('crm-person-relationship', 'Spouse');
  await click('crm-person-save');
  await waitForGone('crm-person-editor');

  await click('crm-household-add');
  await click('crm-household-add-account');
  await waitFor('crm-account-editor');
  await fill('crm-account-custodian', 'Northcrest Custody');
  await fill('crm-account-type', 'Investment');
  await fill('crm-account-purpose', 'Retirement income');
  await fill('crm-account-last-four', '4821');
  await click('crm-account-save');
  await waitForGone('crm-account-editor');

  await click('crm-household-add');
  await click('crm-household-add-note');
  await waitFor('crm-note-editor');
  await fill('crm-note-body', 'Internal CRM loop note. Never include this in a client draft.');
  await click('crm-note-save');
  await waitForGone('crm-note-editor');

  await click('crm-household-metadata');
  await waitFor('crm-record-metadata-editor');
  await fill('crm-tag-input', 'crm-loop');
  await evaluate(`Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Add tag')?.click()`);
  await click('crm-save-metadata');
  await waitForGone('crm-record-metadata-editor');
}

async function assertSaved() {
  await openFixture();
  const text = await evaluate('document.body.innerText');
  for (const expected of ['Platinum', 'Maya Patel', 'Avery CRM Loop', 'Northcrest Custody', 'Internal CRM loop note.', 'crm-loop']) {
    if (!String(text).includes(expected)) throw new Error(`Saved record is missing: ${expected}`);
  }
  await click('crm-household-back');
  await waitFor('crm-directory-surface');
  // Use the visible People toggle rather than assuming a generated DOM id.
  await evaluate(`Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'People')?.click()`);
  await fill('crm-directory-search', 'Avery CRM Loop');
  const directoryText = await evaluate('document.body.innerText');
  if (!String(directoryText).includes('Avery CRM Loop')) throw new Error('Directory search did not return the saved person');
}

try {
  // The first desktop launch starts at the normal workspace chooser. Open the
  // fabricated loop folder through the same Tauri command the app uses, then
  // let the mounted shell react to its real workspace store.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await evaluate(`(async () => {
        const invoke = window.__TAURI_INTERNALS__?.invoke;
        if (!invoke) throw new Error('Tauri invoke is not ready');
        await invoke('crm_set_workspace', { path: ${JSON.stringify(workspace)} });
        const { useWorkspaceStore } = await import('/src/platform/fs/workspaceStore.ts');
        useWorkspaceStore.getState().setRootPath(${JSON.stringify(workspace)});
        return true;
      })()`);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  await waitFor('spine-nav-matters', 30);
  if (!verifyOnly) await createAndEdit();
  await assertSaved();
  const evidence = resolve(process.env.CRM_LOOP_SCREENSHOTS_DIR || 'docs/evidence/golden-loop');
  mkdirSync(evidence, { recursive: true });
  execFileSync('scrot', ['-o', resolve(evidence, '01-clients.png')], { env: { ...process.env, DISPLAY: process.env.DISPLAY || ':111' }, stdio: 'ignore' });
  console.log(`PASS: ${verifyOnly ? 'saved Clients records survived the restart' : 'Clients create/edit flow completed; now restart the app and rerun with --verify-persisted'}`);
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
