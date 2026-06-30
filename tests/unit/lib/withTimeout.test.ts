/**
 * BUG-002 freeze guard — withTimeout converts a never-settling promise into a
 * visible error so the UI can recover instead of hanging.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withTimeout, TimeoutError } from '@/lib/withTimeout';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('withTimeout', () => {
  it('rejects with a clear TimeoutError message when the work never settles', async () => {
    const neverSettles = new Promise<string>(() => {
      /* intentionally never resolves — simulates a hung native call */
    });
    const wrapped = withTimeout(neverSettles, 5000, 'Creating the workspace took too long.');
    const message = wrapped.catch((e) => {
      expect(e).toBeInstanceOf(TimeoutError);
      return (e as Error).message;
    });
    await vi.advanceTimersByTimeAsync(5000);
    await expect(message).resolves.toContain('took too long');
  });

  it('resolves with the value when the work settles in time', async () => {
    const wrapped = withTimeout(Promise.resolve('ok'), 5000, 'too slow');
    await vi.advanceTimersByTimeAsync(0);
    await expect(wrapped).resolves.toBe('ok');
  });

  it('propagates a normal rejection unchanged (not a timeout)', async () => {
    const boom = Promise.reject(new Error('real failure'));
    await expect(withTimeout(boom, 5000, 'too slow')).rejects.toThrow('real failure');
  });
});
