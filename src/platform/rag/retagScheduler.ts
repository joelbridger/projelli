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
  /** The re-tag operation. Rejecting triggers a retry; resolving clears it. */
  op: () => Promise<unknown>;
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
  let disposed = false;

  const store = () => useScopeUpdateStore.getState();

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
    task
      .op()
      .then(() => {
        // A superseded attempt must NOT clear the entry — a newer run() has
        // re-registered this id, and removing it would drop the newer intent
        // (and its fail-closed exclusion).
        if (superseded(task.id, generation)) return;
        store().remove(task.id);
        owned.delete(task.id);
        generations.delete(task.id);
        clearTimersFor(task.id);
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
      // Remove only THIS scheduler's entries so a stale failure banner (and its
      // folder exclusion) from a closed workspace can't bleed into the next one.
      store().removeMany(Array.from(owned));
      owned.clear();
    },
  };
}
