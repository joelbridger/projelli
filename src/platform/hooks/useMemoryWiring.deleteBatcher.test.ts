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

  it('P1 regression: opens the breaker after N consecutive failures — bounded to N doomed calls, never hammers through the whole burst', async () => {
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

    // Breaker trips after exactly 3 consecutive failures — only those 3 are
    // actually attempted (bounded exposure; a 2,000-file storm against a
    // fully-down backend must cost at most `breakerThreshold` doomed calls
    // per cooldown cycle, not hammer through the whole burst). The other 7
    // are NOT attempted right now, but critically they are also NOT dropped:
    // every one of the 10 originally-queued paths is still queued for the
    // scheduled retry after cooldown (a deleted client file must never
    // silently stay searchable).
    expect(deletePath).toHaveBeenCalledTimes(3);
    expect(onLog).toHaveBeenCalledTimes(1);
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('3 consecutive delete failures'));
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

  it('P1 escalation regression: threshold-or-more chronically-bad paths ahead of a good one defer it, but never starve it — bounded this round, prioritized next round', async () => {
    // Resetting the failure counter per cooldown (the prior fix) isn't
    // enough when breakerThreshold-or-more permanently-broken paths sit
    // ahead of a good one: the round used to re-trip on the SAME leading bad
    // run every cooldown cycle, so the good path behind it was requeued as
    // "not yet attempted" and never actually tried, forever. The fix keeps
    // the round BOUNDED (stops at exactly `breakerThreshold` doomed calls —
    // no hammering a dead backend) but rotates whatever didn't get attempted
    // to the FRONT of the next round, ahead of the failing run, so it gets
    // first crack at the very next cooldown wake-up instead of being stuck
    // behind the same bad paths indefinitely.
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

    // Bounded: only the 3 bad ones are attempted this round — the breaker
    // stops as soon as it trips, it does NOT hammer through to `good` even
    // though `good` is right behind.
    expect(deletePath).toHaveBeenCalledTimes(3);
    expect(deletePath).not.toHaveBeenCalledWith('/ws/good.docx');
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('3 consecutive delete failures'));
    expect(onLog).toHaveBeenCalledWith(
      expect.stringContaining('retrying 4 pending delete event(s) after cooldown'),
    );

    deletePath.mockClear();

    // Cooldown elapses — `good` was rotated to the FRONT of the retry queue,
    // so it's attempted (and succeeds) before the still-broken paths can
    // trip the breaker again and block it.
    await vi.advanceTimersByTimeAsync(5_000);

    expect(deletePath.mock.calls[0]?.[0]).toBe('/ws/good.docx');
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

  it('cancel() reaches a path already pulled out of `pending` for the in-flight round but not yet attempted', async () => {
    // A round snapshots the whole `pending` set up front (for a bounded,
    // sequential sweep). A path sitting later in that snapshot is briefly
    // "in flight" — no longer in `pending`, but not yet its turn — so
    // cancel() touching only `pending` would miss a create/modify that
    // arrives in that exact window, letting the stale delete still run and
    // remove content that was just (re)indexed.
    const calls: string[] = [];
    let batcher: ReturnType<typeof createDeleteBurstBatcher>;
    const deletePath = vi.fn().mockImplementation(async (path: string) => {
      calls.push(path);
      if (path === '/ws/a.docx') {
        // Simulate a create/modify for 'target' landing right now — while
        // it's already out of `pending` for this round, but before its turn.
        batcher.cancel('/ws/target.docx');
      }
    });
    batcher = createDeleteBurstBatcher(deletePath, { windowMs: 250 });

    batcher.enqueue('/ws/a.docx');
    batcher.enqueue('/ws/target.docx');
    batcher.enqueue('/ws/b.docx');

    await vi.advanceTimersByTimeAsync(250);

    expect(calls).toEqual(['/ws/a.docx', '/ws/b.docx']);
    expect(deletePath).not.toHaveBeenCalledWith('/ws/target.docx');
  });

  it('a cancelled in-flight path is NOT resurrected when an earlier path trips the breaker before the loop ever reaches it', async () => {
    // If the breaker trips on a path BEFORE the loop ever reaches an
    // already-cancelled in-flight path further down the snapshot, the old
    // requeue logic blindly carried every not-yet-attempted path forward —
    // including ones already cancelled — silently undoing the cancellation
    // and letting the stale delete run after the next cooldown.
    const attempted: string[] = [];
    let batcher: ReturnType<typeof createDeleteBurstBatcher>;
    const deletePath = vi.fn().mockImplementation(async (path: string) => {
      attempted.push(path);
      if (path === '/ws/bad-1.docx') {
        // A create/modify for 'target' lands here — while it's already
        // snapshotted in-flight, but before the loop reaches bad-2 (which
        // trips the breaker) or target's own turn.
        batcher.cancel('/ws/target.docx');
      }
      if (path.startsWith('/ws/bad')) throw new Error('backend down');
    });
    batcher = createDeleteBurstBatcher(deletePath, {
      windowMs: 100,
      breakerThreshold: 2,
      cooldownMs: 5_000,
    });

    batcher.enqueue('/ws/bad-1.docx');
    batcher.enqueue('/ws/bad-2.docx');
    batcher.enqueue('/ws/target.docx');

    await vi.advanceTimersByTimeAsync(100);

    // The breaker trips on bad-2 before the loop ever reaches target's turn.
    expect(attempted).toEqual(['/ws/bad-1.docx', '/ws/bad-2.docx']);

    attempted.length = 0;
    await vi.advanceTimersByTimeAsync(5_000); // cooldown elapses, retry runs

    // target must stay excluded — not silently resurrected into the retry.
    expect(attempted).not.toContain('/ws/target.docx');
  });

  it('cancel() defeats BOTH a duplicate pending copy and the older in-flight copy of the same path', async () => {
    // A duplicate delete event for the same path arriving mid-round (e.g.
    // the watcher double-reporting) leaves a FRESH copy in `pending` while
    // the ORIGINAL copy is still sitting in-flight in this round's
    // snapshot. cancel() must defeat both, not just whichever it finds
    // first — otherwise the stale in-flight copy still runs.
    let batcher: ReturnType<typeof createDeleteBurstBatcher>;
    const attempted: string[] = [];
    const deletePath = vi.fn().mockImplementation(async (path: string) => {
      attempted.push(path);
      if (path === '/ws/a.docx') {
        batcher.enqueue('/ws/dup.docx');
        expect(batcher.cancel('/ws/dup.docx')).toBe(true);
      }
    });
    batcher = createDeleteBurstBatcher(deletePath, { windowMs: 250 });

    batcher.enqueue('/ws/a.docx');
    batcher.enqueue('/ws/dup.docx');

    await vi.advanceTimersByTimeAsync(250);
    await vi.runAllTimersAsync();

    expect(attempted).toEqual(['/ws/a.docx']);
    expect(deletePath).not.toHaveBeenCalledWith('/ws/dup.docx');
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

  it('P2-a regression: dispose() with paths still queued logs once and leaves them for the boot reconcile, never fires them', async () => {
    // Firing queued deletes from dispose() would risk misrouting them to a
    // NEW workspace: `deletePath` has no per-call workspace-scoping
    // parameter, and a workspace switch's `MemoryService.setWorkspace(new)`
    // can race ahead of an async IPC call issued here. The Rust boot
    // reconcile heals the OLD workspace's index next time it's opened, so
    // this is a deliberate, logged punt — not a silent drop.
    const deletePath = vi.fn().mockResolvedValue(undefined);
    const onLog = vi.fn();
    const batcher = createDeleteBurstBatcher(deletePath, { windowMs: 250, onLog });

    batcher.enqueue('/ws/a.docx');
    batcher.enqueue('/ws/b.docx');
    batcher.dispose(); // workspace closed/switched before the 250ms window ever flushed

    await vi.advanceTimersByTimeAsync(1_000);

    expect(deletePath).not.toHaveBeenCalled();
    expect(onLog).toHaveBeenCalledTimes(1);
    expect(onLog).toHaveBeenCalledWith(
      expect.stringContaining('workspace closed with 2 delete(s) still queued'),
    );
  });

  it('dispose() with nothing queued does not log anything', () => {
    const deletePath = vi.fn().mockResolvedValue(undefined);
    const onLog = vi.fn();
    const batcher = createDeleteBurstBatcher(deletePath, { windowMs: 250, onLog });

    batcher.dispose();

    expect(onLog).not.toHaveBeenCalled();
  });

  it('P2-b regression: a create/modify racing an ALREADY-IN-FLIGHT delete (not just the queue) is detected once it settles and triggers recovery', async () => {
    // cancel() marks `pending` and a round's snapshot before its turn, but a
    // path already mid-`await deletePath()` is a THIRD window: the call is
    // already issued and can't be un-sent. This proves it's still tracked —
    // and the caller is told to repair it — once that call settles.
    let resolveDelete!: () => void;
    const deletePath = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        }),
    );
    const onCancelledAfterDelete = vi.fn();
    const batcher = createDeleteBurstBatcher(deletePath, {
      windowMs: 100,
      onCancelledAfterDelete,
    });

    batcher.enqueue('/ws/report.docx');
    await vi.advanceTimersByTimeAsync(100); // flush starts; deletePath is now in flight, awaiting

    expect(deletePath).toHaveBeenCalledTimes(1);
    expect(onCancelledAfterDelete).not.toHaveBeenCalled();

    // A create/modify races the ALREADY-ISSUED call — cancel() can't stop
    // it, but it can mark it.
    expect(batcher.cancel('/ws/report.docx')).toBe(true);
    expect(onCancelledAfterDelete).not.toHaveBeenCalled(); // not yet — still in flight

    // The in-flight delete now resolves (it already succeeded on the
    // backend, AFTER the file was recreated).
    resolveDelete();
    await vi.advanceTimersByTimeAsync(0);

    expect(onCancelledAfterDelete).toHaveBeenCalledWith('/ws/report.docx');
  });

  it('P2-b: if the in-flight delete FAILS after being cancelled, it is dropped (not requeued) and recovery is not triggered', async () => {
    let rejectDelete!: (err: Error) => void;
    const deletePath = vi.fn().mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectDelete = reject;
        }),
    );
    const onCancelledAfterDelete = vi.fn();
    const batcher = createDeleteBurstBatcher(deletePath, {
      windowMs: 100,
      breakerThreshold: 5,
      onCancelledAfterDelete,
    });

    batcher.enqueue('/ws/report.docx');
    await vi.advanceTimersByTimeAsync(100);

    expect(batcher.cancel('/ws/report.docx')).toBe(true);

    rejectDelete(new Error('backend race'));
    await vi.advanceTimersByTimeAsync(0);

    // No rows were actually removed (the call failed) and the file exists
    // again — there is nothing to repair, and nothing to retry.
    expect(onCancelledAfterDelete).not.toHaveBeenCalled();

    deletePath.mockClear();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(deletePath).not.toHaveBeenCalled();
  });
});
