/**
 * withTimeout — race a promise against a deadline so a hung backend call
 * (keychain, Tauri IPC, network fetch) can never leave the UI stuck on a
 * spinner forever. Always rejects with a TimeoutError (never resolves
 * silently), so callers get a clear, user-surfaceable message.
 *
 * When the underlying work supports real cancellation, pass `controller` —
 * it's aborted as soon as the deadline fires, so the in-flight work actually
 * stops instead of finishing unobserved in the background.
 */

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${String(Math.round(ms / 1000))}s`);
    this.name = 'TimeoutError';
  }
}

export interface WithTimeoutOptions {
  /** Aborted when the deadline fires, for calls that support cancellation. */
  controller?: AbortController;
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  options?: WithTimeoutOptions,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      options?.controller?.abort();
      reject(new TimeoutError(label, ms));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}
