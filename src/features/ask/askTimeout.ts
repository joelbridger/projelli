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

/**
 * No token/progress for this long → give up honestly and offer a retry.
 *
 * This is the ceiling for a CLOUD send and for the BETWEEN-TOKEN gap on any
 * send (once tokens are streaming, silence really is a stall). The FIRST-token
 * wait on a LOCAL send is governed instead by a prompt-scaled budget — see
 * `computeAnswerFirstTokenBudgetMs` — because a local CPU prompt-eval can
 * legitimately take a minute or more before the first token appears.
 */
export const ASK_ANSWER_TIMEOUT_MS = 45_000;

/**
 * lp/localai-patience — assumed FLOOR prompt-eval rate for the embedded local
 * engine (lantern-local, llama.cpp on the CPU), in tokens/second. The Legion
 * autopsy measured a 4,574-token Ask prompt at ~70.5s of prompt-eval — a real
 * rate of ~65 tok/s. We deliberately assume a SLOWER 40 tok/s so the derived
 * budget clears the real eval time with headroom on slower/busier machines,
 * never killing a working local Ask.
 */
export const LOCAL_FIRST_TOKEN_EVAL_RATE_TOKENS_PER_SEC = 40;

/**
 * lp/localai-patience — hard ceiling on the local first-token budget (4 min).
 * Beyond this, even a huge prompt is treated as a genuinely wedged engine and
 * fails honestly with a retry, rather than spinning without bound.
 */
export const LOCAL_FIRST_TOKEN_BUDGET_CEILING_MS = 240_000;

/**
 * lp/localai-patience — how long to wait for the FIRST answer token before the
 * stall watchdog gives up honestly.
 *
 * The bug this fixes: the embedded local engine COMPLETED a real Ask in 81.7s
 * server-side (70.5s prompt-eval on a 4,574-token RAG prompt on a laptop CPU +
 * 11.2s generation, zero errors) — but the flat 45s no-first-token ceiling gave
 * up at 45s and reported a FALSE failure. The warm-up probe uses a tiny prompt,
 * so it passes; a real RAG prompt is two orders of magnitude more eval work.
 *
 * The fix: for the LOCAL provider ONLY, scale the first-token budget with the
 * prompt size:
 *
 *     budget = ASK_ANSWER_TIMEOUT_MS + (promptTokens / RATE) * 1000
 *
 * - base = ASK_ANSWER_TIMEOUT_MS (45s) covers model-load slack and a tiny
 *   prompt (which evals near-instantly, so a small local Ask behaves as before).
 * - RATE = LOCAL_FIRST_TOKEN_EVAL_RATE_TOKENS_PER_SEC (40 tok/s), the assumed
 *   slow floor. Worked example on the measured prompt: 4,574 tok → 45s +
 *   4,574/40·1s = 45s + 114.35s = 159.35s — >2× the measured 70.5s eval, so a
 *   working local Ask always clears the budget.
 * - capped at LOCAL_FIRST_TOKEN_BUDGET_CEILING_MS (4 min).
 *
 * Cloud providers are unaffected — they always get the base 45s, so the cloud
 * path is byte-for-byte unchanged.
 */
export function computeAnswerFirstTokenBudgetMs(opts: {
  isLocal: boolean;
  estimatedPromptTokens: number;
}): number {
  if (!opts.isLocal) return ASK_ANSWER_TIMEOUT_MS;
  const tokens = Math.max(0, opts.estimatedPromptTokens);
  const scaled =
    ASK_ANSWER_TIMEOUT_MS +
    Math.round((tokens / LOCAL_FIRST_TOKEN_EVAL_RATE_TOKENS_PER_SEC) * 1000);
  return Math.min(LOCAL_FIRST_TOKEN_BUDGET_CEILING_MS, scaled);
}

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

/**
 * lp/localai-patience — CALM waiting copy shown while the LOCAL engine is still
 * prompt-evaluating (reading the retrieved documents) before its first token.
 * This is the honest, expected state for a bigger question on-device: the CPU
 * reads the whole prompt token-by-token first, which can take a minute or two,
 * and the engine is working normally the whole time. It replaces the alarming
 * "taking longer than expected — may be downloading/loading" warning for this
 * case (that warning is for a genuine mid-stream stall, not normal eval), and it
 * never appears for a cloud send.
 */
