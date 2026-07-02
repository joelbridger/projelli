/**
 * retryWithBackoff — the bounded-retry helper used by useWorkflowRunner's
 * terminal `.workflow` write (Bug F2). Uses an injected instant `sleep` so
 * these tests run in milliseconds instead of waiting on real timers.
 */
import { describe, it, expect, vi } from 'vitest';
import { retryWithBackoff } from '@/lib/retryWithBackoff';

const instantSleep = async (_ms: number) => {};

describe('retryWithBackoff', () => {
  it('returns true immediately when the first attempt succeeds, without sleeping', async () => {
    const sleep = vi.fn(instantSleep);
    const attempt = vi.fn(async () => true);

    const ok = await retryWithBackoff(attempt, [300, 600], sleep);

    expect(ok).toBe(true);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries after a failed attempt and succeeds on a later one', async () => {
    const sleep = vi.fn(instantSleep);
    let calls = 0;
    const attempt = vi.fn(async () => {
      calls += 1;
      return calls >= 2; // fails once, then succeeds
    });

    const ok = await retryWithBackoff(attempt, [300, 600], sleep);

    expect(ok).toBe(true);
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(300);
  });

  it('returns false after exhausting every retry when all attempts fail', async () => {
    const sleep = vi.fn(instantSleep);
    const attempt = vi.fn(async () => false);

    const ok = await retryWithBackoff(attempt, [300, 600], sleep);

    expect(ok).toBe(false);
    // 1 initial attempt + one retry per configured delay.
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([300, 600]);
  });

  it('defaults to real timers when no sleep function is injected (smoke test)', async () => {
    const attempt = vi.fn(async () => true);
    const ok = await retryWithBackoff(attempt);
    expect(ok).toBe(true);
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
