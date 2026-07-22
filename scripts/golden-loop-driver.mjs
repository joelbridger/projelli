#!/usr/bin/env node
/**
 * Create a Word document through the visible Documents surface, then prove the
 * exact file is still visible after restarting the native app.
 */
import { readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createProgressReporter, writeDiagnosticArtifact } from './golden-loop-diagnostics.mjs';

const [phase, bridgePort, workspace, documentName] = process.argv.slice(2);
const base = `http://127.0.0.1:${bridgePort}`;
const documentFile = `${documentName}.docx`;
const expectedDevUrl = process.env.GOLDEN_LOOP_DEV_URL || 'the configured desktop dev URL';
const timeoutMs = Number(process.env.GOLDEN_LOOP_DRIVER_TIMEOUT_MS || 30_000);
const positiveBound = (name, fallback) => {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
export const HEALTH_REQUEST_TIMEOUT_MS = positiveBound('GOLDEN_LOOP_HEALTH_BOUND_MS', 2_000);
export const READINESS_TIMEOUT_MS = positiveBound('GOLDEN_LOOP_READINESS_BOUND_MS', 8_000);
export const SNAPSHOT_TIMEOUT_MS = positiveBound('GOLDEN_LOOP_SNAPSHOT_BOUND_MS', 3_000);
export const ARTIFACT_TIMEOUT_MS = positiveBound('GOLDEN_LOOP_ARTIFACT_BOUND_MS', 2_000);
const BRIDGE_TRANSPORT_ALLOWANCE_MS = 1_000;
const MIN_BRIDGE_OPERATION_MS = 100;
const reportProgress = createProgressReporter();
let activeBridgeDeadlineMs;

function fail(message) {
  throw new Error(`GOLDEN LOOP FAILED: ${message}`);
}

class RendererCallbackError extends Error {}
class BridgeRequestTimeoutError extends Error {}

async function request(endpoint, query = {}, { signal, timeoutMs: requestedTimeoutMs, deadlineMs } = {}) {
  const operationTimeoutMs = Number(query.timeout_ms ?? requestedTimeoutMs);
  const normalRequestTimeoutMs = endpoint === '/health'
    ? HEALTH_REQUEST_TIMEOUT_MS
    : (Number.isFinite(operationTimeoutMs) && operationTimeoutMs > 0 ? operationTimeoutMs : 20_000) + BRIDGE_TRANSPORT_ALLOWANCE_MS;
  const absoluteDeadlineMs = deadlineMs ?? activeBridgeDeadlineMs ?? (Date.now() + normalRequestTimeoutMs);
  const remainingMs = Math.floor(absoluteDeadlineMs - Date.now());
  if (remainingMs < (endpoint === '/health' ? 1 : BRIDGE_TRANSPORT_ALLOWANCE_MS + MIN_BRIDGE_OPERATION_MS)) {
    const url = new URL(endpoint, base);
    throw new BridgeRequestTimeoutError(`golden loop bridge request timed out: endpoint=${url.pathname} bound=0ms`);
  }
  const boundedQuery = { ...query };
  if (endpoint !== '/health' && Number.isFinite(operationTimeoutMs) && operationTimeoutMs > 0) {
    boundedQuery.timeout_ms = Math.max(100, Math.min(operationTimeoutMs, remainingMs - BRIDGE_TRANSPORT_ALLOWANCE_MS));
  }
  const url = new URL(endpoint, base);
  for (const [key, value] of Object.entries(boundedQuery)) url.searchParams.set(key, String(value));
  const effectiveOperationMs = Number(boundedQuery.timeout_ms ?? requestedTimeoutMs);
  const effectiveRequestBoundMs = endpoint === '/health'
    ? HEALTH_REQUEST_TIMEOUT_MS
    : (Number.isFinite(effectiveOperationMs) && effectiveOperationMs > 0 ? effectiveOperationMs : 20_000) + BRIDGE_TRANSPORT_ALLOWANCE_MS;
  const requestTimeoutMs = Math.max(1, Math.min(effectiveRequestBoundMs, remainingMs));
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, requestTimeoutMs);
  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) abortFromCaller();
    else signal.addEventListener('abort', abortFromCaller, { once: true });
  }
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.json().catch((error) => {
      if (timedOut) throw error;
      return { ok: false, error: `non-JSON response (${response.status})` };
    });
    if (!response.ok || !body.ok) fail(body.error || `${endpoint} returned HTTP ${response.status}`);
    return body.result;
  } catch (error) {
    if (timedOut) {
      throw new BridgeRequestTimeoutError(`golden loop bridge request timed out: endpoint=${url.pathname} bound=${requestTimeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

const rawEvaluate = (source, operationTimeoutMs = 20_000, options = {}) =>
  request('/eval', { js: source, timeout_ms: operationTimeoutMs }, options);

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
  const deadlineMs = Date.now() + SNAPSHOT_TIMEOUT_MS;
  try {
    const snapshot = await rawEvaluate(`({
      url: location.href,
      readyState: document.readyState,
      hasTauriInvoke: typeof window.__TAURI_INTERNALS__?.invoke === 'function',
      explicitWorkspace: Boolean(window.__LANTERN_WORKSPACE__),
      testIdCount: Math.min(document.querySelectorAll('[data-testid]').length, 100),
      dom: {
        elementCount: Math.min(document.querySelectorAll('*').length, 500),
        tags: Array.from(new Set(Array.from(document.querySelectorAll('*')).slice(0, 500).map((el) => el.tagName.toLowerCase()))).slice(0, 8)
      },
      rootPresent: Boolean(document.getElementById('root')),
      rootHasChildren: Boolean(document.getElementById('root')?.childElementCount),
      events: window.__LANTERN_GOLDEN_LOOP_DIAGNOSTICS__ || {}
    })`, Math.min(2_000, SNAPSHOT_TIMEOUT_MS), { deadlineMs });
    return { ...snapshot, pageUrl: expectedDevUrl };
  } catch (error) {
    return { snapshotError: error instanceof Error ? error.message : String(error) };
  }
}

async function waitFor(label, predicate, waitTimeoutMs = timeoutMs) {
  const deadline = Date.now() + waitTimeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const previousDeadline = activeBridgeDeadlineMs;
      activeBridgeDeadlineMs = deadline;
      try {
        if (await predicate()) return;
      } finally {
        activeBridgeDeadlineMs = previousDeadline;
      }
    } catch (error) {
      if (error instanceof RendererCallbackError) throw error;
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const snapshot = await rendererSnapshot();
  fail(`timed out waiting for ${label}${lastError ? ` (${lastError.message})` : ''}; renderer=${JSON.stringify(snapshot)}`);
}

export function createRendererReadiness({
  healthRequest,
  readinessEvaluate,
  publishProgress = async () => {},
  healthTimeoutMs = HEALTH_REQUEST_TIMEOUT_MS,
  readinessTimeoutMs = READINESS_TIMEOUT_MS,
  now = Date.now,
  pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  let rendererReady = false;
  return async function waitForRendererCallback() {
    if (rendererReady) return;
    // Health and renderer readiness are separate bounded operations. Starting
    // the renderer clock only after health succeeds preserves the full,
    // already-budgeted readiness window without extending either deadline.
    await healthRequest(now() + healthTimeoutMs);
    await publishProgress('bridge-healthy');
    const deadlineMs = now() + readinessTimeoutMs;
    let lastError;
    while (now() < deadlineMs) {
      try {
        const remainingMs = deadlineMs - now();
        const operationTimeoutMs = Math.min(2_000, remainingMs - BRIDGE_TRANSPORT_ALLOWANCE_MS);
        // Do not enqueue a native evaluation unless both the native callback
        // and its HTTP response have real time inside this same deadline.
        if (operationTimeoutMs < MIN_BRIDGE_OPERATION_MS) break;
        const state = await readinessEvaluate(deadlineMs, operationTimeoutMs);
        if (state?.hasTauriInvoke && state.readyState !== 'loading' && state.rootHasChildren) {
          rendererReady = true;
          await publishProgress('renderer-ready');
          return;
        }
        lastError = new Error('renderer state was not ready');
      } catch (error) {
        if (error instanceof BridgeRequestTimeoutError) throw error;
        lastError = error;
      }
      await pause(Math.min(100, Math.max(0, deadlineMs - now())));
    }
    fail(
      `native bridge became healthy, but the renderer never returned a callback within ${readinessTimeoutMs}ms; ` +
      `expected page=${expectedDevUrl}; last diagnostic=${lastError instanceof Error ? lastError.message : String(lastError)}`
    );
  };
}

const waitForRendererCallback = createRendererReadiness({
  healthRequest: (deadlineMs) => request('/health', {}, { deadlineMs }),
  readinessEvaluate: (deadlineMs, operationTimeoutMs) => rawEvaluate(`({
    href: location.href,
    readyState: document.readyState,
    hasTauriInvoke: typeof window.__TAURI_INTERNALS__?.invoke === 'function',
    rootHasChildren: Boolean(document.getElementById('root')?.childElementCount)
  })`, operationTimeoutMs, { deadlineMs }),
  publishProgress: reportProgress,
});

const has = (testid) =>
  evaluate(`Boolean(document.querySelector('[data-testid=${JSON.stringify(testid)}]'))`);

async function dismissFeatureTourIfPresent() {
  // The tour can mount after the shell is otherwise ready.  Check immediately
  // before each meaningful interaction so it cannot silently sit over a row.
  if (await has('feature-tour-skip')) {
    await pointerClick('feature-tour-skip');
    await waitFor('the onboarding tour to close', async () => !(await has('feature-tour-skip')));
  }
}

const clickableNamedTestId = (prefix, name) =>
  evaluate(`Array.from(document.querySelectorAll('[data-testid]')).find((el) => {
    const testid = el.getAttribute('data-testid') || '';
    const rect = el.getBoundingClientRect();
    return testid.startsWith(${JSON.stringify(prefix)}) &&
      (el.textContent || '').includes(${JSON.stringify(name)}) &&
      !el.matches(':disabled, [aria-disabled="true"]') &&
      rect.width > 0 && rect.height > 0;
  })?.getAttribute('data-testid') || null`);

async function waitForClickableNamedTestId(label, prefix, name) {
  let testid = null;
  await waitFor(label, async () => {
    testid = await clickableNamedTestId(prefix, name);
    return testid !== null;
  });
  return testid;
}

async function waitForVisibleApp({ openCreateMenu = false } = {}) {
  await waitForRendererCallback();
  await waitFor('the Clients navigation control', () => has('spine-nav-matters'));
  await dismissFeatureTourIfPresent();
  const clientRow = await waitForClickableNamedTestId(
    'the clickable Golden Loop client row in the visible Clients rail',
    'spine-client-row-',
    'Golden Loop Client',
  );
  await dismissFeatureTourIfPresent();
  await click(clientRow);
  await waitFor('the client Documents tab', () => has('crm-household-tab-documents'));
  await click('crm-household-tab-documents');
  if (openCreateMenu) {
    await waitFor('the Documents create menu', () => has('documents-files-create-menu'));
    await pointerClick('documents-files-create-menu');
    await waitFor('the Documents create control', () => has('documents-create-document'));
  }
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
  await waitForVisibleApp({ openCreateMenu: true });
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

const clientDocumentPath = () => `Golden Loop Client/${documentFile}`;

const crmDocumentRow = (documentPath) =>
  evaluate(`(() => {
    const section = document.querySelector('[data-testid="crm-household-documents"]');
    const row = section?.querySelector('[data-testid=${JSON.stringify(`crm-document-card-${documentPath}`)}]');
    if (!section || !row || !section.contains(row)) return null;
    const rect = row.getBoundingClientRect();
    const style = getComputedStyle(row);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
      ? row.getAttribute('data-testid')
      : null;
  })()`);

const crmDocumentRowIsActuallyClickable = (documentPath) =>
  evaluate(`(() => {
    const section = document.querySelector('[data-testid="crm-household-documents"]');
    const row = section?.querySelector('[data-testid=${JSON.stringify(`crm-document-card-${documentPath}`)}]');
    if (!section || !row || !section.contains(row)) return false;
    row.scrollIntoView({ block: 'center', inline: 'nearest' });
    const rect = row.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit === row || row.contains(hit);
  })()`);

const documentOpenedInEditor = (documentPath) =>
  evaluate(`(async () => {
    const module = await import('/src/platform/state/editorStore.ts');
    const state = module.useEditorStore.getState();
    return state.activeTabPath === ${JSON.stringify(documentPath)} &&
      state.openTabs.some((tab) => tab.path === ${JSON.stringify(documentPath)});
  })()`);

async function assertCrmDocumentVisibleAndOpens(where) {
  const documentPath = clientDocumentPath();
  const rowTestId = `crm-document-card-${documentPath}`;
  await waitFor(`${documentFile} CRM document row to be visible ${where}`, async () =>
    (await crmDocumentRow(documentPath)) === rowTestId);
  await dismissFeatureTourIfPresent();
  await waitFor(`${documentFile} CRM document row to be genuinely clickable ${where}`, () =>
    crmDocumentRowIsActuallyClickable(documentPath));
  await pointerClick(rowTestId);
  await waitFor(`${documentFile} to open in the normal Documents editor ${where}`, () =>
    documentOpenedInEditor(documentPath));
}

async function assertPresent(where) {
  await waitFor(`${documentFile} to be saved ${where}`, async () => {
    const files = await readdir(workspace, { recursive: true });
    return files.some((entry) => String(entry).endsWith(documentFile));
  }, 20_000);
  await assertCrmDocumentVisibleAndOpens(where);
}

async function withBound(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('bounded operation expired')), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runGoldenLoopDriver() {
  if (!['write', 'assert'].includes(phase) || !bridgePort || !workspace || !documentName) {
    throw new Error('usage: golden-loop-driver.mjs <write|assert> <bridge-port> <workspace> <document-name>');
  }
  try {
    // Establish and publish readiness once. All later calls use the independent
    // in-memory latch and return immediately, even without a progress file.
    await waitForRendererCallback();
    await reportProgress('later-driver');
    if (phase === 'write') {
      await prepareExplicitWorkspaceForGoldenLoop();
      await click('documents-create-document');
      await fillPromptAndConfirm();
      await assertPresent('immediately after saving');
      console.log(`PASS write: created and displayed ${documentFile}`);
    } else {
      // The restart half only verifies the saved row. Opening the modal Create
      // menu here would intentionally make the rest of the page non-hit-testable.
      await waitForVisibleApp();
      await assertPresent('after app restart');
      console.log(`PASS persistence: ${documentFile} survived restart and is visible`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/^golden loop bridge request timed out: endpoint=\/[a-z-]+ bound=\d+ms$/.test(message)) {
      console.error(`GOLDEN LOOP FAILURE: ${message}`);
    }
    const renderer = await rendererSnapshot();
    try {
      const diagnostic = await withBound(
        writeDiagnosticArtifact({ phase, renderer, events: renderer.events }),
        ARTIFACT_TIMEOUT_MS,
      );
      console.error(`GOLDEN LOOP DIAGNOSTIC: path=${diagnostic.path} sha256=${diagnostic.sha256} classification=${diagnostic.artifact.classification}`);
    } catch {
      console.error('GOLDEN LOOP DIAGNOSTIC FAILED');
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runGoldenLoopDriver();
}
