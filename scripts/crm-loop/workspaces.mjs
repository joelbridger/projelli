#!/usr/bin/env node
/**
 * Real desktop proof for Multiple Workspaces. Start the desktop app with this
 * bridge port, run once, restart that same app, then rerun with
 * --verify-persisted. It proves both directions of the boundary so one firm
 * space can never borrow a client from the other.
 */
const base = `http://127.0.0.1:${process.env.LANTERN_DEV_BRIDGE_PORT || '9427'}`;
const verifyOnly = process.argv.includes('--verify-persisted');
const root = process.env.CRM_LOOP_WORKSPACE || '/tmp/crm-workspaces';
const firstPath = `${root}-north`;
const secondPath = `${root}-coast`;
const firstClient = 'North workspace client';
const secondClient = 'Coast workspace client';

async function request(path, params = {}) {
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  let last;
  for (let attempt = 0; attempt < 80; attempt += 1) {
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

async function waitFor(testid, seconds = 25) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (await evaluate(`Boolean(document.querySelector('[data-testid="${testid}"]'))`)) return;
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error(`Timed out waiting for ${testid}`);
}

async function waitForWorkspace(path) {
  const end = Date.now() + 25_000;
  while (Date.now() < end) {
    const records = await evaluate(`(async () => { const invoke = window.__TAURI_INTERNALS__?.invoke; if (!invoke) return null; await invoke('crm_set_workspace', { path: ${JSON.stringify(path)} }); return invoke('crm_live_list'); })()`);
    if (Array.isArray(records)) return records;
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error(`Timed out opening ${path}`);
}

async function openWorkspaces() {
  await click('spine-nav-home');
  await waitFor('crm-home');
  await click('crm-home-nav-firm-setup');
  await waitFor('crm-firm-surface');
  await click('crm-firm-route-workspaces');
  await waitFor('crm-workspaces-surface');
}

async function create(path) {
  await fill('crm-workspace-new-path', path);
  await click('crm-workspace-create');
  await waitForWorkspace(path);
}

async function switchTo(path) {
  await evaluate(`(() => {
    const row = Array.from(document.querySelectorAll('[data-workspace-path]')).find((node) => node.getAttribute('data-workspace-path') === ${JSON.stringify(path)});
    const button = row?.querySelector('button:not([disabled])');
    if (!(button instanceof HTMLButtonElement)) throw new Error('No enabled switch button for the requested firm space.');
    button.click();
    return true;
  })()`);
  return waitForWorkspace(path);
}

function hasOnly(records, included, excluded) {
  return records.some((record) => record.name === included) && !records.some((record) => record.name === excluded);
}

try {
  await waitFor('spine-nav-home', 35);
  if (!verifyOnly) {
    await openWorkspaces();
    const promise = await evaluate(`document.querySelector('[data-testid="crm-workspace-isolation-promise"]')?.innerText || ''`);
    if (!String(promise).includes('own encrypted data store')) throw new Error('The firm-space screen does not explain the privacy boundary.');
    await create(firstPath);
    await evaluate(`window.__TAURI_INTERNALS__.invoke('crm_live_upsert', { record: { id: 'workspace-loop-north', kind: 'household', matterId: 'workspace-loop-north', name: ${JSON.stringify(firstClient)}, status: 'active' } })`);
    if (!(await waitForWorkspace(firstPath)).some((record) => record.name === firstClient)) throw new Error('The first firm-space client was not saved.');
    await openWorkspaces();
    await create(secondPath);
    const secondBefore = await waitForWorkspace(secondPath);
    if (secondBefore.some((record) => record.name === firstClient)) throw new Error('A client leaked into the second firm space.');
    await evaluate(`window.__TAURI_INTERNALS__.invoke('crm_live_upsert', { record: { id: 'workspace-loop-coast', kind: 'household', matterId: 'workspace-loop-coast', name: ${JSON.stringify(secondClient)}, status: 'active' } })`);
    if (!(await waitForWorkspace(secondPath)).some((record) => record.name === secondClient)) throw new Error('The second firm-space client was not saved.');
    console.log('PASS setup: two separate encrypted firm spaces saved different clients. Restart the app, then rerun this script with --verify-persisted.');
  } else {
    const secondAfterRestart = await waitForWorkspace(secondPath);
    if (!hasOnly(secondAfterRestart, secondClient, firstClient)) throw new Error('The second firm space did not stay isolated after restart.');
    await openWorkspaces();
    const firstAgain = await switchTo(firstPath);
    if (!hasOnly(firstAgain, firstClient, secondClient)) throw new Error('Switching back mixed the firm spaces.');
    await openWorkspaces();
    const secondAgain = await switchTo(secondPath);
    if (!hasOnly(secondAgain, secondClient, firstClient)) throw new Error('Switching again mixed the firm spaces.');
    console.log('PASS persistence: both encrypted firm spaces survived restart and stayed completely separate while switching both ways.');
  }
} catch (error) {
  console.error(`FAIL workspaces: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
