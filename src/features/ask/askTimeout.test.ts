import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AskTimeoutError,
  isAskTimeoutError,
  withAskTimeout,
  createAnswerStallWatchdog,
  waitForLocalAiSidecarReady,
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
});
