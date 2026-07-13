/* eslint-disable @typescript-eslint/require-await -- test op mocks are `async () => { throw }` on purpose: the scheduler consumes a rejecting Promise, so the async wrapper is intentional even without an await */
/**
 * QA-44 — durable, visible re-tag scheduler + scope-update status store.
 *
 * Replaces the swallowed `.catch(() => {})` on the three RAG re-tag reactions
 * (folder->matter re-index, mail folder->matter re-tag, source privilege
 * re-tag). A failed re-tag must:
 *   1. RETRY with backoff (transient failures self-heal), and
 *   2. be VISIBLE to the user (named progress or a plain-language warning) instead
 *      of silently claiming the new rule is live, and
 *   3. for a matter re-index, keep the affected folders EXCLUDED from retrieval
 *      (fail closed) until the re-tag finally succeeds.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRetagScheduler,
  RETAG_RETRY_DELAYS_MS,
} from '@/platform/rag/retagScheduler';
import {
  getExcludedMailMatters,
  getExcludedMatterFolders,
  useScopeUpdateStore,
} from '@/platform/rag/scopeUpdateStore';

beforeEach(() => {
  vi.useFakeTimers();
  useScopeUpdateStore.getState().clearAll();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

function entries() {
  return Object.values(useScopeUpdateStore.getState().entries);
}

describe('createRetagScheduler', () => {
  it('marks a re-tag as retrying while in flight and clears it on success', async () => {
    const scheduler = createRetagScheduler();
    const op = vi.fn().mockResolvedValue(1);

    scheduler.run({ id: 'privilege:/ws/x', kind: 'privilege', label: 'x', op });

    // Registered as retrying immediately.
    expect(entries()).toHaveLength(1);
    expect(entries()[0]?.status).toBe('retrying');

    await vi.runAllTimersAsync();

    expect(op).toHaveBeenCalledTimes(1);
    expect(entries()).toHaveLength(0); // success clears the visible state
  });

  it('retries a transient failure with backoff, then clears on eventual success', async () => {
    const scheduler = createRetagScheduler();
    const op = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(2);

    scheduler.run({ id: 'mail:folderA', kind: 'mail', label: 'mail', op });

    await vi.runAllTimersAsync();

    expect(op).toHaveBeenCalledTimes(2);
    expect(entries()).toHaveLength(0);
  });

  it('marks failed after exhausting retries and keeps matter folders excluded (fail closed)', async () => {
    const scheduler = createRetagScheduler();
    const op = vi.fn().mockRejectedValue(new Error('down'));

    scheduler.run({
      id: 'matter:/ws/Acme',
      kind: 'matter',
      label: 'Acme',
      op,
      excludeFolders: ['/ws/Acme'],
    });

    // Excluded immediately, before any attempt resolves.
    expect(getExcludedMatterFolders()).toContain('/ws/Acme');

    await vi.runAllTimersAsync();

    // 1 initial + one per backoff delay.
    expect(op).toHaveBeenCalledTimes(RETAG_RETRY_DELAYS_MS.length + 1);
    expect(entries()[0]?.status).toBe('failed');
    // STILL excluded after giving up — content must not surface under the wrong
    // client until the re-tag actually lands.
    expect(getExcludedMatterFolders()).toContain('/ws/Acme');
  });

  it('holds out old-client mail (excludeMailMatters) while a mail re-tag is pending, and clears on success', async () => {
    const scheduler = createRetagScheduler();
    const op = vi.fn().mockResolvedValue(5);

    scheduler.run({
      id: 'mail:m365/acct/Inbox',
      kind: 'mail',
      label: 'mail',
      op,
      excludeMailMatters: ['clientA'],
    });
    expect(getExcludedMailMatters()).toContain('clientA');

    await vi.runAllTimersAsync();

    expect(getExcludedMailMatters()).not.toContain('clientA');
  });

  it('keeps old-client mail held out after a mail re-tag fails (fail closed)', async () => {
    const scheduler = createRetagScheduler();
    const op = vi.fn().mockRejectedValue(new Error('down'));

    scheduler.run({
      id: 'mail:m365/acct/Inbox',
      kind: 'mail',
      label: 'mail',
      op,
      excludeMailMatters: ['clientA'],
    });

    await vi.runAllTimersAsync();

    expect(entries()[0]?.status).toBe('failed');
    expect(getExcludedMailMatters()).toContain('clientA');
  });

  it('removes the folder exclusion once a matter re-tag succeeds', async () => {
    const scheduler = createRetagScheduler();
    const op = vi.fn().mockResolvedValue(3);

    scheduler.run({
      id: 'matter:/ws/Acme',
      kind: 'matter',
      label: 'Acme',
      op,
      excludeFolders: ['/ws/Acme'],
    });
    expect(getExcludedMatterFolders()).toContain('/ws/Acme');

    await vi.runAllTimersAsync();

    expect(getExcludedMatterFolders()).not.toContain('/ws/Acme');
  });

  it('superseding a pending re-tag cancels the old scheduled retry so only the newer scope applies', async () => {
    const scheduler = createRetagScheduler();
    const applied: string[] = [];

    // First run: op1 fails once, capturing the OLD scope in its retry closure.
    const op1 = vi.fn(async () => {
      applied.push('OLD');
      throw new Error('old transient');
    });
    scheduler.run({ id: 'privilege:/ws/s', kind: 'privilege', label: 'old', op: op1 });

    // Let op1's first attempt fail and SCHEDULE a retry (old closure armed).
    await vi.advanceTimersByTimeAsync(0);
    expect(op1).toHaveBeenCalledTimes(1);
    expect(entries()[0]?.label).toBe('old');

    // The SAME scope changes again before the old retry fires: supersede it.
    const op2 = vi.fn(async () => {
      applied.push('NEW');
    });
    scheduler.run({ id: 'privilege:/ws/s', kind: 'privilege', label: 'new', op: op2 });
    // The newer intent is now the visible entry.
    expect(entries()[0]?.label).toBe('new');

    await vi.runAllTimersAsync();

    // The OLD op's retry never fired — its stale scope is never re-applied.
    expect(op1).toHaveBeenCalledTimes(1);
    expect(op2).toHaveBeenCalledTimes(1);
    // Only the newer scope was applied, and it was applied last.
    expect(applied).toEqual(['OLD', 'NEW']);
    // The newer op succeeded → the visible state is cleared, not left stale.
    expect(entries()).toHaveLength(0);
  });

  it('a superseded (stale) success does not clear the newer entry or its exclusion (fail closed)', async () => {
    const scheduler = createRetagScheduler();

    // First run: op1 stays in flight; we settle it manually LATER to simulate an
    // old re-tag that resolves only after a newer one has superseded it.
    let resolveOld!: () => void;
    const op1 = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolveOld = res;
        }),
    );
    scheduler.run({
      id: 'matter:/ws/c',
      kind: 'matter',
      label: 'old',
      op: op1,
      excludeFolders: ['/ws/OLD'],
    });

    // The folder is re-scoped to a DIFFERENT client before op1 settles. This
    // newer re-tag stays pending (never resolves in this test) and is the live
    // intent now, holding out its own folder.
    const op2 = vi.fn(() => new Promise<void>(() => {}));
    scheduler.run({
      id: 'matter:/ws/c',
      kind: 'matter',
      label: 'new',
      op: op2,
      excludeFolders: ['/ws/NEW'],
    });
    expect(getExcludedMatterFolders()).toContain('/ws/NEW');

    // The OLD attempt finally settles as a SUCCESS. Unguarded it would call
    // store().remove(id), wiping the newer entry and dropping the exclusion —
    // re-opening the wrong-client exposure QA-44 closes. It must no-op instead.
    resolveOld();
    await vi.advanceTimersByTimeAsync(0);

    expect(entries()).toHaveLength(1);
    expect(entries()[0]?.label).toBe('new');
    expect(entries()[0]?.status).toBe('retrying');
    expect(getExcludedMatterFolders()).toContain('/ws/NEW');
  });

  it('serializes ops per id so a slow superseded op never overwrites a newer one (mutation ordering)', async () => {
    const scheduler = createRetagScheduler();
    // `physical` models the on-disk tag the backend op writes for this id.
    let physical = 'A';

    // op A->B is SLOW: its promise settles only when we call resolveSlow().
    let resolveSlow!: () => void;
    const opB = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolveSlow = () => {
            physical = 'B';
            res();
          };
        }),
    );
    // op B->C is FAST.
    const opC = vi.fn(async () => {
      physical = 'C';
    });

    scheduler.run({
      id: 'mail:folder',
      kind: 'mail',
      label: 'A->B',
      op: opB,
      excludeMailMatters: ['A'],
    });
    // The mapping changes again (B->C) BEFORE the slow A->B op settles.
    scheduler.run({
      id: 'mail:folder',
      kind: 'mail',
      label: 'B->C',
      op: opC,
      excludeMailMatters: ['A', 'B'],
    });

    // Let the microtask chain START the slow op (its executor captures resolveSlow).
    await vi.advanceTimersByTimeAsync(0);
    expect(opB).toHaveBeenCalledTimes(1);
    // The newer op has NOT run yet — it is serialized behind the still-pending op.
    expect(opC).not.toHaveBeenCalled();
    expect(physical).toBe('A');

    // The slow A->B op finally settles LAST (writes B). Without serialization this
    // stale write would land after C succeeded, leaving the mail tagged B under
    // the wrong client.
    resolveSlow();
    await vi.runAllTimersAsync();

    // Because ops are serialized per id, C ran AFTER B — the final on-disk tag is
    // C (the current mapping), never the superseded B.
    expect(opC).toHaveBeenCalledTimes(1);
    expect(physical).toBe('C');
    // The hold cleared only on the current (C) op's success — no wrong-client hold.
    expect(getExcludedMailMatters()).toHaveLength(0);
    expect(entries()).toHaveLength(0);
  });

  it('disposeAll cancels pending retries and clears its own entries (workspace switch safety)', async () => {
    const scheduler = createRetagScheduler();
    const op = vi.fn().mockRejectedValue(new Error('down'));

    scheduler.run({
      id: 'matter:/ws/Acme',
      kind: 'matter',
      label: 'Acme',
      op,
      excludeFolders: ['/ws/Acme'],
    });

    // Let the first attempt fail and schedule a retry, then dispose.
    await vi.advanceTimersByTimeAsync(0);
    const callsBeforeDispose = op.mock.calls.length;
    scheduler.disposeAll();

    await vi.runAllTimersAsync();

    // No further attempts after dispose.
    expect(op).toHaveBeenCalledTimes(callsBeforeDispose);
    // The disposed scheduler's stale state does not leak into the next workspace.
    expect(entries()).toHaveLength(0);
    expect(getExcludedMatterFolders()).not.toContain('/ws/Acme');
  });

  // QA-44 R7-5 (fixed round 7): `runSerialized` chains a same-id op behind the
  // in-flight one; the chained continuation now RE-CHECKS supersession/disposal at
  // the moment it would start, so an op QUEUED before a workspace switch does NOT
  // fire its backend call after `disposeAll()` against whatever workspace is then
  // active on the Rust side (the cross-workspace hazard the module doc promises
  // cancellation makes impossible). Was an `it.fails` documenting the hole.
  it('a same-id op queued behind an in-flight op does not execute after disposeAll', async () => {
    const scheduler = createRetagScheduler();
    let resolveFirst!: (value: unknown) => void;
    const first = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const second = vi.fn().mockResolvedValue(1);

    scheduler.run({ id: 'mail:outlook|a|inbox', kind: 'mail', label: 'a', op: first });
    // Same id again while the first op is still in flight — queued behind it.
    scheduler.run({ id: 'mail:outlook|a|inbox', kind: 'mail', label: 'b', op: second });
    // Workspace switch while the first op is in flight.
    scheduler.disposeAll();

    resolveFirst(1);
    await vi.runAllTimersAsync();

    // The queued op was captured for the CLOSED workspace; firing it now targets
    // whatever workspace is currently active on the Rust side.
    expect(second).not.toHaveBeenCalled();
  });
});
