export const DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS = 120_000;

interface AbortSignalWithReason {
  readonly reason?: unknown;
}

function readAbortReason(signal?: AbortSignal): unknown {
  return signal ? (signal as AbortSignalWithReason).reason : undefined;
}

function formatAbortReason(reason: unknown): string {
  if (typeof reason === 'string') return reason;
  if (
    typeof reason === 'number' ||
    typeof reason === 'boolean' ||
    typeof reason === 'bigint'
  ) {
    return String(reason);
  }
  if (typeof reason === 'object' && reason !== null && 'message' in reason) {
    const message = (reason as { message?: unknown }).message;
    return typeof message === 'string' ? message : 'Aborted';
  }
  return 'Aborted';
}

export function getAbortReason(signal?: AbortSignal): Error {
  const reason = readAbortReason(signal);
  if (reason instanceof Error) return reason;
  if (reason !== undefined) {
    const error = new Error(formatAbortReason(reason));
    error.name = 'AbortError';
    return error;
  }
  return new DOMException('Aborted', 'AbortError');
}

export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (typeof error === 'object' && error !== null && 'name' in error) {
    return String((error as { name?: unknown }).name) === 'AbortError';
  }
  return false;
}

export function isTimeoutError(error: unknown, signal?: AbortSignal): boolean {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    if (String((error as { name?: unknown }).name) === 'TimeoutError') return true;
  }
  const reason = readAbortReason(signal);
  return typeof reason === 'object' &&
    reason !== null &&
    'name' in reason &&
    String((reason as { name?: unknown }).name) === 'TimeoutError';
}

export function makeTimeoutError(timeoutMs: number): Error {
  const error = new Error(`Provider request timed out after ${String(timeoutMs)}ms`);
  error.name = 'TimeoutError';
  return error;
}

export function composeRequestSignal(
  callerSignal?: AbortSignal,
  timeoutMs: number = DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const abortFromCaller = () => {
    if (!controller.signal.aborted) {
      controller.abort(getAbortReason(callerSignal));
    }
  };

  if (callerSignal?.aborted) {
    abortFromCaller();
  } else {
    callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  }

  if (timeoutMs > 0 && !controller.signal.aborted) {
    timeoutId = setTimeout(() => {
      if (!controller.signal.aborted) {
        controller.abort(makeTimeoutError(timeoutMs));
      }
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      callerSignal?.removeEventListener('abort', abortFromCaller);
    },
  };
}

export function abortAwareSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(getAbortReason(signal));
  }

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeoutId);
      reject(getAbortReason(signal));
    };
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