export const ASK_LOCAL_AI_EVALUATING_MESSAGE =
  'The on-device AI is reading your documents — bigger questions take it a minute or two.';

/**
 * lp/localai-patience — which phase of the answer the stall watchdog is in when
 * it warns: `'first-token'` (no answer token has arrived yet — for a local send
 * this is normal prompt-eval) vs `'streaming'` (tokens were arriving and then
 * went silent — a genuine stall). The caller shows a calm waiting state for a
 * local `'first-token'` warning and the alarming warning otherwise.
 */
export type AnswerStallPhase = 'first-token' | 'streaming';

export interface AnswerStallWatchdog {
  /** Call on every chunk/progress signal — re-arms both timers from now. */
  markProgress: () => void;
  /** Stop the watchdog for good (call in a `finally` once the send settles). */
  cancel: () => void;
}

/**
 * Starts a two-stage silence watchdog: `onWarning` fires after `warningMs` of
 * no progress, `onTimeout` after the applicable timeout. Both re-arm on
 * `markProgress()`. `onTimeout` fires at most once and cancels the watchdog
 * itself afterward.
 *
 * lp/localai-patience — the timeout is phase-dependent: until the FIRST progress
 * signal, the (possibly large, prompt-scaled) `firstTokenTimeoutMs` applies,
 * because a local CPU prompt-eval can legitimately be silent for a minute or
 * more before the first token. Once any progress has arrived, the tight
 * `timeoutMs` governs the between-token gap (streaming silence really is a
 * stall). `onWarning` is told which phase it fired in so the caller can show a
 * calm "still reading your documents" state for a local first-token wait rather
 * than the alarming "taking longer than expected" copy. For a cloud send the
 * caller passes `firstTokenTimeoutMs === timeoutMs` (45s), so behaviour is
 * unchanged.
 */
export function createAnswerStallWatchdog(opts: {
  onWarning: (phase: AnswerStallPhase) => void;
  onTimeout: () => void;
  warningMs?: number;
  timeoutMs?: number;
  /** Budget for the FIRST progress signal. Defaults to `timeoutMs` (cloud). */
  firstTokenTimeoutMs?: number;
}): AnswerStallWatchdog {
  const warningMs = opts.warningMs ?? ASK_ANSWER_WARNING_MS;
  const timeoutMs = opts.timeoutMs ?? ASK_ANSWER_TIMEOUT_MS;
  const firstTokenTimeoutMs = opts.firstTokenTimeoutMs ?? timeoutMs;
  let warningTimer: ReturnType<typeof setTimeout> | undefined;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  // Once any progress (a token/chunk) has arrived, we leave the generous
  // first-token budget behind for the tight between-token ceiling.
  let progressed = false;

  const clearTimers = (): void => {
    if (warningTimer !== undefined) clearTimeout(warningTimer);
    if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
    warningTimer = undefined;
    timeoutTimer = undefined;
  };

  const arm = (): void => {
    clearTimers();
    if (stopped) return;
    const phase: AnswerStallPhase = progressed ? 'streaming' : 'first-token';
    const currentTimeoutMs = progressed ? timeoutMs : firstTokenTimeoutMs;
    warningTimer = setTimeout(() => {
      if (!stopped) opts.onWarning(phase);
    }, warningMs);
    timeoutTimer = setTimeout(() => {
      if (stopped) return;
      stopped = true;
      clearTimers();
      opts.onTimeout();
    }, currentTimeoutMs);
  };

  arm();

  return {
    markProgress: () => {
      progressed = true;
      arm();
    },
    cancel: () => {
      stopped = true;
      clearTimers();
    },
  };
}

/**
 * Fix 1b round 2 — the Rust-side sidecar state is guarded by a single mutex
 * that `local_llm_sidecar_start` holds for its ENTIRE up-to-120s health wait
 * (see `local_llm_sidecar_start` in `commands/local_llm/mod.rs`), and
 * `local_llm_sidecar_health` takes the SAME mutex to read state. So when a
 * boot/selection pre-start (`localAiPreStart.ts`) is already mid-warm-up, a
 * concurrent `checkHealth()` call QUEUES behind it instead of answering
 * quickly — awaiting it naively (as the round-1 fix did) would leave the user
 * on the generic "Answering…" spinner for the entire queued wait, exactly the
 * failure this function exists to prevent. This grace window is how long we
 * let the probe be silent before assuming it's blocked and showing "starting"
 * anyway; a normal, uncontended probe resolves in low tens of ms, so this
 * never flashes on the fast path.
 */
