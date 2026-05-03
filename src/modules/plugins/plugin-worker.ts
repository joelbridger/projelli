// Plugin runner — worker entry point.
//
// Mounts a `PluginRuntime` against the worker's global scope, then sets up
// catch-all handlers for uncaught synchronous errors and unhandled promise
// rejections. Both surface as structured `error` messages so the main-thread
// bridge sees the failure instead of the worker dying silently.
//
// Loaded via Vite's `?worker` import:
//   import PluginWorker from './plugin-worker.ts?worker';
//   const worker = new PluginWorker();
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.5

import { encode, type PluginErrorPayload, type PluginMessage } from './PluginMessageProtocol';
import { PluginRuntime } from './PluginRuntime';

// `self` here is the DedicatedWorkerGlobalScope. Cast through unknown so we
// don't need the WebWorker lib in tsconfig globally; this file only ever
// runs inside an actual worker context.
const scope = self as unknown as {
  postMessage(data: unknown): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  onerror: ((event: ErrorEvent) => void) | null;
  onunhandledrejection: ((event: PromiseRejectionEvent) => void) | null;
};

let nextErrorId = 1;
function postError(error: PluginErrorPayload): void {
  const id = `w-${String(nextErrorId)}`;
  nextErrorId += 1;
  const msg: PluginMessage = {
    id,
    type: 'error',
    error,
  };
  try {
    scope.postMessage(encode(msg));
  } catch {
    // If we can't even post, the host is already gone; nothing to do.
  }
}

scope.onerror = (event: ErrorEvent): void => {
  postError({
    code: 'plugin-threw',
    message: event.message || 'uncaught error in plugin worker',
  });
};

scope.onunhandledrejection = (event: PromiseRejectionEvent): void => {
  // Cast to a defensive view: PromiseRejectionEvent.reason is `any` and we
  // want to extract message/stack only when present.
  const reason = event.reason as { message?: unknown; stack?: unknown } | null | undefined;
  const error: PluginErrorPayload = {
    code: 'plugin-threw',
    message: typeof reason?.message === 'string' ? reason.message : 'unhandled rejection in plugin worker',
  };
  if (typeof reason?.stack === 'string') error.stack = reason.stack;
  postError(error);
};

new PluginRuntime({
  scope: scope as unknown as ConstructorParameters<typeof PluginRuntime>[0]['scope'],
});
