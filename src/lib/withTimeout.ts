/**
 * Wrap a promise so it can never hang the UI forever.
 *
 * Background (BUG-002): on Windows the create-new-workspace step could leave the
 * first-run screen silently frozen — buttons greyed forever — when an
 * underlying native (Tauri IPC) call never settled. A try/catch/finally only
 * recovers if the awaited promise eventually resolves or rejects; a promise
 * that never settles defeats it. This helper bounds such calls: if the work
 * has not settled within `ms`, the returned promise rejects with a clear,
 * plain-language message so the caller's normal error handling runs (clears the
 * loading state, shows the error) instead of spinning forever.
 *
 * Do NOT wrap user-interactive steps (e.g. a native folder picker the user may
 * sit on for a while) — only the non-interactive work that should complete
 * quickly.
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(message));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}