export const LOCAL_AI_HEALTH_PROBE_GRACE_MS = 1500;

/**
 * Fix 1b (demo readiness) — waits for the embedded llama-server sidecar to
 * become healthy BEFORE `createAnswerStallWatchdog` above is armed, for a
 * `lantern-local` send. The sidecar's own health wait can legitimately take
 * up to two minutes on a cold model load (`HEALTH_TIMEOUT_SECS` in
 * `llama_server.rs`) — far longer than the watchdog's `ASK_ANSWER_TIMEOUT_MS`
 * ceiling tolerates. Without this, the FIRST Local-only question after
 * switching modes (or right after launch, before the boot/selection
 * pre-start in `localAiPreStart.ts` has finished) could get killed by the
 * watchdog while the engine was still legitimately starting up, not stalled.
 *
 * A no-op for any provider other than `'lantern-local'`, AND a no-op off
 * desktop (`isDesktop` returns false) — a real llama-server sidecar only ever
 * exists in the desktop app, the exact same "off-Tauri = safe no-op" contract
 * `localLlmSidecarHealth()`/`isEmbeddedLocalModelReady()` already follow. This
 * matters because `providerId` alone is just a string: in the real send path
 * it's only ever `'lantern-local'` when `isEmbeddedLocalModelReady()` already
 * proved a genuine desktop engine exists, but a test double (or the browser
 * demo, hypothetically) can carry that id without one, and must not reach for
 * a sidecar that was never there.
 *
 * `checkHealth` races against `LOCAL_AI_HEALTH_PROBE_GRACE_MS`: if it hasn't
 * answered by then (queued behind another in-flight warm-up's mutex hold —
 * see the constant's doc comment — or just a genuinely slow probe), we show
 * "starting" WHILE STILL WAITING for the real answer, then either clear it
 * (already healthy — no redundant `startSidecar` call) or fall through to
 * starting it ourselves. On the common fast path (already warm, or a
 * never-started sidecar answering near-instantly) `onStarting` is called
 * zero times, so the "Local AI is starting…" state never flashes when
 * nothing is actually starting. `checkHealth` errors are treated as "not
 * healthy yet" rather than propagated, since the real signal of success/
 * failure is whether `startSidecar` itself succeeds.
 */
export async function waitForLocalAiSidecarReady(opts: {
  providerId: string;
  checkHealth: () => Promise<boolean>;
  startSidecar: () => Promise<string>;
  onStarting: (starting: boolean) => void;
  /** Defaults to the real desktop check (`isTauri` from `@tauri-apps/api/core`). */
  isDesktop?: () => boolean;
}): Promise<void> {
  if (opts.providerId !== 'lantern-local') return;
  if (!(opts.isDesktop ?? isTauri)()) return;

  // Plain `let`s mutated inside the `probe` closure below would get
  // over-narrowed by TS's control-flow analysis at the read sites further
  // down (it can't see the closure's mutation across the `await
  // Promise.race(...)` boundary) — an object property read isn't narrowed
  // the same way, so this state lives in one.
  const state: { healthy: boolean; settled: boolean } = { healthy: false, settled: false };
  const probe = (async () => {
    try {
      state.healthy = await opts.checkHealth();
    } catch {
      state.healthy = false;
    } finally {
      state.settled = true;
    }
  })();

  let signaledStarting = false;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  const grace = new Promise<void>((resolve) => {
    graceTimer = setTimeout(resolve, LOCAL_AI_HEALTH_PROBE_GRACE_MS);
  });
  try {
    await Promise.race([probe, grace]);
  } finally {
    if (graceTimer !== undefined) clearTimeout(graceTimer);
  }
  if (!state.settled) {
    // The probe is still pending past the grace window — either genuinely
    // slow, or queued behind another in-flight warm-up's mutex hold. Either
    // way, the user must see SOMETHING now, not silence until it resolves.
    signaledStarting = true;
    opts.onStarting(true);
    await probe;
  }

  if (state.healthy) {
    if (signaledStarting) opts.onStarting(false);
    return;
  }

  if (!signaledStarting) opts.onStarting(true);
  try {
    await opts.startSidecar();
  } finally {
    opts.onStarting(false);
  }
}
