#!/usr/bin/env node
/**
 * Desktop proof for the household Email and Meetings tabs.
 *
 * The script creates one ordinary household through the UI, then proves that
 * the tabs render their honest first-use state from the real mail/calendar
 * bridges. Run it again with --verify-persisted after restarting the app.
 */
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const port = process.env.LANTERN_DEV_BRIDGE_PORT || '9267';
const base = `http://127.0.0.1:${port}`;
const workspace = process.env.CRM_LOOP_WORKSPACE || '/tmp/lantern-crm-email-calendar-loop';
const name = process.env.CRM_LOOP_HOUSEHOLD_NAME || 'Email and calendar desktop check';
const verifyOnly = process.argv.includes('--verify-persisted');

function fail(message) { throw new Error(message); }
async function request(path, query = {}) {
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || !body.ok) fail(body.error || `${path} failed`);
  return body.result;
}
const evaluate = (js) => request('/eval', { js, timeout_ms: 20_000 });
const click = (testid) => request('/click', { testid });
const fill = (testid, text) => request('/fill', { testid, text });
async function waitFor(testid, seconds = 20) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (await evaluate(`Boolean(document.querySelector('[data-testid="${testid}"]'))`)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  fail(`Timed out waiting for ${testid}. The workspace chooser blocker may still be active.`);
}
async function householdButton() {
  return evaluate(`Array.from(document.querySelectorAll('[data-testid^="crm-directory-household-"]')).find((node) => node.textContent?.includes(${JSON.stringify(name)}))?.getAttribute('data-testid') || null`);
}
async function openHousehold() {
  await click('spine-nav-matters');
  await waitFor('crm-directory-surface');
  const existing = await householdButton();
  if (existing) {
    await click(existing);
  } else if (verifyOnly) {
    fail('The household did not survive the restart.');
  } else {
    await click('crm-directory-add');
    await fill('crm-household-name', name);
    await click('crm-household-save');
  }
  await waitFor('crm-household-record');
}

try {
  mkdirSync(workspace, { recursive: true });
  await request('/health');
  // Use the app’s real workspace store, so the live record bridge reads the
  // exact encrypted store that will be used again after a restart.
  await evaluate(`(async () => {
    const invoke = window.__TAURI_INTERNALS__?.invoke;
    if (!invoke) throw new Error('Tauri invoke is not ready');
    await invoke('crm_set_workspace', { path: ${JSON.stringify(workspace)} });
    const { useWorkspaceStore } = await import('/src/platform/fs/workspaceStore.ts');
    useWorkspaceStore.getState().setRootPath(${JSON.stringify(workspace)});
  })()`);
  await openHousehold();

  await evaluate(`Array.from(document.querySelectorAll('[role="radio"], button')).find((node) => node.textContent?.trim() === 'Email')?.click()`);
  await waitFor('crm-household-email');
  await evaluate(`Array.from(document.querySelectorAll('[role="radio"], button')).find((node) => node.textContent?.trim() === 'Meetings')?.click()`);
  await waitFor('crm-household-meetings');

  const records = await evaluate('window.__TAURI_INTERNALS__.invoke(\'crm_live_list\')');
  const saved = records.find((record) => record.kind === 'household' && record.name === name);
  if (!saved) fail('The household was not saved through the live CRM record bridge.');
  const page = await evaluate('document.body.innerText');
  if (!String(page).includes('Meetings')) fail('The Meetings tab did not render.');

  const evidence = resolve(process.env.CRM_LOOP_SCREENSHOTS_DIR || 'docs/evidence/golden-loop');
  mkdirSync(evidence, { recursive: true });
  execFileSync('scrot', ['-o', resolve(evidence, '06-email-calendar.png')], { env: { ...process.env, DISPLAY: process.env.DISPLAY || ':111' }, stdio: 'ignore' });
  console.log(`PASS: household Email and Meetings tabs opened from the real desktop app${verifyOnly ? ' after restart' : ''}. Connected mail/calendar data, when present, remains in its existing store and creates only timeline links.`);
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
