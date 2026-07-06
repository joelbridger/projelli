import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AskTimeoutError,
  isAskTimeoutError,
  withAskTimeout,
  createAnswerStallWatchdog,
  waitForLocalAiSidecarReady,
  computeAnswerFirstTokenBudgetMs,
  LOCAL_AI_HEALTH_PROBE_GRACE_MS,
  LOCAL_FIRST_TOKEN_EVAL_RATE_TOKENS_PER_SEC,
  LOCAL_FIRST_TOKEN_BUDGET_CEILING_MS,
  ASK_ANSWER_WARNING_MS,
  ASK_ANSWER_TIMEOUT_MS,
} from './askTimeout';

/**
 * lp/localai-patience — the embedded local engine runs prompt-eval on the CPU:
 * a big RAG prompt is evaluated token-by-token before the FIRST answer token
 * appears. Measured on the Legion: a 4,574-token Ask prompt took ~70.5s of
 * prompt-eval (~65 tok/s) before generation began — so the cloud 45s
 * first-token ceiling fired a FALSE timeout on a working local Ask. The
 * first-token budget must scale with the prompt for the LOCAL provider only.
 */
describe('computeAnswerFirstTokenBudgetMs', () => {
  it('returns the unchanged 45s base for a cloud send, regardless of prompt size', () => {
    expect(computeAnswerFirstTokenBudgetMs({ isLocal: false, estimatedPromptTokens: 0 })).toBe(
      ASK_ANSWER_TIMEOUT_MS,
    );
    expect(computeAnswerFirstTokenBudgetMs({ isLocal: false, estimatedPromptTokens: 50_000 })).toBe(
      ASK_ANSWER_TIMEOUT_MS,
    );
  });

  it('returns the base for a local send with a tiny prompt (a small question evals near-instantly)', () => {
    expect(computeAnswerFirstTokenBudgetMs({ isLocal: true, estimatedPromptTokens: 0 })).toBe(
      ASK_ANSWER_TIMEOUT_MS,
    );
  });

  it('scales a local budget with prompt tokens: base + tokens / RATE seconds', () => {
    const tokens = 4_574; // the measured Legion prompt
    const expected =
      ASK_ANSWER_TIMEOUT_MS + Math.round((tokens / LOCAL_FIRST_TOKEN_EVAL_RATE_TOKENS_PER_SEC) * 1000);
    expect(computeAnswerFirstTokenBudgetMs({ isLocal: true, estimatedPromptTokens: tokens })).toBe(
      expected,
    );
  });

  it('clears the real measured eval time (70.5s) with generous headroom for the measured prompt', () => {
    const budget = computeAnswerFirstTokenBudgetMs({ isLocal: true, estimatedPromptTokens: 4_574 });
    // Measured first-token was ~70.5s; the budget must sit well above it so a
    // working local Ask is never killed, while staying under the ceiling.
    expect(budget).toBeGreaterThan(140_000); // > 2× the measured eval time
    expect(budget).toBeLessThan(LOCAL_FIRST_TOKEN_BUDGET_CEILING_MS);
  });

  it('caps a huge local prompt at the ceiling so a genuinely wedged engine still fails honestly', () => {
    expect(
      computeAnswerFirstTokenBudgetMs({ isLocal: true, estimatedPromptTokens: 1_000_000 }),
    ).toBe(LOCAL_FIRST_TOKEN_BUDGET_CEILING_MS);
  });

  it('never returns below the base, even for a negative/garbage token count', () => {
    expect(computeAnswerFirstTokenBudgetMs({ isLocal: true, estimatedPromptTokens: -100 })).toBe(
      ASK_ANSWER_TIMEOUT_MS,
    );
  });
});

