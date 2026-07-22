import { createHash, randomBytes } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const MAX_ITEMS = 20;
const SAFE_PHASES = new Set([
  'preflight', 'product-gate-build', 'product-gate-provenance',
  'diagnostic-writer-validation', 'directory-creation', 'port-selection', 'pid-read',
  'vite-startup', 'launcher', 'bridge-health', 'app-exit', 'driver-startup', 'renderer-dispatch', 'write', 'restart', 'assert',
]);
const SAFE_TAGS = new Set(['a', 'button', 'div', 'form', 'input', 'main', 'nav', 'section']);
const SAFE_LOCATION_CLASSES = new Set(['root', 'app-module', 'vite-runtime', 'other', 'unavailable']);
const EVENT_CATEGORIES = {
  pageErrors: new Set(['module-import', 'syntax-error', 'reference-error', 'type-error', 'javascript-error']),
  consoleErrors: new Set(['console-error']),
  unhandledRejections: new Set(['unhandled-rejection']),
  resourceFailures: new Set(['resource-load-failure']),
  networkFailures: new Set(['fetch-rejected', 'http-response-failure']),
};

const boundedList = (value, map) => Array.isArray(value) ? value.slice(0, MAX_ITEMS).map(map) : [];
const safeBoolean = (value) => Boolean(value);
const safeReadyState = (value) => ['loading', 'interactive', 'complete'].includes(value) ? value : 'unknown';
const safePhase = (value) => SAFE_PHASES.has(value) ? value : 'preflight';

export function safeLocationFacts(value, pageValue) {
  try {
    const page = new URL(String(pageValue));
    const url = new URL(String(value), page);
    let locationClass = 'other';
    if (url.pathname === '/' || url.pathname === '/index.html') locationClass = 'root';
    else if (url.pathname.startsWith('/src/')) locationClass = 'app-module';
    else if (url.pathname.startsWith('/@vite/')) locationClass = 'vite-runtime';
    return { sameOrigin: url.origin === page.origin, locationClass };
  } catch {
    return { sameOrigin: false, locationClass: 'unavailable' };
  }
}

const safeLocation = (value, pageValue) => {
  if (typeof value?.sameOrigin === 'boolean' && SAFE_LOCATION_CLASSES.has(value?.locationClass)) {
    return { sameOrigin: value.sameOrigin, locationClass: value.locationClass };
  }
  return safeLocationFacts(value?.location, pageValue);
};
const safeEvent = (value, field, fallback, pageValue) => ({
  category: EVENT_CATEGORIES[field].has(value?.category) ? value.category : fallback,
  ...safeLocation(value, pageValue),
  ...(Number.isInteger(value?.status) && value.status >= 400 && value.status <= 599 ? { status: value.status } : {}),
});

export function classifyDiagnostic(events = {}, renderer = {}, phase = 'preflight') {
  if (safePhase(phase) === 'preflight') return 'runner-preflight-failure';
  if (safePhase(phase) === 'product-gate-build') return 'product-gate-build-failure';
  if (safePhase(phase) === 'product-gate-provenance') return 'product-gate-provenance-failure';
  if (safePhase(phase) === 'diagnostic-writer-validation') return 'diagnostic-writer-validation-failure';
  if (safePhase(phase) === 'directory-creation') return 'directory-creation-failure';
  if (safePhase(phase) === 'port-selection') return 'port-selection-failure';
  if (safePhase(phase) === 'pid-read') return 'pid-read-failure';
  if (safePhase(phase) === 'vite-startup') return 'vite-startup-failure';
  if (safePhase(phase) === 'launcher') return 'launcher-failure';
  if (safePhase(phase) === 'bridge-health') return 'bridge-health-failure';
  if (safePhase(phase) === 'app-exit') return 'app-exit-failure';
  if (safePhase(phase) === 'driver-startup') return 'driver-startup-failure';
  if (safePhase(phase) === 'renderer-dispatch') return 'renderer-dispatch-timeout';
  if (safePhase(phase) === 'restart') return 'restart-failure';
  if (boundedList(events.pageErrors, (entry) => entry).some((entry) => entry?.category === 'module-import')) return 'javascript-module-import-error';
  if (Array.isArray(events.pageErrors) && events.pageErrors.length) return 'javascript-error';
  if (Array.isArray(events.unhandledRejections) && events.unhandledRejections.length) return 'unhandled-rejection';
  if (Array.isArray(events.consoleErrors) && events.consoleErrors.length) return 'console-error';
  if ((Array.isArray(events.resourceFailures) && events.resourceFailures.length) || (Array.isArray(events.networkFailures) && events.networkFailures.length)) return 'network-or-module-request-failure';
  if (renderer.rootPresent && !renderer.rootHasChildren) return 'react-mount-did-not-run';
  return 'native-webview-vite-xvfb-blank-renderer';
}

