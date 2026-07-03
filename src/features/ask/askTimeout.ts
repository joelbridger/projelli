/**
 * Hard timeouts for the Ask pipeline.
 *
 * fix/ask-list-hang: on a large workspace (~2,500 files / ~40 client folders) the
 * LOCAL vector retrieval behind an Ask question (`MemoryService.retrieve` →
 * LanceDB) could stall indefinitely — the frontend `await` at the retrieval step
 * never settled, so the "Answering…" spinner span forever with no error, no
 * network call, and no way for the advisor to recover except killing the app.
 * This reproduced whether file-access consent was granted or denied, because the
 * retrieval runs unconditionally (consent only gates whether the hits are
 * INJECTED into the cloud prompt, not whether the search runs).
 *
 * The robust, standalone defence is to bound the context-gather step: if it
 * cannot complete within a generous cutoff, fail HONESTLY with a retry message
 * (the existing `failedStage === 'retrieval'` refusal copy) instead of hanging.
 * This does not depend on fixing the underlying LanceDB contention — an Ask that
 * genuinely can't search in time always ends in an honest, retryable failure.
 */

/**
 * Retrieval is a LOCAL vector search that normally returns in well under a
 * second; even a large, cold index is a few seconds. 30s is ~10–30× headroom,
 * so hitting it means the search genuinely stalled — never a slow-but-working
 * one — which keeps false timeouts effectively impossible while still capping
 * the infinite hang.
 */
export const ASK_RETRIEVAL_TIMEOUT_MS = 30_000;

/**
 * Thrown when an Ask pipeline stage exceeds its hard timeout. Carries the stage
 * so the caller can route to the right honest-failure copy (retrieval →
 * "couldn't search your files yet", etc.).
 */
export class AskTimeoutError extends Error {
  readonly stage: string;

  constructor(stage: string, ms: number) {
    super(`Ask ${stage} stage timed out after ${String(ms)}ms`);
    this.name = 'AskTimeoutError';
    this.stage = stage;
  }
}

/** True for an AskTimeoutError, including one that crossed a serialization/bundle
 *  boundary (matched by name), so callers never rely on `instanceof` alone. */
export function isAskTimeoutError(err: unknown): err is AskTimeoutError {
  return (
    err instanceof AskTimeoutError ||
    (err instanceof Error && err.name === 'AskTimeoutError')
  );
}

/**
 * Race `promise` against a hard timeout. If it does not settle within `ms`,
 * reject with `AskTimeoutError(stage)` so the caller's existing error handling
 * turns the stall into an honest, retryable failure.
 *
 * The timer is ALWAYS cleared in a `finally`, so a promise that settles in time
 * never leaves a dangling timeout (which would otherwise keep the event loop
 * alive and, under fake timers in tests, fire spuriously later).
 *
 * Note: we intentionally do NOT abort the underlying work here. In the Ask
 * pipeline the shared AbortController's "aborted" state means "the user moved
 * on — drop this silently"; aborting it on timeout would make the honest error
 * be swallowed. The stalled promise is simply orphaned (its eventual result is
 * ignored), which is safe for a read-only retrieval.
 */
export async function withAskTimeout<T>(
  promise: Promise<T>,
  ms: number,
  stage: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new AskTimeoutError(stage, ms));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
