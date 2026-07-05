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
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const owned = new Set<string>();
  let disposed = false;

  const store = () => useScopeUpdateStore.getState();

  const attempt = (task: RetagTask, retryCount: number): void => {
    task
      .op()
      .then(() => {
        if (disposed) return;
        store().remove(task.id);
        owned.delete(task.id);
      })
      .catch((err: unknown) => {
        if (disposed) return;
        if (retryCount < RETAG_RETRY_DELAYS_MS.length) {
          const timer = setTimeout(() => {
            timers.delete(timer);
            attempt(task, retryCount + 1);
          }, RETAG_RETRY_DELAYS_MS[retryCount]);
          timers.add(timer);
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
      owned.add(task.id);
      store().begin({
        id: task.id,
        kind: task.kind,
        label: task.label,
        excludeFolders: task.excludeFolders ?? [],
        excludeMailMatters: task.excludeMailMatters ?? [],
      });
      attempt(task, 0);
    },

    disposeAll() {
      disposed = true;
      timers.forEach((timer) => {
        clearTimeout(timer);
      });
      timers.clear();
      // Remove only THIS scheduler's entries so a stale failure banner (and its
      // folder exclusion) from a closed workspace can't bleed into the next one.
      store().removeMany(Array.from(owned));
      owned.clear();
    },
  };
}