export function safeArtifact(input = {}) {
  const events = input.events && typeof input.events === 'object' ? input.events : {};
  const rendererInput = input.renderer && typeof input.renderer === 'object' ? input.renderer : {};
  const rendererAvailable = ['url', 'href', 'sameOrigin', 'readyState', 'hasTauriInvoke', 'explicitWorkspace', 'testIdCount', 'dom', 'rootPresent', 'rootHasChildren']
    .some((field) => Object.hasOwn(rendererInput, field));
  const rendererLocation = typeof rendererInput.sameOrigin === 'boolean' && SAFE_LOCATION_CLASSES.has(rendererInput.locationClass)
    ? { sameOrigin: rendererInput.sameOrigin, locationClass: rendererInput.locationClass }
    : safeLocationFacts(rendererInput.url ?? rendererInput.href, rendererInput.pageUrl ?? rendererInput.url ?? rendererInput.href);
  const renderer = rendererAvailable ? {
    available: true,
    ...rendererLocation,
    readyState: safeReadyState(rendererInput.readyState),
    hasTauriInvoke: safeBoolean(rendererInput.hasTauriInvoke),
    explicitWorkspaceConfigured: safeBoolean(rendererInput.explicitWorkspace),
    testIdCount: Math.min(Math.max(Number(rendererInput.testIdCount) || 0, 0), 100),
    dom: {
      elementCount: Math.min(Math.max(Number(rendererInput.dom?.elementCount) || 0, 0), 500),
      tags: boundedList(rendererInput.dom?.tags, (tag) => SAFE_TAGS.has(tag) ? tag : 'other').slice(0, 8),
    },
    rootPresent: safeBoolean(rendererInput.rootPresent),
    rootHasChildren: safeBoolean(rendererInput.rootHasChildren),
  } : { available: false, locationClass: 'unavailable' };
  const sanitizedEvents = {
    pageErrors: boundedList(events.pageErrors, (entry) => safeEvent(entry, 'pageErrors', 'javascript-error', rendererInput.url ?? rendererInput.href)),
    consoleErrors: boundedList(events.consoleErrors, (entry) => safeEvent(entry, 'consoleErrors', 'console-error', rendererInput.url ?? rendererInput.href)),
    unhandledRejections: boundedList(events.unhandledRejections, (entry) => safeEvent(entry, 'unhandledRejections', 'unhandled-rejection', rendererInput.url ?? rendererInput.href)),
    resourceFailures: boundedList(events.resourceFailures, (entry) => safeEvent(entry, 'resourceFailures', 'resource-load-failure', rendererInput.url ?? rendererInput.href)),
    networkFailures: boundedList(events.networkFailures, (entry) => safeEvent(entry, 'networkFailures', 'fetch-rejected', rendererInput.url ?? rendererInput.href)),
  };
  const phase = safePhase(input.phase);
  return {
    schema: 2,
    kind: 'golden-loop-renderer-diagnostic',
    capturedAt: new Date().toISOString(),
    phase,
    classification: classifyDiagnostic(sanitizedEvents, renderer, phase),
    renderer,
    events: sanitizedEvents,
  };
}

export async function writeDiagnosticArtifact(input, directory = process.env.GOLDEN_LOOP_DIAGNOSTIC_DIR || path.join(os.tmpdir(), 'lantern-golden-loop-diagnostics')) {
  const artifact = safeArtifact(input);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const target = path.join(directory, `golden-loop-${Date.now()}-${process.pid}-${randomBytes(6).toString('hex')}.json`);
  const encoded = `${JSON.stringify(artifact, null, 2)}\n`;
  await writeFile(target, encoded, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return { path: target, sha256: createHash('sha256').update(encoded).digest('hex'), artifact };
}

export const EARLY_CAPTURE_MARKER = '__LANTERN_GOLDEN_LOOP_DIAGNOSTICS__';
