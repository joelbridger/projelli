import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const MAX_TEXT = 1_000;
const MAX_ITEMS = 20;
const MAX_DOM = 4_000;

const text = (value, limit = MAX_TEXT) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, limit);
const list = (value) => Array.isArray(value) ? value.slice(0, MAX_ITEMS).map((entry) => text(entry)) : [];

export function classifyDiagnostic(events = {}) {
  const pageErrors = list(events.pageErrors);
  if (pageErrors.some((message) => /module|import/i.test(message))) return 'javascript-module-import-error';
  if (pageErrors.length) return 'javascript-error';
  if (list(events.unhandledRejections).length) return 'unhandled-rejection';
  if (list(events.consoleErrors).length) return 'console-error';
  if (list(events.resourceFailures).length || list(events.networkFailures).length) return 'network-or-module-request-failure';
  if (events.rootPresent && !events.rootHasChildren) return 'react-mount-did-not-run';
  return 'native-webview-vite-xvfb-blank-renderer';
}

export function safeArtifact(input) {
  const events = input.events && typeof input.events === 'object' ? input.events : {};
  return {
    schema: 1,
    kind: 'golden-loop-renderer-diagnostic',
    capturedAt: new Date().toISOString(),
    phase: text(input.phase, 32),
    failure: text(input.failure),
    classification: classifyDiagnostic(events),
    renderer: {
      url: text(input.renderer?.url, 2_000),
      readyState: text(input.renderer?.readyState, 32),
      hasTauriInvoke: Boolean(input.renderer?.hasTauriInvoke),
      explicitWorkspaceConfigured: Boolean(input.renderer?.explicitWorkspace),
      testids: list(input.renderer?.testids),
      dom: text(input.renderer?.dom, MAX_DOM),
      rootPresent: Boolean(input.renderer?.rootPresent),
      rootHasChildren: Boolean(input.renderer?.rootHasChildren),
    },
    events: {
      pageErrors: list(events.pageErrors),
      consoleErrors: list(events.consoleErrors),
      unhandledRejections: list(events.unhandledRejections),
      resourceFailures: list(events.resourceFailures),
      networkFailures: list(events.networkFailures),
    },
  };
}

export async function writeDiagnosticArtifact(input, directory = process.env.GOLDEN_LOOP_DIAGNOSTIC_DIR || path.join(os.tmpdir(), 'lantern-golden-loop-diagnostics')) {
  const artifact = safeArtifact(input);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const name = `golden-loop-${Date.now()}-${process.pid}.json`;
  const target = path.join(directory, name);
  const encoded = `${JSON.stringify(artifact, null, 2)}\n`;
  await writeFile(target, encoded, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return { path: target, sha256: createHash('sha256').update(encoded).digest('hex'), artifact };
}

export const EARLY_CAPTURE_MARKER = '__LANTERN_GOLDEN_LOOP_DIAGNOSTICS__';
