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

  it('never lets a per-path failure become an unhandled rejection, logs once per batch, and retries the failed path', async () => {
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

    // bad(fail) + good(success) + bad(retry, now succeeds) — the failed path
    // is never abandoned, it's requeued and retried within the same flush.
    expect(deletePath).toHaveBeenCalledTimes(3);
    expect(onLog).toHaveBeenCalledTimes(1);
    expect(onLog).toHaveBeenCalledWith(
      expect.stringContaining('1 of 2 delete event(s) failed; retrying'),
    );
  });

  it('P1 regression: opens the breaker after a sustained run of failures, but every queued path is still attempted (and requeued) this round — none skipped', async () => {
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

    // The breaker exceeds its 3-consecutive-failure threshold, but this round
    // never bails out early: every one of the 10 queued paths gets a real
    // attempt (never silently skipped), and — since all 10 failed — all 10
    // are still queued for the scheduled retry after cooldown (a deleted
    // client file must never silently stay searchable). The breaker only
    // paces the NEXT round via the cooldown.
    expect(deletePath).toHaveBeenCalledTimes(10);
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('10 of 10 delete event(s) failed'));
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('10 consecutive delete failures'));
    expect(onLog).toHaveBeenCalledWith(
      expect.stringContaining('retrying 10 pending delete event(s) after cooldown'),
    );
  });

  it('P1 regression: a burst enqueued during cooldown is queued, not dropped, and is not attempted until cooldown elapses', async () => {
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

    // Not attempted yet (still cooling down) — but NOT logged as dropped,
    // because nothing was dropped. It's silently waiting for the retry.
    expect(deletePath).not.toHaveBeenCalled();
    expect(onLog).not.toHaveBeenCalled();
  });

  it('P1 regression: one chronically-failing path never permanently starves unrelated deletes queued behind it', async () => {
    // '/ws/bad.docx' NEVER succeeds; everything else always does. Because
    // Set insertion order keeps `bad` first, without a per-cooldown reset of
    // the failure counter it would instantly re-trip the breaker every time
    // and every path queued behind it would be requeued as "not yet
    // attempted" forever — legitimate deletes silently never running.
    const deletePath = vi.fn().mockImplementation(async (path: string) => {
      if (path === '/ws/bad.docx') throw new Error('permanently broken row');
    });
    const batcher = createDeleteBurstBatcher(deletePath, {
      windowMs: 100,
      breakerThreshold: 2,
      cooldownMs: 5_000,
    });

    // 'bad' alone trips the breaker (2 consecutive failures against itself,
    // since it's the only thing queued).
    batcher.enqueue('/ws/bad.docx');
    await vi.advanceTimersByTimeAsync(100);
    expect(deletePath).toHaveBeenCalledTimes(2);
    expect(deletePath).toHaveBeenCalledWith('/ws/bad.docx');

    // Two unrelated, perfectly-deletable paths arrive while the breaker is
    // still cooling down from 'bad'.
    deletePath.mockClear();
    batcher.enqueue('/ws/good1.docx');
    batcher.enqueue('/ws/good2.docx');
    await vi.advanceTimersByTimeAsync(100); // still well within the 5s cooldown
    expect(deletePath).not.toHaveBeenCalled(); // correctly paced, not starved yet

    // Cooldown elapses — the retry round must reach good1/good2, not get
    // stuck re-tripping on 'bad' before ever attempting them.
    await vi.advanceTimersByTimeAsync(5_000);

    expect(deletePath).toHaveBeenCalledWith('/ws/good1.docx');
    expect(deletePath).toHaveBeenCalledWith('/ws/good2.docx');
  });

  it('P1 escalation regression: threshold-or-more chronically-bad paths ahead of a good one still let the good one run in the SAME round', async () => {
    // Resetting the failure counter per cooldown (the prior fix) isn't
    // enough when breakerThreshold-or-more permanently-broken paths sit
    // ahead of a good one: the round used to bail out of the for-loop the
    // instant the threshold was hit, so the good path — sitting right behind
    // the bad run — was requeued as "not yet attempted" and never actually
    // tried, round after round, forever. The fix never breaks the for-loop
    // early; every distinct path always gets one real attempt per round.
    const deletePath = vi.fn().mockImplementation(async (path: string) => {
      if (path.startsWith('/ws/bad')) throw new Error('permanently broken row');
    });
    const onLog = vi.fn();
    const batcher = createDeleteBurstBatcher(deletePath, {
      windowMs: 100,
      breakerThreshold: 3,
      cooldownMs: 5_000,
      onLog,
    });

    // Exactly `breakerThreshold` chronically-bad paths, THEN one good path,
    // all enqueued in the same burst.
    batcher.enqueue('/ws/bad-1.docx');
    batcher.enqueue('/ws/bad-2.docx');
    batcher.enqueue('/ws/bad-3.docx');
    batcher.enqueue('/ws/good.docx');

    await vi.advanceTimersByTimeAsync(100);

    // All 4 attempted this round (bad-1..3 fail and trip the breaker, but
    // `good` — queued behind them — still gets its real attempt and
    // succeeds, in the SAME round the breaker trips).
    expect(deletePath).toHaveBeenCalledTimes(4);
    expect(deletePath).toHaveBeenCalledWith('/ws/good.docx');
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('3 consecutive delete failures'));
    // Only the 3 bad ones remain queued for retry — `good` already succeeded.
    expect(onLog).toHaveBeenCalledWith(
      expect.stringContaining('retrying 3 pending delete event(s) after cooldown'),
    );
  });

  it('P1 regression: every originally-queued path is eventually retried and succeeds once the backend recovers — none lost across the breaker/cooldown cycle', async () => {
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
    expect(deletePath).toHaveBeenCalledTimes(2); // both fail, breaker opens

    // A third path arrives mid-cooldown — queued, not dropped.
    await vi.advanceTimersByTimeAsync(100);
    batcher.enqueue('/ws/c.docx');
    await vi.advanceTimersByTimeAsync(100);
    expect(deletePath).toHaveBeenCalledTimes(2); // still cooling — no new attempts

    // Cooldown elapses — the dedicated cooldown-retry timer wakes the
    // batcher on its own (no fresh enqueue required) and drains everything
    // that was ever queued: a, b (retried) and c.
    await vi.advanceTimersByTimeAsync(5_000);

    expect(deletePath).toHaveBeenCalledTimes(5);
    const retriedPaths = deletePath.mock.calls.slice(2).map((call) => call[0]);
    expect(retriedPaths.sort()).toEqual(['/ws/a.docx', '/ws/b.docx', '/ws/c.docx']);
  });

  it('cancel() removes a queued-but-not-yet-flushed delete for a path', async () => {
    const deletePath = vi.fn().mockResolvedValue(undefined);
    const batcher = createDeleteBurstBatcher(deletePath, { windowMs: 250 });

    batcher.enqueue('/ws/a.docx');
    expect(batcher.cancel('/ws/a.docx')).toBe(true);
    expect(batcher.cancel('/ws/a.docx')).toBe(false); // already gone

    await vi.advanceTimersByTimeAsync(250);

    expect(deletePath).not.toHaveBeenCalled();
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
