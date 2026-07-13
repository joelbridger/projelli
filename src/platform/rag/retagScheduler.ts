/**
 * Re-tag scheduler (QA-44) — durable retry-with-backoff for RAG scope updates.
 *
 * The three RAG re-tag reactions (folder->matter re-index, mail folder->matter
 * re-tag, source privilege re-tag) used to be fire-and-forget with a swallowed
 * `.catch(() => {})`: a transient failure permanently left the index on the OLD
 * tag while the UI claimed the new rule was live. That is a privilege leak (a
 * source stays retrievable in normal Ask) or a wrong-client leak (content stays
 * scoped to the old matter).
 *
 * This scheduler runs each re-tag op, retries it with backoff on failure, and
 * drives `scopeUpdateStore` so the update is VISIBLE (retrying / failed) and,
 * for matter re-tags, keeps the affected folders excluded from retrieval until
 * the op finally succeeds.
 *
 * Ownership + cancellation: one scheduler is owned per workspace mount. On a
 * workspace close/switch the mount calls `disposeAll()`, which cancels every
 * pending retry AND removes this scheduler's status entries. This mirrors the
 * index retry scheduler's discipline for the same reason: a re-tag op captured
 * for workspace A (e.g. `MemoryService.retagPrivilege`) targets whatever
 * workspace is CURRENTLY active on the Rust side, so an uncancelled retry that
 * fired after a switch would re-tag the NEW workspace's content — a cross-client
 * hazard. Cancellation makes that impossible.
 *
 * Supersession (same-id re-run): if the SAME scope changes again before its
 * previous re-tag settles, `run()` must supersede the old work for that id — not
 * run alongside it. Each id carries a monotonic generation; `run()` bumps it and
 * cancels the prior attempt's pending retry timer, and every attempt no-ops once
 * its captured generation is stale. Without this, an old attempt's closure (with
 * the OLD privilege/client) could apply a stale scope value on a late retry, or
 * its settled promise could `remove`/`markFailed` the store entry that now
 * represents the NEWER intent — clearing the newer entry or dropping its
 * fail-closed exclusion while rows are still tagged old, re-opening the exact
 * wrong-client exposure this scheduler exists to close.
 *
 * Mutation ordering (Codex round 6): the generation guard protects only the
 * STATUS cleanup, NOT the physical backend side effect. A superseded op's
 * `op()` still runs to completion, so a SLOW stale op could re-tag rows AFTER a
 * newer op already succeeded — e.g. mail A->B (slow) then B->C (fast, clears the
 * hold); the late A->B write lands last and leaves the mail physically tagged B
 * while the mapping is C (visible under the wrong client until the next boot
 * reconcile). To make that impossible, each id's ops are SERIALIZED: a newer
 * `run()`'s op does not start until the prior op for that id has SETTLED, so the
 * physical writes for one id always land in `run()` order and the final on-disk
 * tag is always the newest generation's. The invariant: after ALL in-flight ops
 * for an id settle in ANY arrival order, the rows are tagged to the CURRENT
 * mapping, never a superseded one.
 */

import { useScopeUpdateStore, type ScopeUpdateKind } from '@/platform/rag/scopeUpdateStore';

/**
 * Backoff delays between re-tag attempts (ms). Three retries over ~10s rides out
 * a transient backend hiccup (a lock held a moment too long, an IPC blip)
 * without hammering a genuinely-down backend forever. After the last delay the
 * update is marked 'failed' (still visible, still fail-closed).
 */
export const RETAG_RETRY_DELAYS_MS = [500, 2000, 8000];

export interface RetagTask {
  /** Stable id — a re-run with the same id replaces the prior visible entry. */
  id: string;
  kind: ScopeUpdateKind;
  /** Plain-language label for the banner. */
  label: string;
  /** The re-tag operation. Rejecting triggers a retry; resolving clears it.
   *  `isSuperseded()` reports whether a NEWER `run()` for this id has replaced
   *  this attempt (or the scheduler was disposed). An op that clears a DURABLE,
   *  cross-session hold OUTSIDE the scheduler's own status store MUST check it
   *  before releasing — an older op body still runs to completion (serialization
   *  only delays the next op, it can't abort a running one), so without the guard
   *  a stale generation would clear the hold the newest intent still relies on.
   *  The scheduler already guards its OWN status cleanup this way. */
  op: (isSuperseded: () => boolean) => Promise<unknown>;
  /** Matter folders to exclude from retrieval while this is pending/failed. */
  excludeFolders?: string[];
  /** Matter ids whose mail to hold out of retrieval while this is pending/failed
   *  (a mail folder moved between clients). */
  excludeMailMatters?: string[];
}

export interface RetagScheduler {
  /** Run a re-tag with retry/backoff, tracking its status in the store. */
  run: (task: RetagTask) => void;
  /** Cancel every pending retry and remove this scheduler's status entries. */
  disposeAll: () => void;
}

/**
 * Create a re-tag scheduler owned by one workspace mount. See the module doc for
 * why cancellation on workspace switch is mandatory.
 */