describe('withAskTimeout', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('resolves with the underlying value when it settles before the deadline', async () => {
    const promise = withAskTimeout(Promise.resolve('ok'), 1000, 'retrieval');
    await vi.advanceTimersByTimeAsync(0);
    await expect(promise).resolves.toBe('ok');
  });

  it('rejects with a stage-tagged AskTimeoutError when the deadline passes first', async () => {
    const never = new Promise<string>(() => { /* never settles */ });
    const promise = withAskTimeout(never, 1000, 'retrieval');
    const assertion = expect(promise).rejects.toMatchObject({ name: 'AskTimeoutError', stage: 'retrieval' });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it('isAskTimeoutError recognizes both instanceof and name-matched errors', () => {
    expect(isAskTimeoutError(new AskTimeoutError('answer', 100))).toBe(true);
    const crossBundle = new Error('boom');
    crossBundle.name = 'AskTimeoutError';
    expect(isAskTimeoutError(crossBundle)).toBe(true);
    expect(isAskTimeoutError(new Error('plain'))).toBe(false);
  });
});

/**
 * QA-7 state machine: no-progress → warning state → timeout (error/retry
 * handoff). This is the core defense against the silent-forever "Answering…"
 * spinner — everything downstream (the honest error message + retry) hinges
 * on these two timers firing in the right order and `markProgress` correctly
 * suppressing both while tokens are actively arriving.
 */
describe('createAnswerStallWatchdog', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('stays silent while progress keeps arriving faster than the warning window', () => {
    const onWarning = vi.fn();
    const onTimeout = vi.fn();
    const watchdog = createAnswerStallWatchdog({ onWarning, onTimeout });

    // Five progress pings, each inside the warning window — never stalls.
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(ASK_ANSWER_WARNING_MS - 1);
      watchdog.markProgress();
    }

    expect(onWarning).not.toHaveBeenCalled();
    expect(onTimeout).not.toHaveBeenCalled();
    watchdog.cancel();
  });

  it('fires onWarning after the warning window, then onTimeout after the hard ceiling, with no progress', () => {
    const onWarning = vi.fn();
    const onTimeout = vi.fn();
    createAnswerStallWatchdog({ onWarning, onTimeout });

    vi.advanceTimersByTime(ASK_ANSWER_WARNING_MS);
    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(ASK_ANSWER_TIMEOUT_MS - ASK_ANSWER_WARNING_MS);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('markProgress after the warning re-arms both timers from zero (a late-arriving token clears the warning)', () => {
    const onWarning = vi.fn();
    const onTimeout = vi.fn();
    const watchdog = createAnswerStallWatchdog({ onWarning, onTimeout });

    vi.advanceTimersByTime(ASK_ANSWER_WARNING_MS);
    expect(onWarning).toHaveBeenCalledTimes(1);

    watchdog.markProgress();
    vi.advanceTimersByTime(ASK_ANSWER_WARNING_MS - 1);
    expect(onWarning).toHaveBeenCalledTimes(1); // not re-fired yet
    expect(onTimeout).not.toHaveBeenCalled();

    watchdog.cancel();
  });

  it('cancel() stops both timers for good', () => {
    const onWarning = vi.fn();
    const onTimeout = vi.fn();
    const watchdog = createAnswerStallWatchdog({ onWarning, onTimeout });

    watchdog.cancel();
    vi.advanceTimersByTime(ASK_ANSWER_TIMEOUT_MS + 1000);

    expect(onWarning).not.toHaveBeenCalled();
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('onTimeout fires only once even if the ceiling is crossed multiple times', () => {
    const onWarning = vi.fn();
    const onTimeout = vi.fn();
    createAnswerStallWatchdog({ onWarning, onTimeout });

    vi.advanceTimersByTime(ASK_ANSWER_TIMEOUT_MS + 10_000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('honours custom warning/timeout durations', () => {
    const onWarning = vi.fn();
    const onTimeout = vi.fn();
    createAnswerStallWatchdog({ onWarning, onTimeout, warningMs: 100, timeoutMs: 300 });

    vi.advanceTimersByTime(100);
    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  /**
   * lp/localai-patience — the FIRST token gets a generous, prompt-scaled budget
   * (a local CPU prompt-eval can legitimately take a minute+), while the
   * between-token gap keeps the tight 45s ceiling (once generation is streaming,
   * silence really is a stall). So a long local eval must NOT trip onTimeout
   * before the first-token budget expires.
   */
  it('uses firstTokenTimeoutMs for the pre-first-token wait, not the between-token timeoutMs', () => {
    const onWarning = vi.fn();
    const onTimeout = vi.fn();
    createAnswerStallWatchdog({
      onWarning,
      onTimeout,
      warningMs: 12_000,
      timeoutMs: 45_000,
      firstTokenTimeoutMs: 159_000,
    });

    // Well past the 45s between-token ceiling but inside the first-token budget:
    // a working local eval must NOT be killed here.
    vi.advanceTimersByTime(45_001);
    expect(onTimeout).not.toHaveBeenCalled();

    // Only once the scaled first-token budget expires does it fail honestly.
    vi.advanceTimersByTime(159_000 - 45_001);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('after the first progress, the tight between-token timeoutMs governs (not the big first-token budget)', () => {
    const onWarning = vi.fn();
    const onTimeout = vi.fn();
    const watchdog = createAnswerStallWatchdog({
      onWarning,
      onTimeout,
      warningMs: 12_000,
      timeoutMs: 45_000,
      firstTokenTimeoutMs: 200_000,
    });

    // First token arrives quickly; now a mid-stream stall is a real stall and
    // must be caught at the tight 45s ceiling, not the 200s first-token budget.
    vi.advanceTimersByTime(1_000);
    watchdog.markProgress();
    vi.advanceTimersByTime(45_000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('tells onWarning which phase fired: "first-token" before any progress, "streaming" after', () => {
    const onWarning = vi.fn();
    const onTimeout = vi.fn();
    const watchdog = createAnswerStallWatchdog({
      onWarning,
      onTimeout,
      warningMs: 12_000,
      timeoutMs: 45_000,
      firstTokenTimeoutMs: 200_000,
    });

    vi.advanceTimersByTime(12_000);
    expect(onWarning).toHaveBeenLastCalledWith('first-token');

    watchdog.markProgress();
    vi.advanceTimersByTime(12_000);
    expect(onWarning).toHaveBeenLastCalledWith('streaming');
    watchdog.cancel();
  });
});

/**
 * Fix 1b (demo readiness) — waitForLocalAiSidecarReady is what stands between
 * a Local-only send and createAnswerStallWatchdog above: the watchdog must
 * only start counting once the embedded engine is actually ready to
 * generate, never while the sidecar is still legitimately cold-starting
 * (which can take up to two minutes).
 */
describe('waitForLocalAiSidecarReady', () => {
  it('is a no-op for any provider other than lantern-local', async () => {
    const checkHealth = vi.fn();
    const startSidecar = vi.fn();
    const onStarting = vi.fn();

    await waitForLocalAiSidecarReady({ providerId: 'ollama', checkHealth, startSidecar, onStarting });
    await waitForLocalAiSidecarReady({ providerId: 'anthropic', checkHealth, startSidecar, onStarting });
    await waitForLocalAiSidecarReady({ providerId: '', checkHealth, startSidecar, onStarting });

    expect(checkHealth).not.toHaveBeenCalled();
    expect(startSidecar).not.toHaveBeenCalled();
    expect(onStarting).not.toHaveBeenCalled();
  });

  it('does nothing (never calls onStarting or startSidecar) when off desktop, even for lantern-local', async () => {
    const checkHealth = vi.fn();
    const startSidecar = vi.fn();
    const onStarting = vi.fn();

    await waitForLocalAiSidecarReady({
      providerId: 'lantern-local',
      checkHealth,
      startSidecar,
      onStarting,
      isDesktop: () => false,
    });

    expect(checkHealth).not.toHaveBeenCalled();
    expect(startSidecar).not.toHaveBeenCalled();
    expect(onStarting).not.toHaveBeenCalled();
  });

  it('does nothing (never calls onStarting or startSidecar) when the sidecar is already healthy', async () => {
    const checkHealth = vi.fn().mockResolvedValue(true);
    const startSidecar = vi.fn();
    const onStarting = vi.fn();

    await waitForLocalAiSidecarReady({
      providerId: 'lantern-local',
      checkHealth,
      startSidecar,
      onStarting,
      isDesktop: () => true,
    });

    expect(startSidecar).not.toHaveBeenCalled();
    expect(onStarting).not.toHaveBeenCalled();
  });

  it('starts the sidecar and toggles onStarting(true) then onStarting(false) when not yet healthy', async () => {
    const checkHealth = vi.fn().mockResolvedValue(false);
    const startSidecar = vi.fn().mockResolvedValue('http://127.0.0.1:18089');
    const onStarting = vi.fn();

    await waitForLocalAiSidecarReady({
      providerId: 'lantern-local',
      checkHealth,
      startSidecar,
      onStarting,
      isDesktop: () => true,
    });

    expect(startSidecar).toHaveBeenCalledTimes(1);
    expect(onStarting.mock.calls).toEqual([[true], [false]]);
  });

  it('treats a checkHealth failure as "not healthy yet" and proceeds to start', async () => {
    const checkHealth = vi.fn().mockRejectedValue(new Error('probe failed'));
    const startSidecar = vi.fn().mockResolvedValue('http://127.0.0.1:18089');
    const onStarting = vi.fn();

    await waitForLocalAiSidecarReady({
      providerId: 'lantern-local',
      checkHealth,
      startSidecar,
      onStarting,
      isDesktop: () => true,
    });

    expect(startSidecar).toHaveBeenCalledTimes(1);
    expect(onStarting.mock.calls).toEqual([[true], [false]]);
  });

  it('still calls onStarting(false) and propagates the error when startSidecar fails', async () => {
    const checkHealth = vi.fn().mockResolvedValue(false);
    const startSidecar = vi.fn().mockRejectedValue(new Error('binary missing'));
    const onStarting = vi.fn();

    await expect(
      waitForLocalAiSidecarReady({
        providerId: 'lantern-local',
        checkHealth,
        startSidecar,
        onStarting,
        isDesktop: () => true,
      }),
    ).rejects.toThrow('binary missing');

    expect(onStarting.mock.calls).toEqual([[true], [false]]);
  });

  it('a slow (but successful) cold start never trips the 45s watchdog, because the watchdog is armed only AFTER the gate resolves', async () => {
    vi.useFakeTimers();
    try {
      const onWarning = vi.fn();
      const onTimeout = vi.fn();
      const onStarting = vi.fn();

      let resolveStart: (v: string) => void = () => undefined;
      const startSidecar = vi.fn(
        () => new Promise<string>((resolve) => { resolveStart = resolve; }),
      );
      const checkHealth = vi.fn().mockResolvedValue(false);

      const gatePromise = waitForLocalAiSidecarReady({
        providerId: 'lantern-local',
        checkHealth,
        startSidecar,
        onStarting,
        isDesktop: () => true,
      });

      // The sidecar takes far longer than the answer watchdog's 45s ceiling
      // to become healthy — this must never be able to trip a timeout that
      // doesn't exist yet.
      await vi.advanceTimersByTimeAsync(ASK_ANSWER_TIMEOUT_MS + 10_000);
      expect(onStarting).toHaveBeenCalledWith(true);
      expect(onTimeout).not.toHaveBeenCalled();

      resolveStart('http://127.0.0.1:18089');
      await gatePromise;
      expect(onStarting).toHaveBeenLastCalledWith(false);

      // Only NOW — exactly mirroring the call order in useAsk.ts — does the
      // no-token watchdog get armed. It must start counting from zero.
      createAnswerStallWatchdog({ onWarning, onTimeout });
      await vi.advanceTimersByTimeAsync(ASK_ANSWER_TIMEOUT_MS - 1);
      expect(onTimeout).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * Round-2 review finding: `local_llm_sidecar_start` holds the Rust-side
   * sidecar mutex through its ENTIRE up-to-120s health wait, and
   * `local_llm_sidecar_health` takes the SAME mutex — so when a boot/selection
   * pre-start is already mid-warm-up, a concurrent `checkHealth()` call
   * QUEUES behind it instead of answering quickly. Naively awaiting it (the
   * round-1 shape) left the user on the plain "Answering…" spinner for the
   * ENTIRE queued wait — exactly the failure this function exists to prevent.
   */
  it('shows the starting state when the health probe is blocked behind an in-flight warm-up, then clears it without a redundant startSidecar call once it resolves healthy', async () => {
    vi.useFakeTimers();
    try {
      const onStarting = vi.fn();
      const startSidecar = vi.fn();
      let resolveHealth: (v: boolean) => void = () => undefined;
      const checkHealth = vi.fn(
        () => new Promise<boolean>((resolve) => { resolveHealth = resolve; }),
      );

      const gatePromise = waitForLocalAiSidecarReady({
        providerId: 'lantern-local',
        checkHealth,
        startSidecar,
        onStarting,
        isDesktop: () => true,
      });

      // Still inside the grace window — the probe just hasn't answered yet
      // (queued behind the other in-flight warm-up's mutex hold); nothing to
      // show the user until we're sure this isn't just a normal fast probe.
      await vi.advanceTimersByTimeAsync(LOCAL_AI_HEALTH_PROBE_GRACE_MS - 1);
      expect(onStarting).not.toHaveBeenCalled();

      // Past the grace window: the probe STILL hasn't answered, so show
      // "starting" now, before we know whether we'll need to call
      // startSidecar ourselves at all.
      await vi.advanceTimersByTimeAsync(1);
      expect(onStarting).toHaveBeenCalledWith(true);
      expect(onStarting).toHaveBeenCalledTimes(1);

      // The blocked probe finally answers healthy (the OTHER in-flight start
      // succeeded) — clear the state and never redundantly start it ourselves.
      resolveHealth(true);
      await gatePromise;
      expect(onStarting).toHaveBeenLastCalledWith(false);
      expect(onStarting).toHaveBeenCalledTimes(2);
      expect(startSidecar).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a probe blocked past the grace window that resolves NOT healthy falls through to starting the sidecar without a duplicate onStarting(true) call', async () => {
    vi.useFakeTimers();
    try {
      const onStarting = vi.fn();
      const startSidecar = vi.fn().mockResolvedValue('http://127.0.0.1:18089');
      let resolveHealth: (v: boolean) => void = () => undefined;
      const checkHealth = vi.fn(
        () => new Promise<boolean>((resolve) => { resolveHealth = resolve; }),
      );

      const gatePromise = waitForLocalAiSidecarReady({
        providerId: 'lantern-local',
        checkHealth,
        startSidecar,
        onStarting,
        isDesktop: () => true,
      });

      await vi.advanceTimersByTimeAsync(LOCAL_AI_HEALTH_PROBE_GRACE_MS);
      expect(onStarting).toHaveBeenCalledWith(true);
      expect(onStarting).toHaveBeenCalledTimes(1);

      resolveHealth(false);
      await gatePromise;
      // Still exactly one onStarting(true) — never a redundant second call —
      // followed by exactly one onStarting(false) once startSidecar settles.
      expect(onStarting.mock.calls).toEqual([[true], [false]]);
      expect(startSidecar).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never flashes "starting" on the fast path — a quick health check answers well inside the grace window', async () => {
    vi.useFakeTimers();
    try {
      const onStarting = vi.fn();
      const startSidecar = vi.fn();
      const checkHealth = vi.fn().mockResolvedValue(true);

      await waitForLocalAiSidecarReady({
        providerId: 'lantern-local',
        checkHealth,
        startSidecar,
        onStarting,
        isDesktop: () => true,
      });
      await vi.advanceTimersByTimeAsync(LOCAL_AI_HEALTH_PROBE_GRACE_MS + 1000);

      expect(onStarting).not.toHaveBeenCalled();
      expect(startSidecar).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
