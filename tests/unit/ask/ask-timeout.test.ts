import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  withAskTimeout,
  AskTimeoutError,
  isAskTimeoutError,
  ASK_RETRIEVAL_TIMEOUT_MS,
} from '@/features/ask/askTimeout';

describe('withAskTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects with an AskTimeoutError when the promise never settles (the hang)', async () => {
    // Simulates the fix/ask-list-hang stall: MemoryService.retrieve never resolves.
    const neverSettles = new Promise<string[]>(() => {
      /* intentionally never resolves */
    });

    const raced = withAskTimeout(neverSettles, ASK_RETRIEVAL_TIMEOUT_MS, 'retrieval');
    // Attach the assertion BEFORE advancing timers so the rejection is observed.
    const assertion = expect(raced).rejects.toMatchObject({
      name: 'AskTimeoutError',
      stage: 'retrieval',
    });

    await vi.advanceTimersByTimeAsync(ASK_RETRIEVAL_TIMEOUT_MS + 1);
    await assertion;
  });

  it('passes a value through untouched when it settles in time', async () => {
    // Resolves via a microtask (not a timer), so it wins the race without
    // advancing the fake clock; the timeout timer is cleared in `finally`.
    await expect(
      withAskTimeout(Promise.resolve(['hit']), ASK_RETRIEVAL_TIMEOUT_MS, 'retrieval'),
    ).resolves.toEqual(['hit']);
  });

  it('propagates the underlying rejection (not a timeout) when the promise fails fast', async () => {
    // `.rejects` attaches the handler synchronously, so the fast rejection is
    // never momentarily unhandled.
    await expect(
      withAskTimeout(
        Promise.reject(new Error('retrieval backend exploded')),
        ASK_RETRIEVAL_TIMEOUT_MS,
        'retrieval',
      ),
    ).rejects.toThrow('retrieval backend exploded');
  });

  it('clears the timer once settled so no dangling timeout remains', async () => {
    await withAskTimeout(Promise.resolve('ok'), 1000, 'retrieval');
    // If the timer were not cleared, a pending fake timer would remain.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('isAskTimeoutError recognizes the error type and rejects non-timeouts', () => {
    expect(isAskTimeoutError(new AskTimeoutError('retrieval', 30_000))).toBe(true);
    expect(isAskTimeoutError(new Error('nope'))).toBe(false);
    expect(isAskTimeoutError(null)).toBe(false);
  });
});
