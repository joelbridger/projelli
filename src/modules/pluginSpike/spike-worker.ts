// Plugin Spike — worker entry point.
//
// Mounts a SpikePluginRuntime against the worker's global scope, then sets up
// catch-all handlers for uncaught synchronous errors and unhandled promise
// rejections. Both surface as structured `error` messages so the main-thread
// bridge can surface them to the harness instead of the worker dying silently.
//
// Loaded via Vite's `?worker` import: `import SpikeWorker from './spike-worker.ts?worker'`.
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.3

import type { SpikeError, SpikeMessage } from '@/types/pluginSpike';

import { encode } from './SpikeMessageProtocol';
import { SpikePluginRuntime } from './SpikePluginRuntime';

// `self` here is the DedicatedWorkerGlobalScope. Cast through unknown so we
// don't need the WebWorker lib in tsconfig globally; the spike-worker file
// only runs inside an actual worker.
const scope = self as unknown as {
  postMessage(data: unknown): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  onerror: ((event: ErrorEvent) => void) | null;
  onunhandledrejection: ((event: PromiseRejectionEvent) => void) | null;
};

let nextErrorId = 1;
function postError(error: SpikeError): void {
  const msg: SpikeMessage = {
    id: `w-${nextErrorId++}`,
    type: 'error',
    error,
  };
  try {
    scope.postMessage(encode(msg));
  } catch {
    // If we can't even post, there's nothing else to do; main-thread will
    // observe via its own error listener.
  }
}

scope.onerror = (event: ErrorEvent): void => {
  postError({
    code: 'plugin-threw',
    message: event.message || 'uncaught error in plugin worker',
  });
};

scope.onunhandledrejection = (event: PromiseRejectionEvent): void => {
  const reason = event.reason as { message?: string; stack?: string } | undefined;
  const error: SpikeError = {
    code: 'plugin-threw',
    message: reason?.message ?? 'unhandled rejection in plugin worker',
  };
  if (reason?.stack) error.stack = reason.stack;
  postError(error);
};

new SpikePluginRuntime({
  scope: scope as unknown as ConstructorParameters<typeof SpikePluginRuntime>[0]['scope'],
});
