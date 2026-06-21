/**
 * WriteCoordinator — serializes file writes PER PATH so the save path can't lose
 * data (BUG-045).
 *
 * The bug it fixes: autosave (every 2s) and manual/AI saves both wrote a file and
 * then marked the tab clean, with NO coordination. Two writes to the same path
 * could run concurrently and finish out of order — a slow earlier write landing
 * AFTER a newer one puts STALE content on disk — and the tab was marked clean
 * regardless of whether the on-disk content was actually current.
 *
 * This coordinator guarantees:
 *   1. Writes to the SAME path run one-at-a-time, in enqueue order (so a slow
 *      write can never overwrite a newer one).
 *   2. Writes to DIFFERENT paths run concurrently (no global bottleneck).
 *   3. Each completed write reports `isLatest` — true only if no newer revision
 *      for that path was enqueued before it finished. The caller uses this (plus
 *      a live re-check of the tab's current revision in `markSaved`) to decide
 *      whether it's safe to mark the tab clean.
 *
 * A failing write rejects to ITS caller but never wedges the path's queue — the
 * next write to that path still runs.
 *
 * `rev` is a monotonically-increasing content revision supplied by the caller
 * (the editor store bumps it on every edit). It is opaque to the coordinator
 * beyond "higher = newer".
 */

export interface WriteResult {
  /** The write callback ran to completion. */
  written: boolean;
  /** No newer revision for this path had been enqueued when this write finished. */
  isLatest: boolean;
}

export class WriteCoordinator {
  /** Per-path tail of the serialized write chain (always non-rejecting). */
  private readonly tail = new Map<string, Promise<unknown>>();
  /** Highest revision enqueued so far per path. */
  private readonly maxRev = new Map<string, number>();

  /**
   * Enqueue a write for `path`. `write` performs the actual disk write of the
   * content captured at `rev`. Resolves with whether the write ran and whether
   * it was still the latest revision at completion. Rejects (to this caller
   * only) if `write` throws.
   */
  enqueue(path: string, rev: number, write: () => Promise<void>): Promise<WriteResult> {
    this.maxRev.set(path, Math.max(this.maxRev.get(path) ?? rev, rev));
    const prev = this.tail.get(path) ?? Promise.resolve();
    const run = prev.then(async (): Promise<WriteResult> => {
      await write();
      const isLatest = rev >= (this.maxRev.get(path) ?? rev);
      return { written: true, isLatest };
    });
    // The tail must never reject (a rejected tail would break the NEXT write's
    // `.then` chain). Swallow here; the real result/rejection goes to `run`.
    this.tail.set(
      path,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  /**
   * Await in-flight writes — one path, or all paths when `path` is omitted.
   * Used by `flushAllDirtyTabs` so a workspace switch / app close waits for
   * pending saves to land. Never rejects.
   */
  async drain(path?: string): Promise<void> {
    if (path !== undefined) {
      await this.tail.get(path)?.catch(() => undefined);
      return;
    }
    await Promise.allSettled([...this.tail.values()]);
  }
}

/**
 * App-wide singleton. Every save path (autosave, manual save, and — later —
 * AI/tool/workflow writes) routes through this one instance so writes to the
 * same file are globally serialized.
 */
export const writeCoordinator = new WriteCoordinator();
