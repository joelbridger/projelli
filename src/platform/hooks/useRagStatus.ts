/**
 * useRagStatus — subscribe to the `rag-indexing-progress` Tauri event.
 *
 * Returns a snapshot of the indexer state for the status bar badge and the
 * indexing banner. In browser/test mode the listener is a no-op; the hook
 * stays in its `idle` initial state so test runs don't need to mock the
 * event API.
 */

import { useEffect, useState } from 'react';
import {
  RAG_PROGRESS_EVENT,
  type RagIndexingProgress,
  type RagIndexingStatus,
} from '@/platform/utils/tauri-commands';

export interface RagStatusSnapshot {
  status: RagIndexingStatus;
  processed: number;
  total: number;
  currentPath: string | null;
  /** BUG-099: total files skipped (= failed + timedOut). Each file counted once.
   *  The banner uses `indexed = total - skipped` for an honest count. */
  skipped: number;
  /** Of skipped: extraction / embedding failures. */
  failed: number;
  /** Of skipped: per-file timeout hits (the original BUG-099 stall). */
  timedOut: number;
  /** BUG-099 separate counter: of skipped files, those whose stale-row cleanup
   *  also failed (tombstoned so retrieval cannot serve their stale rows).
   *  Already counted in `skipped` -- do NOT subtract again for the indexed count. */
  cleanupFailed: number;
  /** Paths of skipped files (capped to 100 by the Rust layer). */
  skippedPaths: string[];
  /** P1.1 (Task 2): a one-time schema-migration rebuild is running → the banner
   *  says "Upgrading search index…" instead of a routine "Memory updating". */
  migrating: boolean;
  /** P1.1 (Task 4): files a boot reconcile skipped as unchanged (work avoided). */
  reused: number;
  /** P1.1 (Task 4): files a boot reconcile re-indexed (new/changed). */
  reindexed: number;
  /** P1.1 (Task 4): sources purged because their file was deleted. */
  deleted: number;
}

const INITIAL: RagStatusSnapshot = {
  status: 'idle',
  processed: 0,
  total: 0,
  currentPath: null,
  skipped: 0,
  failed: 0,
  timedOut: 0,
  cleanupFailed: 0,
  skippedPaths: [],
  migrating: false,
  reused: 0,
  reindexed: 0,
  deleted: 0,
};

/**
 * Subscribe to indexing progress. Returns the latest snapshot received.
 *
 * The Tauri event API is dynamically imported so the hook works in
 * Vitest without `@tauri-apps/api/event` being available — when not in a
 * Tauri context, `isTauri()` returns false and the import is skipped.
 */
export function useRagStatus(): RagStatusSnapshot {
  const [snapshot, setSnapshot] = useState<RagStatusSnapshot>(INITIAL);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    void (async () => {
      try {
        const core = await import('@tauri-apps/api/core');
        if (!core.isTauri()) return;
        const { listen } = await import('@tauri-apps/api/event');
        const stop = await listen<RagIndexingProgress>(
          RAG_PROGRESS_EVENT,
          (event) => {
            const p = event.payload;
            setSnapshot({
              status: p.status,
              processed: p.processed,
              total: p.total,
              currentPath: p.currentPath ?? null,
              // BUG-099: thread skip counts through to the banner so it can
              // display "Memory ready (N files skipped)" instead of a plain
              // "Memory ready." The Rust side uses 0 as the default so these
              // are always defined once the event fires.
              skipped: p.skipped ?? 0,
              failed: p.failed ?? 0,
              timedOut: p.timedOut ?? 0,
              // cleanupFailed is omitted from the wire when zero (skip_serializing_if).
              cleanupFailed: p.cleanupFailed ?? 0,
              skippedPaths: p.skippedPaths ?? [],
              // P1.1: reconcile / migration signals (omitted from the wire when
              // falsey/zero, so default here).
              migrating: p.migrating ?? false,
              reused: p.reused ?? 0,
              reindexed: p.reindexed ?? 0,
              deleted: p.deleted ?? 0,
            });
          },
        );
        if (cancelled) {
          stop();
        } else {
          unlisten = stop;
        }
      } catch {
        // Tauri event API unavailable (browser / test) — leave at idle.
      }
    })();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  return snapshot;
}
