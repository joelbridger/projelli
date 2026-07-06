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

import { isTauri } from '@tauri-apps/api/core';

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

/**
 * QA-7 — the answer/generation stage had NO equivalent of the retrieval
 * watchdog above: once retrieval cleared, a stalled provider call (most often
 * the embedded local model still mid-download/load) left the "Answering…"
 * spinner spinning forever with no feedback and no way out. This is the
 * generation-side counterpart: unlike retrieval (a single opaque promise),
 * a streaming answer delivers incremental progress via `onChunk`, so a stall
 * is "no chunk arrived recently", not "the whole call hasn't settled yet" — a
 * legitimately long but progressing answer must never be killed just because
 * its TOTAL duration crosses a threshold. `markProgress()` re-arms both timers
 * on every chunk, so only genuine silence trips either one.
 */

/**
 * Fix 1b (demo readiness) — shown INSTEAD of the plain "Answering…" spinner
 * while a Local-only send is waiting for the embedded llama-server sidecar to
 * become healthy (before the watchdog below is even armed — a cold model
 * load can legitimately take up to two minutes, so this is an honest,
 * expected wait, not a stall).
 */
export const ASK_LOCAL_AI_STARTING_MESSAGE = 'Local AI is starting…';

/** No token/progress for this long → show "taking longer than expected". */
export const ASK_ANSWER_WARNING_MS = 12_000;

/** No token/progress for this long → give up honestly and offer a retry. */
export const ASK_ANSWER_TIMEOUT_MS = 45_000;

/**
 * Warning copy shown in the "Answering…" spinner once ASK_ANSWER_WARNING_MS
 * has passed with no token. Names the most common real cause (the embedded
 * local model still downloading/loading) without asserting it — the message
 * reads fine for a cloud stall too.
 */
export const ASK_ANSWER_STALL_WARNING =
  'This is taking longer than expected — the local model may still be downloading or loading.';

/** Honest failure copy after ASK_ANSWER_TIMEOUT_MS of total silence. */
export const ASK_ANSWER_STALL_ERROR_MESSAGE =
  "Advisor Prep Hero couldn't get an answer — it may still be downloading or loading the local model. Check its status, then try again.";

export interface AnswerStallWatchdog {
  /** Call on every chunk/progress signal — re-arms both timers from now. */
  markProgress: () => void;
  /** Stop the watchdog for good (call in a `finally` once the send settles). */
  cancel: () => void;
}

/**
 * Starts a two-stage silence watchdog: `onWarning` fires after `warningMs` of
 * no progress, `onTimeout` after `timeoutMs`. Both re-arm on `markProgress()`.
 * `onTimeout` fires at most once and cancels the watchdog itself afterward.
 */
export function createAnswerStallWatchdog(opts: {
  onWarning: () => void;
  onTimeout: () => void;
  warningMs?: number;
  timeoutMs?: number;
}): AnswerStallWatchdog {
  const warningMs = opts.warningMs ?? ASK_ANSWER_WARNING_MS;
  const timeoutMs = opts.timeoutMs ?? ASK_ANSWER_TIMEOUT_MS;
  let warningTimer: ReturnType<typeof setTimeout> | undefined;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const clearTimers = (): void => {
    if (warningTimer !== undefined) clearTimeout(warningTimer);
    if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
    warningTimer = undefined;
    timeoutTimer = undefined;
  };

  const arm = (): void => {
    clearTimers();
    if (stopped) return;
    warningTimer = setTimeout(() => {
      if (!stopped) opts.onWarning();
    }, warningMs);
    timeoutTimer = setTimeout(() => {
      if (stopped) return;
      stopped = true;
      clearTimers();
      opts.onTimeout();
    }, timeoutMs);
  };

  arm();

  return {
    markProgress: arm,
    cancel: () => {
      stopped = true;
      clearTimers();
    },
  };
}

/**
 * Fix 1b (demo readiness) — waits for the embedded llama-server sidecar to
 * become healthy BEFORE `createAnswerStallWatchdog` above is armed, for a
 * `keepance-local` send. The sidecar's own health wait can legitimately take
 * up to two minutes on a cold model load (`HEALTH_TIMEOUT_SECS` in
 * `llama_server.rs`) — far longer than the watchdog's `ASK_ANSWER_TIMEOUT_MS`
 * ceiling tolerates. Without this, the FIRST Local-only question after
 * switching modes (or right after launch, before the boot/selection
 * pre-start in `localAiPreStart.ts` has finished) could get killed by the
 * watchdog while the engine was still legitimately starting up, not stalled.
 *
 * A no-op for any provider other than `'keepance-local'`, AND a no-op off
 * desktop (`isDesktop` returns false) — a real llama-server sidecar only ever
 * exists in the desktop app, the exact same "off-Tauri = safe no-op" contract
 * `localLlmSidecarHealth()`/`isEmbeddedLocalModelReady()` already follow. This
 * matters because `providerId` alone is just a string: in the real send path
 * it's only ever `'keepance-local'` when `isEmbeddedLocalModelReady()` already
 * proved a genuine desktop engine exists, but a test double (or the browser
 * demo, hypothetically) can carry that id without one, and must not reach for
 * a sidecar that was never there.
 *
 * `checkHealth` is a quick, bounded probe (~2s) — the common case (sidecar
 * already warm from a prior question or the pre-start) calls `onStarting`
 * zero times, so the "Local AI is starting…" state never flashes when nothing
 * is actually starting. `checkHealth` errors are treated as "not healthy yet"
 * rather than propagated, since the real signal of success/failure is whether
 * `startSidecar` itself succeeds.
 */
export async function waitForLocalAiSidecarReady(opts: {
  providerId: string;
  checkHealth: () => Promise<boolean>;
  startSidecar: () => Promise<string>;
  onStarting: (starting: boolean) => void;
  /** Defaults to the real desktop check (`isTauri` from `@tauri-apps/api/core`). */
  isDesktop?: () => boolean;
}): Promise<void> {
  if (opts.providerId !== 'keepance-local') return;
  if (!(opts.isDesktop ?? isTauri)()) return;

  let healthy = false;
  try {
    healthy = await opts.checkHealth();
  } catch {
    healthy = false;
  }
  if (healthy) return;

  opts.onStarting(true);
  try {
    await opts.startSidecar();
  } finally {
    opts.onStarting(false);
  }
}
