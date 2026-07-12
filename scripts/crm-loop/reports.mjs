#!/usr/bin/env node
// Real desktop loop for Home > Reports. It seeds only the records needed to
// prove calculations, then uses visible controls and a true app relaunch to
// prove a saved report recipe survives. It intentionally drives every report
// parity path in one real desktop session, then proves the durable records
// are still present after the native app restarts.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const port = process.env.LANTERN_DEV_BRIDGE_PORT || process.env.DESKTOP_CDP_PORT || '9265';
const base = `http://127.0.0.1:${port}`;
const workspace = process.env.CRM_LOOP_WORKSPACE || '/tmp/lantern-crm-reports-loop';
const id = `reports-${Date.now()}`;
const savedName = `Follow-up report ${id}`;

function fail(message) { throw new Error(`FAIL: ${message}`); }
async function request(path, query = {}) {
  const url = new URL(`${base}${path}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  const response = await fetch(url); const body = await response.json();
  if (!response.ok || !body.ok) fail(body.error || `${path} failed`);
  return body.result;
}
const evaluate = (js) => request('/eval', { js });
const click = (testid) => request('/click', { testid });
const fill = (testid, text) => request('/fill', { testid, text });
async function waitFor(testid, seconds = 15) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    try { if (await evaluate(`Boolean(document.querySelector('[data-testid="${testid}"]'))`)) return; } catch { /* desktop is restarting */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  fail(`timed out waiting for ${testid}`);
}
async function waitForText(text, seconds = 15) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    try { if (String(await evaluate('document.body.innerText')).includes(text)) return; } catch { /* desktop is restarting */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  fail(`timed out waiting for ${text}`);
}
async function setWorkspace() {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      await evaluate(`(async () => {
        const invoke = window.__TAURI_INTERNALS__?.invoke;
        if (!invoke) throw new Error('Tauri invoke is unavailable');
        await invoke('crm_set_workspace', { path: ${JSON.stringify(workspace)} });
        const { useWorkspaceStore } = await import('/src/platform/fs/workspaceStore.ts');
        useWorkspaceStore.getState().setRootPath(${JSON.stringify(workspace)});
        return true;
      })()`);
      return;
    } catch (error) { lastError = error; await new Promise((resolveWait) => setTimeout(resolveWait, 250)); }
  }
  fail(`could not select the loop workspace: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}
async function relaunch() {
  try { await evaluate("(async () => { const { relaunch } = await import('@tauri-apps/plugin-process'); await relaunch(); return true; })()"); } catch { /* The old app closes before it can reply. */ }
  await waitFor('spine-nav-home', 25);
  await setWorkspace();
  await click('spine-nav-home');
  await waitFor('crm-home-nav-reports', 25);
}

try {
  mkdirSync(workspace, { recursive: true });
  await request('/health');
  await setWorkspace();
  await click('spine-nav-matters').catch(() => {});
  await waitFor('crm-home-nav-reports', 30).catch(() => fail('the app stayed on the workspace chooser after the workspace was selected; the known onboarding blocker prevented this live report drive.'));
  await evaluate(`(async () => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const hhA = 'household-${id}-a'; const hhB = 'household-${id}-b';
    await invoke('crm_live_upsert', { record: { id: hhA, kind: 'household', matterId: hhA, name: 'Recorded attention household', serviceTier: 'Gold', annualFee: 1200, nextReviewDue: '2026-07-20' } });
    await invoke('crm_live_upsert', { record: { id: hhB, kind: 'household', matterId: hhB, name: 'Missing fee household', serviceTier: 'Silver' } });
    await invoke('crm_live_upsert', { record: { id: 'activity-${id}', kind: 'activityEvent', matterId: 'firm_home', householdId: hhA, at: '2026-07-10T12:00:00Z', summary: 'Recorded client call' } });
    await invoke('crm_live_upsert', { record: { id: 'person-${id}', kind: 'person', matterId: hhA, householdId: hhA, firstName: 'Avery', lastName: 'Birthday', birthDate: '1961-07-20' } });
    return true;
  })()`);
  await click('crm-home-nav-reports');
  await waitFor('crm-screen-reports');
  // Canned/client-neglect report: the recent activity must keep the first
  // household out while the untouched household stays visible.
  await click('crm-report-no-contact-in-6-months');
  await click('crm-report-run');
  await waitForText('Missing fee household');
  const noContact = await evaluate('document.body.innerText');
  if (String(noContact).includes('Recorded attention household · lastContact: Not recorded')) fail('a recent saved activity was treated as missing contact');
  // Attention versus fee: never invent a fee when one was not recorded.
  await click('crm-report-attention-vs-fee');
  await click('crm-report-run');
  await waitForText('No fee data recorded');
  await waitForText('Cannot compare attention to a fee that is not recorded');
  // Ask only proposes a bounded recipe. The advisor still chooses to run it.
  await fill('crm-report-ai-prompt', 'Who has birthdays soon?');
  await click('crm-report-ai-run');
  await waitFor('crm-report-ask-proposal');
  await click('crm-report-ask-use-proposal');
  await click('crm-report-run');
  await waitForText('Avery Birthday');
  // Custom report + saved recipe: save the current recipe, not its results.
  await click('crm-report-builder');
  await click('crm-report-run');
  await waitForText('Custom report');
  await click('crm-report-save');
  await waitFor('crm-report-save-dialog');
  await fill('crm-report-save-name', savedName);
  await evaluate(`(() => { const select = document.querySelector('[data-testid="crm-report-save-visibility"]'); select.value = 'firm'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await click('crm-report-save-confirm');
  await waitForText(savedName);
  const before = await evaluate(`window.__TAURI_INTERNALS__.invoke('crm_live_list')`);
  const saved = before.find((record) => record.kind === 'savedReport' && record.name === savedName);
  if (!saved || saved.visibility !== 'firm' || saved.reportKind !== 'custom') fail('saved report recipe was not stored through the CRM record bridge');
  const evidence = resolve(process.env.CRM_LOOP_SCREENSHOTS_DIR || 'docs/evidence/golden-loop');
  mkdirSync(evidence, { recursive: true });
  execFileSync('scrot', ['-o', resolve(evidence, '05-reports.png')], { env: { ...process.env, DISPLAY: process.env.CRM_LOOP_DISPLAY || process.env.DISPLAY || ':111' }, stdio: 'ignore' });
  await relaunch();
  await click('crm-home-nav-reports');
  await waitForText(savedName);
  await click(`crm-report-saved-${saved.id}`);
  await waitForText('Custom report');
  console.log('PASS: Reports calculated from durable CRM records, disclosed missing fee data, proposed an Ask report, and retained a firm-shared saved report through relaunch.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
