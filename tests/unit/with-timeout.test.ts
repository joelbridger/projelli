import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withTimeout, TimeoutError } from '@/lib/withTimeout';

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the underlying value when it settles before the deadline', async () => {
    const promise = withTimeout(Promise.resolve('ok'), 1000, 'test op');
    await expect(promise).resolves.toBe('ok');
  });

  it('rejects with the underlying error when it rejects before the deadline', async () => {
    const promise = withTimeout(Promise.reject(new Error('boom')), 1000, 'test op');
    await expect(promise).rejects.toThrow('boom');
  });

  it('rejects with a TimeoutError when the promise never settles', async () => {
    let assertion: Promise<void> | null = null;
    const hung = new Promise<string>(() => {
      // Never resolves or rejects — simulates a hung backend call.
    });
    const result = withTimeout(hung, 5000, 'hanging op');
    assertion = expect(result).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  it('TimeoutError message includes the label', async () => {
    const hung = new Promise<string>(() => {});
    const result = withTimeout(hung, 2000, 'Checking key');
    const assertion = expect(result).rejects.toThrow(/Checking key timed out after 2s/);
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
  });

  it('aborts the provided controller when the deadline fires', async () => {
    const controller = new AbortController();
    const hung = new Promise<string>(() => {});
    const result = withTimeout(hung, 1000, 'abortable op', { controller });
    const assertion = expect(result).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(controller.signal.aborted).toBe(true);
  });

  it('does not abort the controller when the promise settles first', async () => {
    const controller = new AbortController();
    await withTimeout(Promise.resolve('done'), 1000, 'fast op', { controller });
    expect(controller.signal.aborted).toBe(false);
  });
});
