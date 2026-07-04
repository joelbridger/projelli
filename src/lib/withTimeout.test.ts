import { describe, it, expect } from 'vitest';
import { withTimeout, TimeoutError } from './withTimeout';

function delay<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => { resolve(value); }, ms);
  });
}

describe('withTimeout', () => {
  it('resolves with the value when the promise settles before the deadline', async () => {
    const result = await withTimeout(delay('ok', 5), 200, 'Quick op');
    expect(result).toBe('ok');
  });

  it('rejects with a TimeoutError when the deadline fires first', async () => {
    await expect(withTimeout(delay('too late', 200), 20, 'Slow op'))
      .rejects.toThrow(TimeoutError);
  });

  it('TimeoutError message includes the label and rounded seconds', async () => {
    try {
      await withTimeout(delay('x', 200), 20, 'Checking vault status');
      expect.unreachable('must reject');
    } catch (err) {
      expect(err).toBeInstanceOf(TimeoutError);
      expect((err as Error).message).toBe('Checking vault status timed out after 0s');
    }
  });

  it('propagates the original error when the promise rejects before the deadline', async () => {
    const boom = new Error('boom');
    await expect(
      withTimeout(Promise.reject(boom), 200, 'Op'),
    ).rejects.toBe(boom);
  });

  it('wraps a primitive (non-object) rejection in an Error', async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- deliberately rejecting with a raw string to test withTimeout's own handling of non-Error rejections.
      withTimeout(Promise.reject('raw string'), 200, 'Op'),
    ).rejects.toThrow('raw string');
  });

  it('passes a structured object rejection through unchanged (does not stringify it)', async () => {
    const structured = { kind: 'serviceUnavailable', message: 'not responding' };
    await expect(
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- deliberately rejecting with a plain object (like a Tauri command error) to test withTimeout's pass-through behavior.
      withTimeout(Promise.reject(structured), 200, 'Op'),
    ).rejects.toBe(structured);
  });

  it('aborts the given controller when the deadline fires', async () => {
    const controller = new AbortController();
    await expect(
      withTimeout(delay('too late', 200), 20, 'Slow op', { controller }),
    ).rejects.toThrow(TimeoutError);
    expect(controller.signal.aborted).toBe(true);
  });

  it('does not abort the controller when the promise wins the race', async () => {
    const controller = new AbortController();
    await withTimeout(delay('ok', 5), 200, 'Quick op', { controller });
    expect(controller.signal.aborted).toBe(false);
  });
});
