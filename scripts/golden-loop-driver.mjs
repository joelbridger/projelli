#!/usr/bin/env node
/**
 * Create a Word document through the visible Documents surface, then prove the
 * exact file is still visible after restarting the native app.
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const [phase, bridgePort, workspace, documentName] = process.argv.slice(2);
if (!['write', 'assert'].includes(phase) || !bridgePort || !workspace || !documentName) {
  throw new Error('usage: golden-loop-driver.mjs <write|assert> <bridge-port> <workspace> <document-name>');
}

const base = `http://127.0.0.1:${bridgePort}`;
const documentFile = `${documentName}.docx`;
const expectedDevUrl = process.env.GOLDEN_LOOP_DEV_URL || 'the configured desktop dev URL';
const timeoutMs = Number(process.env.GOLDEN_LOOP_DRIVER_TIMEOUT_MS || 30_000);

function fail(message) {
  throw new Error(`GOLDEN LOOP FAILED: ${message}`);
}

class RendererCallbackError extends Error {}

async function request(endpoint, query = {}) {
  const url = new URL(endpoint, base);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  const response = await fetch(url);
  const body = await response.json().catch(() => ({ ok: false, error: `non-JSON response (${response.status})` }));
  if (!response.ok || !body.ok) fail(body.error || `${endpoint} returned HTTP ${response.status}`);
  return body.result;
}

const rawEvaluate = (source, operationTimeoutMs = 20_000) =>
  request('/eval', { js: source, timeout_ms: operationTimeoutMs });

async function evaluate(source) {
  try {
    return await rawEvaluate(source, 20_000);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('eval timed out after 20000ms')) {
      throw new RendererCallbackError(
        `renderer callback did not return within 20000ms after readiness was established; ` +
        `native bridge=${base}, expected page=${expectedDevUrl}. This is a renderer/native callback failure, not a slow DOM condition.`
      );
    }
    throw error;
  }
}

async function click(testid) {
  try {
    return await request('/click', { testid, timeout_ms: 20_000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('eval timed out after 20000ms')) {
      throw new RendererCallbackError(
        `renderer callback for click(${testid}) did not return within 20000ms after readiness was established; ` +
        `native bridge=${base}, expected page=${expectedDevUrl}. This is a renderer/native callback failure, not a slow DOM condition.`
      );
    }
    throw error;
  }
}
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

async function rendererSnapshot() {
  try {
    return await rawEvaluate(`({
      href: location.href,
      readyState: document.readyState,
      hasTauriInvoke: typeof window.__TAURI_INTERNALS__?.invoke === 'function',
      explicitWorkspace: window.__LANTERN_WORKSPACE__ ?? null,
      testids: Array.from(document.querySelectorAll('[data-testid]')).slice(0, 30).map((el) => el.getAttribute('data-testid')),
      body: (document.body?.innerText || '').slice(0, 500)
    })`, 2_000);
  } catch (error) {
    return { snapshotError: error instanceof Error ? error.message : String(error) };
  }
}

async function waitFor(label, predicate, waitTimeoutMs = timeoutMs) {
  const deadline = Date.now() + waitTimeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (error) {
      if (error instanceof RendererCallbackError) throw error;
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const snapshot = await rendererSnapshot();
  fail(`timed out waiting for ${label}${lastError ? ` (${lastError.message})` : ''}; renderer=${JSON.stringify(snapshot)}`);
}

async function waitForRendererCallback() {
  await request('/health');
  const deadline = Date.now() + 20_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const state = await rawEvaluate(`({
        href: location.href,
        readyState: document.readyState,
        hasTauriInvoke: typeof window.__TAURI_INTERNALS__?.invoke === 'function'
      })`, 2_000);
      if (state?.hasTauriInvoke && state.readyState !== 'loading') return;
      lastError = new Error(`page state was ${JSON.stringify(state)}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  fail(
    `native bridge became healthy, but the renderer never returned a callback within 20000ms; ` +
    `expected page=${expectedDevUrl}; last diagnostic=${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}

const has = (testid) =>
  evaluate(`Boolean(document.querySelector('[data-testid=${JSON.stringify(testid)}]'))`);

async function waitForVisibleApp() {
  await waitForRendererCallback();
  await waitFor('the Clients navigation control', () => has('spine-nav-matters'));
  if (await has('feature-tour-skip')) await click('feature-tour-skip');
  await waitFor('the Golden Loop client row in the visible Clients rail', () =>
    evaluate(`Array.from(document.querySelectorAll('[data-testid]')).some((el) =>
      (el.getAttribute('data-testid') || '').startsWith('spine-client-row-'))`),
  );
  await evaluate(`(() => {
    const target = Array.from(document.querySelectorAll('[data-testid]')).find((el) =>
      (el.getAttribute('data-testid') || '').startsWith('spine-client-row-'));
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
  await waitForRendererCallback();
  await waitFor('the explicitly opened workspace', () => has('spine-nav-matters'));
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
  await waitFor('the document-name prompt to close', async () =>
    !(await evaluate(`Boolean(document.querySelector('[role="dialog"] input'))`)));
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