export function createRetagScheduler(): RetagScheduler {
  const owned = new Set<string>();
  // Per-id monotonic generation. `run()` bumps it; an attempt captures its
  // generation and no-ops once superseded, so a stale (old-scope) closure can
  // neither apply its value nor mutate this id's store entry.
  const generations = new Map<string, number>();
  // Per-id pending retry timers, so a fresh `run()` for the same id can cancel
  // exactly that id's armed retry (and `disposeAll()` can cancel every id's).
  const timersById = new Map<string, Set<ReturnType<typeof setTimeout>>>();
  // Per-id "op tail": a promise that settles when the id's last-started op has
  // settled. A newer op chains after it so physical writes for one id land in
  // run() order (see the module doc's "Mutation ordering").
  const opTails = new Map<string, Promise<unknown>>();
  let disposed = false;

  const store = () => useScopeUpdateStore.getState();

  /**
   * Run `op` SERIALIZED per id: start it only AFTER any prior op for the same id
   * has SETTLED, so a superseded slow op can never overwrite a newer one's tag.
   * The tail tracks settlement (success OR failure) so the chain never stalls on
   * a rejection.
   */
  const runSerialized = (
    id: string,
    generation: number,
    op: () => Promise<unknown>,
  ): Promise<unknown> => {
    const prior = opTails.get(id);
    // No in-flight op for this id → start immediately (synchronously, as before).
    // Otherwise chain AFTER the prior op settles so its physical write can't land
    // after ours.
    //
    // QA-44 (R7-5): a QUEUED op must re-check supersession/disposal AT THE MOMENT
    // IT WOULD START, not only when it was enqueued. Cancellation cancels pending
    // retry TIMERS, but it cannot reach into a promise already chained behind an
    // in-flight op — so without this guard an op queued just before a workspace
    // switch still fires its backend call after `disposeAll()`, tagging the
    // NOW-active workspace's content with the closed workspace's target (a
    // cross-workspace leak the scheduler's own doc claims is impossible). Skipping
    // a superseded queued op is also a pure efficiency win: its physical write is
    // a guaranteed no-op (a newer op for this id already ran, or the scheduler is
    // gone), so running it can only do harm.
    const run = prior
      ? prior.then(() => (superseded(id, generation) ? undefined : op()))
      : op();
    opTails.set(
      id,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  };

  /** Cancel and forget every pending retry timer for one id. */
  const clearTimersFor = (id: string): void => {
    const set = timersById.get(id);
    if (!set) return;
    set.forEach((timer) => {
      clearTimeout(timer);
    });
    timersById.delete(id);
  };

  /** True once this attempt's generation is no longer the live one for its id
   *  (a newer `run()` superseded it, or the scheduler was disposed). */
  const superseded = (id: string, generation: number): boolean =>
    disposed || generations.get(id) !== generation;

  const attempt = (task: RetagTask, retryCount: number, generation: number): void => {
    // Bind this attempt's generation into the supersession check the op sees, so
    // an op that clears an out-of-band durable hold can no-op once a newer run()
    // has taken over this id (see RetagTask.op).
    const guardedOp = (): Promise<unknown> => task.op(() => superseded(task.id, generation));
    runSerialized(task.id, generation, guardedOp)
      .then(() => {
        // A superseded attempt must NOT clear the entry — a newer run() has
        // re-registered this id, and removing it would drop the newer intent
        // (and its fail-closed exclusion). Serialization guarantees this
        // (current) op ran AFTER any superseded one, so the on-disk tag it just
        // wrote is the newest — safe to clear the hold.
        if (superseded(task.id, generation)) return;
        store().complete(task.id);
        owned.delete(task.id);
        generations.delete(task.id);
        clearTimersFor(task.id);
        opTails.delete(task.id);
      })
      .catch((err: unknown) => {
        // A superseded failing attempt must NOT schedule a retry (its closure
        // holds the OLD scope) nor mark the newer entry failed.
        if (superseded(task.id, generation)) return;
        if (retryCount < RETAG_RETRY_DELAYS_MS.length) {
          const timer = setTimeout(() => {
            const set = timersById.get(task.id);
            if (set) {
              set.delete(timer);
              if (set.size === 0) timersById.delete(task.id);
            }
            if (superseded(task.id, generation)) return;
            attempt(task, retryCount + 1, generation);
          }, RETAG_RETRY_DELAYS_MS[retryCount]);
          let set = timersById.get(task.id);
          if (!set) {
            set = new Set();
            timersById.set(task.id, set);
          }
          set.add(timer);
        } else {
          // Retries exhausted. Keep the entry (and its folder exclusion) so the
          // failure stays visible AND fail-closed; the next boot reconcile heals
          // the index on reopen.
          store().markFailed(task.id);
          console.error(
            `[memory] search scope update "${task.label}" failed after ` +
              `${String(retryCount + 1)} attempts; it is excluded from retrieval ` +
              'until it succeeds (the next reconcile will retry it)',
            err,
          );
        }
      });
  };

  return {
    run(task) {
      if (disposed) return;
      // Supersede any in-flight attempt / armed retry for the same id before
      // starting the new one: bump the generation (so the old attempt's settled
      // promise no-ops) and cancel its pending retry timer (so the old closure —
      // capturing the OLD privilege/client — can never fire).
      const generation = (generations.get(task.id) ?? 0) + 1;
      generations.set(task.id, generation);
      clearTimersFor(task.id);
      owned.add(task.id);
      store().begin({
        id: task.id,
        kind: task.kind,
        label: task.label,
        excludeFolders: task.excludeFolders ?? [],
        excludeMailMatters: task.excludeMailMatters ?? [],
      });
      attempt(task, 0, generation);
    },

    disposeAll() {
      disposed = true;
      timersById.forEach((set) => {
        set.forEach((timer) => {
          clearTimeout(timer);
        });
      });
      timersById.clear();
      generations.clear();
      opTails.clear();
      // Remove only THIS scheduler's entries so a stale failure banner (and its
      // folder exclusion) from a closed workspace can't bleed into the next one.
      store().removeMany(Array.from(owned));
      owned.clear();
    },
  };
}
