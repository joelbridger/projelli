/**
 * createDeleteBurstBatcher — unit tests for the frontend delete-flood guard.
 *
 * Root cause under test: `workspace-file-changed` delete events used to fire
 * `MemoryService.deletePath` per event with no error handling — a mass delete
 * (thousands of files) issued that many concurrent, uncaught-rejection-prone
 * backend calls. The batcher coalesces bursts into one bounded sequential
 * sweep, never lets a failure escape as an unhandled rejection, and opens a
 * breaker after repeated consecutive failures instead of continuing to
 * hammer a failing backend.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDeleteBurstBatcher } from './useMemoryWiring';

describe('createDeleteBurstBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces a burst of enqueues within the window into one flush', async () => {
    const deletePath = vi.fn().mockResolvedValue(undefined);
    const batcher = createDeleteBurstBatcher(deletePath, { windowMs: 250 });

    for (let i = 0; i < 50; i += 1) {
      batcher.enqueue(`/ws/file-${i}.docx`);
    }
    expect(deletePath).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(250);

    expect(deletePath).toHaveBeenCalledTimes(50);
  });

  it('dedupes repeated deletes of the same path within one window', async () => {
    const deletePath = vi.fn().mockResolvedValue(undefined);
    const batcher = createDeleteBurstBatcher(deletePath, { windowMs: 250 });

    batcher.enqueue('/ws/a.docx');
    batcher.enqueue('/ws/a.docx');
    batcher.enqueue('/ws/a.docx');

    await vi.advanceTimersByTimeAsync(250);

    expect(deletePath).toHaveBeenCalledTimes(1);
    expect(deletePath).toHaveBeenCalledWith('/ws/a.docx');
  });

  it('processes a burst sequentially, never issuing concurrent backend calls', async () => {
    let inFlight = 0;
    let maxConcurrent = 0;
    const deletePath = vi.fn().mockImplementation(async () => {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await Promise.resolve();
      inFlight -= 1;
    });
    const batcher = createDeleteBurstBatcher(deletePath, { windowMs: 250 });

    for (let i = 0; i < 20; i += 1) {
      batcher.enqueue(`/ws/file-${i}.docx`);
    }
    await vi.advanceTimersByTimeAsync(250);
    await vi.runAllTimersAsync();

    expect(deletePath).toHaveBeenCalledTimes(20);
    expect(maxConcurrent).toBe(1);
  });

  it('never runs a second flush while one is in-flight, even when new deletes arrive mid-batch', async () => {
    // Regression for a race: enqueuing more paths WHILE a batch is still
    // awaiting deletePath used to be able to arm a second debounce timer,
    // firing an overlapping concurrent flush — exactly the storm this
    // batcher exists to prevent.
    let inFlight = 0;
    let maxConcurrent = 0;
    let callCount = 0;
    let batcher: ReturnType<typeof createDeleteBurstBatcher>;
    batcher = createDeleteBurstBatcher(
      vi.fn().mockImplementation(async () => {
        inFlight += 1;
        maxConcurrent = Math.max(maxConcurrent, inFlight);
        callCount += 1;
        // First call: while still awaiting, more deletes stream in — this is
        // the moment a second flush could previously have started.
        if (callCount === 1) {
          batcher.enqueue('/ws/mid-batch-1.docx');
          batcher.enqueue('/ws/mid-batch-2.docx');
        }
        await Promise.resolve();
        await Promise.resolve();
        inFlight -= 1;
      }),
      { windowMs: 250 },
    );

    batcher.enqueue('/ws/a.docx');
    batcher.enqueue('/ws/b.docx');
    await vi.advanceTimersByTimeAsync(250);
    await vi.runAllTimersAsync();

    expect(maxConcurrent).toBe(1);
    expect(callCount).toBe(4); // a, b, mid-batch-1, mid-batch-2 — all drained by one flush
  });

  it('never lets a per-path failure become an unhandled rejection, and logs once per batch', async () => {
    const deletePath = vi
      .fn()
      .mockRejectedValueOnce(new Error('backend race'))
      .mockResolvedValue(undefined);
    const onLog = vi.fn();
    const batcher = createDeleteBurstBatcher(deletePath, {
      windowMs: 250,
      breakerThreshold: 5,
      onLog,
    });

    batcher.enqueue('/ws/bad.docx');
    batcher.enqueue('/ws/good.docx');

    await vi.advanceTimersByTimeAsync(250);

    expect(deletePath).toHaveBeenCalledTimes(2);
    expect(onLog).toHaveBeenCalledTimes(1);
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('1 of 2 delete event(s) failed'));
  });

  it('opens the breaker after N consecutive failures and drops the rest of the burst', async () => {
    const deletePath = vi.fn().mockRejectedValue(new Error('lancedb writer race'));
    const onLog = vi.fn();
    const batcher = createDeleteBurstBatcher(deletePath, {
      windowMs: 250,
      breakerThreshold: 3,
      cooldownMs: 10_000,
      onLog,
    });

    for (let i = 0; i < 10; i += 1) {
      batcher.enqueue(`/ws/file-${i}.docx`);
    }
    await vi.advanceTimersByTimeAsync(250);

    // Breaker trips after 3 consecutive failures — the other 7 in this burst
    // are dropped, not attempted.
    expect(deletePath).toHaveBeenCalledTimes(3);
    expect(onLog).toHaveBeenCalledTimes(1);
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('3 consecutive delete failures'));
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('dropping 7 pending delete event(s)'));
  });

  it('drops an entire new burst during the cooldown window without calling the backend', async () => {
    const deletePath = vi.fn().mockRejectedValue(new Error('lancedb writer race'));
    const onLog = vi.fn();
    const batcher = createDeleteBurstBatcher(deletePath, {
      windowMs: 100,
      breakerThreshold: 2,
      cooldownMs: 5_000,
      onLog,
    });

    batcher.enqueue('/ws/a.docx');
    batcher.enqueue('/ws/b.docx');
    await vi.advanceTimersByTimeAsync(100);
    expect(deletePath).toHaveBeenCalledTimes(2); // both fail, breaker opens

    deletePath.mockClear();
    onLog.mockClear();

    // A fresh burst arrives while the breaker is still open.
    batcher.enqueue('/ws/c.docx');
    batcher.enqueue('/ws/d.docx');
    batcher.enqueue('/ws/e.docx');
    await vi.advanceTimersByTimeAsync(100);

    expect(deletePath).not.toHaveBeenCalled();
    expect(onLog).toHaveBeenCalledTimes(1);
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('dropping 3 delete event(s) during cooldown'));
  });

  it('resumes normal processing once the cooldown elapses', async () => {
    const deletePath = vi
      .fn()
      .mockRejectedValueOnce(new Error('e1'))
      .mockRejectedValueOnce(new Error('e2'))
      .mockResolvedValue(undefined);
    const onLog = vi.fn();
    const batcher = createDeleteBurstBatcher(deletePath, {
      windowMs: 100,
      breakerThreshold: 2,
      cooldownMs: 5_000,
      onLog,
    });

    batcher.enqueue('/ws/a.docx');
    batcher.enqueue('/ws/b.docx');
    await vi.advanceTimersByTimeAsync(100);
    expect(deletePath).toHaveBeenCalledTimes(2); // breaker opens

    // Still within cooldown — dropped.
    batcher.enqueue('/ws/c.docx');
    await vi.advanceTimersByTimeAsync(100);
    expect(deletePath).toHaveBeenCalledTimes(2);

    // Cooldown elapses — the next burst goes through normally.
    await vi.advanceTimersByTimeAsync(5_000);
    batcher.enqueue('/ws/d.docx');
    await vi.advanceTimersByTimeAsync(100);
    expect(deletePath).toHaveBeenCalledTimes(3);
    expect(deletePath).toHaveBeenLastCalledWith('/ws/d.docx');
  });

  it('handles a single normal delete promptly after the debounce window', async () => {
    const deletePath = vi.fn().mockResolvedValue(undefined);
    const batcher = createDeleteBurstBatcher(deletePath, { windowMs: 250 });

    batcher.enqueue('/ws/single.docx');
    await vi.advanceTimersByTimeAsync(250);

    expect(deletePath).toHaveBeenCalledTimes(1);
    expect(deletePath).toHaveBeenCalledWith('/ws/single.docx');
  });

  it('dispose cancels a pending flush and drops queued paths', async () => {
    const deletePath = vi.fn().mockResolvedValue(undefined);
    const batcher = createDeleteBurstBatcher(deletePath, { windowMs: 250 });

    batcher.enqueue('/ws/a.docx');
    batcher.dispose();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(deletePath).not.toHaveBeenCalled();
  });
});
