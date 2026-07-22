import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const MAX_ITEMS = 20;
const SAFE_PHASES = new Set(['preflight', 'vite-startup', 'launcher', 'bridge-health', 'app-exit', 'write', 'restart', 'assert']);
const SAFE_TAGS = new Set(['a', 'button', 'div', 'form', 'input', 'main', 'nav', 'section']);

const boundedList = (value, map) => Array.isArray(value) ? value.slice(0, MAX_ITEMS).map(map) : [];
const safeBoolean = (value) => Boolean(value);
const safeReadyState = (value) => ['loading', 'interactive', 'complete'].includes(value) ? value : 'unknown';
const safePhase = (value) => SAFE_PHASES.has(value) ? value : 'preflight';

// Paths are evidence only when they are known application/module paths. Every
// other path is deliberately replaced, so a route can never become a data leak.
export function safeUrl(value) {
  try {
    const url = new URL(String(value));
    const pathname = url.pathname === '/' || url.pathname === '/index.html' ||
      url.pathname.startsWith('/src/') || url.pathname.startsWith('/@vite/')
      ? url.pathname : '/[redacted]';
    return `${url.origin}${pathname}`;
  } catch {
    return 'unavailable';
  }
}

const safeLocation = (value) => ({ location: safeUrl(value) });
const safeEvent = (value, fallback) => ({
  category: typeof value?.category === 'string' && /^[a-z-]{1,48}$/.test(value.category)
    ? value.category : fallback,
  ...safeLocation(value?.location),
  ...(Number.isInteger(value?.status) && value.status >= 400 && value.status <= 599 ? { status: value.status } : {}),
});

export function classifyDiagnostic(events = {}, renderer = {}, phase = 'preflight') {
  if (safePhase(phase) === 'preflight') return 'runner-preflight-failure';
  if (safePhase(phase) === 'vite-startup') return 'vite-startup-failure';
  if (safePhase(phase) === 'launcher') return 'launcher-failure';
  if (safePhase(phase) === 'bridge-health') return 'bridge-health-failure';
  if (safePhase(phase) === 'app-exit') return 'app-exit-failure';
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
  const renderer = {
    url: safeUrl(rendererInput.url ?? rendererInput.href),
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
  };
  const sanitizedEvents = {
    pageErrors: boundedList(events.pageErrors, (entry) => safeEvent(entry, 'javascript-error')),
    consoleErrors: boundedList(events.consoleErrors, (entry) => safeEvent(entry, 'console-error')),
    unhandledRejections: boundedList(events.unhandledRejections, (entry) => safeEvent(entry, 'unhandled-rejection')),
    resourceFailures: boundedList(events.resourceFailures, (entry) => safeEvent(entry, 'resource-load-failure')),
    networkFailures: boundedList(events.networkFailures, (entry) => safeEvent(entry, 'fetch-rejected')),
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
  const target = path.join(directory, `golden-loop-${Date.now()}-${process.pid}-${randomBytes(6).toString('hex')}.json`);
  const encoded = `${JSON.stringify(artifact, null, 2)}\n`;
  await writeFile(target, encoded, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return { path: target, sha256: createHash('sha256').update(encoded).digest('hex'), artifact };
}

export const EARLY_CAPTURE_MARKER = '__LANTERN_GOLDEN_LOOP_DIAGNOSTICS__';
