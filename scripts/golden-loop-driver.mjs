#!/usr/bin/env node
/**
 * One real-app golden-loop driver: create a Word document through the visible
 * Documents surface, then prove the exact file is still visible after restart.
 *
 * This deliberately uses only the debug bridge's DOM actions.  It does not
 * call a file-writing Tauri command directly: that would test the engine while
 * leaving the user-facing surface unproven.
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const [phase, bridgePort, workspace, documentName] = process.argv.slice(2);
if (!['write', 'assert'].includes(phase) || !bridgePort || !workspace || !documentName) {
  throw new Error('usage: golden-loop-driver.mjs <write|assert> <bridge-port> <workspace> <document-name>');
}

const base = `http://127.0.0.1:${bridgePort}`;
const documentFile = `${documentName}.docx`;
const expectedPath = path.join(workspace, 'docs', documentFile);
const timeoutMs = Number(process.env.GOLDEN_LOOP_DRIVER_TIMEOUT_MS || 30_000);

function fail(message) {
  throw new Error(`GOLDEN LOOP FAILED: ${message}`);
}

async function request(endpoint, query = {}) {
  const url = new URL(endpoint, base);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  const response = await fetch(url);
  const body = await response.json().catch(() => ({ ok: false, error: `non-JSON response (${response.status})` }));
  if (!response.ok || !body.ok) fail(body.error || `${endpoint} returned HTTP ${response.status}`);
  return body.result;
}

const evaluate = (source) => request('/eval', { js: source, timeout_ms: 20_000 });
const click = (testid) => request('/click', { testid, timeout_ms: 20_000 });
const pointerClick = (testid) => evaluate(`(() => {
  const target = document.querySelector('[data-testid=${JSON.stringify(testid)}]');
  if (!target) throw new Error('No element found for data-testid=${testid}');
  const rect = target.getBoundingClientRect();
  const options = { bubbles: true, cancelable: true, button: 0, buttons: 1,
    clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
    pointerId: 1, pointerType: 'mouse', isPrimary: true };
  for (const type of ['pointerover', 'pointerenter', 'pointermove', 'pointerdown']) {
    target.dispatchEvent(new PointerEvent(type, options));
  }
  target.dispatchEvent(new MouseEvent('mousedown', options));
  target.dispatchEvent(new PointerEvent('pointerup', options));
  target.dispatchEvent(new MouseEvent('mouseup', options));
  target.dispatchEvent(new MouseEvent('click', options));
  return true;
})()`);

async function waitFor(label, predicate, waitTimeoutMs = timeoutMs) {
  const deadline = Date.now() + waitTimeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  fail(`timed out waiting for ${label}${lastError ? ` (${lastError.message})` : ''}`);
}

const has = (testid) =>
  evaluate(`Boolean(document.querySelector('[data-testid=${JSON.stringify(testid)}]'))`);

async function waitForVisibleApp() {
  await request('/health');
  await waitFor('the Clients navigation control', () => has('spine-nav-matters'));
  if (await has('feature-tour-skip')) await click('feature-tour-skip');
  await waitFor('the Golden Loop client row', () =>
    evaluate(`Array.from(document.querySelectorAll('[data-testid]')).some((el) =>
      (el.getAttribute('data-testid') || '').startsWith('matter-row-'))`),
  );
  await evaluate(`(() => {
    const target = Array.from(document.querySelectorAll('[data-testid]')).find((el) =>
      (el.getAttribute('data-testid') || '').startsWith('matter-row-'));
    if (!target) throw new Error('No Golden Loop client row found');
    target.click();
    return true;
  })()`);
  await waitFor('the client Documents tab', () => has('hub-subtab-documents'));
  await click('hub-subtab-documents');
  await waitFor('the Documents create menu', () => has('documents-files-create-menu'));
  await pointerClick('documents-files-create-menu');
  await waitFor('the Documents create control', () => has('documents-create-document'));
}

async function prepareExplicitWorkspaceForGoldenLoop() {
  // The launcher provides this fresh directory with --workspace. The app must
  // open it itself, without presenting the native folder picker; this gate
  // intentionally fails if that first-run handoff regresses.
  await request('/health');
  await waitFor('the explicitly opened workspace', () => has('spine-nav-matters'));
  // Documents now live under a client, not as a global rail item.  This is
  // fixture setup only: the document itself is still created by the visible
  // Documents button below.  A clean local app has no client without the
  // signed-in intake flow, so create one through the same local state model
  // and then use its real, visible Documents action.
  await evaluate(`(async () => {
    const module = await import('/src/platform/matter/matterStore.ts');
    const store = module.useMatterStore.getState();
    if (!store.matters.some((matter) => matter.name === 'Golden Loop Client')) {
      store.createMatter({ name: 'Golden Loop Client', client: '' });
    }
    return true;
  })()`);
  await waitForVisibleApp();
}

async function fillPromptAndConfirm() {
  await waitFor('the document-name prompt', () =>
    evaluate(`Boolean(document.querySelector('[role="dialog"] input'))`),
  );
  const value = JSON.stringify(documentName);
  await evaluate(`(() => {
    const input = document.querySelector('[role="dialog"] input');
    if (!input) throw new Error('document-name prompt disappeared');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter) throw new Error('could not find the native input setter');
    setter.call(input, ${value});
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${value} }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  })()`);
  await waitFor('the document-name prompt to close', async () => !(await evaluate(`Boolean(document.querySelector('[role="dialog"] input'))`)));
}

async function assertPresent(where) {
  await waitFor(`${documentFile} to be saved ${where}`, async () => {
    const files = await readdir(workspace, { recursive: true });
    return files.some((entry) => String(entry).endsWith(documentFile));
  }, 20_000);
  await waitFor(`${documentFile} to be visible ${where}`, async () => {
    const body = await evaluate('document.body.innerText || ""');
    return String(body).includes(documentFile);
  }, 20_000);
}

try {
  if (phase === 'write') {
    await prepareExplicitWorkspaceForGoldenLoop();
    // This is a real UI click.  It fails if the promised Documents surface has
    // no driver handle, instead of silently falling back to a backend write.
    await click('documents-create-document');
    await fillPromptAndConfirm();
    await assertPresent('immediately after saving');
    console.log(`PASS write: created and displayed ${documentFile}`);
  } else {
    await waitForVisibleApp();
    await assertPresent('after app restart');
    console.log(`PASS persistence: ${documentFile} survived restart and is visible`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
