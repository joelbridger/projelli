/**
 * When a new document lands in a client's folder (global
 * `workspace-file-changed` event; payload has no matter id), resolve the
 * path to its matter, mark that client's ready briefs stale, and re-queue
 * them debounced — the indexer needs a moment to ingest the new file anyway.
 *
 * NOT YET MOUNTED ANYWHERE: TodaysMeetingsStrip.tsx (Task 13) is held
 * pending the Wave 0 Client Map merge; wiring `useBriefStaleness()` in is
 * Task 13's one-line addition.
 */

import { useEffect } from 'react';
import { resolveMatterId } from '@/platform/rag/matterResolver';
import { UNASSIGNED_MATTER_ID, type Matter } from '@/platform/types/matter';
import { useMatterStore } from '@/platform/matter/matterStore';
import { calendarListEvents } from '@/platform/utils/calendar-commands';
import { useBriefStore } from './briefStore';
import { enqueueBriefs } from './briefQueue';
import { jobsForEvents } from './useMeetingAutoprep';
import { todayWindowUtc } from './todayWindow';

const REQUEUE_DEBOUNCE_MS = 30_000;

export function markBriefsStaleForPath(
  path: string,
  matters: Matter[]
): string | null {
  const matterId = resolveMatterId(path, matters);
  if (!matterId || matterId === UNASSIGNED_MATTER_ID) return null;
  const hasReady = Object.values(useBriefStore.getState().briefs).some(
    (b) => b.matterId === matterId && b.status === 'ready' && !b.stale
  );
  if (!hasReady) return null;
  useBriefStore.getState().markStaleForMatter(matterId);
  return matterId;
}

export function useBriefStaleness(): void {
  useEffect(() => {
    let stop: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const staleMatters = new Set<string>();

    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        stop = await listen<{ path: string; kind: string }>(
          'workspace-file-changed',
          (event) => {
            const { path, kind } = event.payload;
            if (!path || kind === 'delete') return;
            const matters = useMatterStore.getState().matters;
            const matterId = markBriefsStaleForPath(path, matters);
            if (!matterId) return;
            staleMatters.add(matterId);
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
              void (async () => {
                const affected = new Set(staleMatters);
                staleMatters.clear();
                const { fromUtc, toUtc } = todayWindowUtc();
                const events = await calendarListEvents(fromUtc, toUtc).catch(
                  () => []
                );
                const jobs = jobsForEvents(
                  events,
                  useMatterStore.getState().matters
                ).filter((j) => affected.has(j.matterId));
                enqueueBriefs(jobs);
              })();
            }, REQUEUE_DEBOUNCE_MS);
          }
        );
      } catch {
        /* not in Tauri */
      }
    })();
    return () => {
      stop?.();
      if (timer) clearTimeout(timer);
    };
  }, []);
}
