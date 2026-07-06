import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AskTimeoutError,
  isAskTimeoutError,
  withAskTimeout,
  createAnswerStallWatchdog,
  waitForLocalAiSidecarReady,
  LOCAL_AI_HEALTH_PROBE_GRACE_MS,
  ASK_ANSWER_WARNING_MS,
  ASK_ANSWER_TIMEOUT_MS,
} from './askTimeout';

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
});

/**
 * Fix 1b (demo readiness) — waitForLocalAiSidecarReady is what stands between
 * a Local-only send and createAnswerStallWatchdog above: the watchdog must
 * only start counting once the embedded engine is actually ready to
 * generate, never while the sidecar is still legitimately cold-starting
 * (which can take up to two minutes).
 */
describe('waitForLocalAiSidecarReady', () => {
  it('is a no-op for any provider other than keepance-local', async () => {
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

  it('does nothing (never calls onStarting or startSidecar) when off desktop, even for keepance-local', async () => {
    const checkHealth = vi.fn();
    const startSidecar = vi.fn();
    const onStarting = vi.fn();

    await waitForLocalAiSidecarReady({
      providerId: 'keepance-local',
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
      providerId: 'keepance-local',
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
      providerId: 'keepance-local',
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
      providerId: 'keepance-local',
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
        providerId: 'keepance-local',
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
        providerId: 'keepance-local',
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
        providerId: 'keepance-local',
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
        providerId: 'keepance-local',
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
        providerId: 'keepance-local',
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
