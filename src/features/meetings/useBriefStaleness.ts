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
import { isValidMeetingBrief, useBriefStore } from './briefStore';
import { enqueueBriefs } from './briefQueue';
import { jobsForEvents } from './useMeetingAutoprep';
import { todayWindowUtc } from './todayWindow';
import type { SealedMeetingClientBoundary } from './foundation/contract';

const REQUEUE_DEBOUNCE_MS = 30_000;

export function markBriefsStaleForPath(
  path: string,
  matters: Matter[]
): readonly SealedMeetingClientBoundary[] | null {
  const matterId = resolveMatterId(path, matters);
  if (!matterId || matterId === UNASSIGNED_MATTER_ID) return null;
  const matter = matters.find((candidate) => candidate.id === matterId);
  const allowedHouseholds = new Set(
    (matter?.crmHouseholdKeys ?? [])
      .map((value) => value.trim())
      .filter(Boolean)
  );
  if (allowedHouseholds.size === 0) return null;

  const affected = new Map<string, SealedMeetingClientBoundary>();
  for (const brief of Object.values(useBriefStore.getState().briefs)) {
    if (
      !isValidMeetingBrief(brief) ||
      brief.matterId !== matterId ||
      !allowedHouseholds.has(brief.householdRef) ||
      brief.status !== 'ready' ||
      brief.stale
    )
      continue;
    const clientBoundary = {
      householdRef: brief.householdRef,
      matterId: brief.matterId,
    } as SealedMeetingClientBoundary;
    useBriefStore.getState().markStale({
      clientBoundary,
      eventId: brief.eventId,
      day: brief.day,
    });
    affected.set(
      `${brief.householdRef}\u0000${brief.matterId}`,
      clientBoundary
    );
  }
  return affected.size > 0 ? [...affected.values()] : null;
}

export function useBriefStaleness(): void {
  useEffect(() => {
    let stop: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const staleClients = new Map<string, SealedMeetingClientBoundary>();

    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        stop = await listen<{ path: string; kind: string }>(
          'workspace-file-changed',
          (event) => {
            const { path, kind } = event.payload;
            if (!path || kind === 'delete') return;
            const matters = useMatterStore.getState().matters;
            const affectedClients = markBriefsStaleForPath(path, matters);
            if (!affectedClients) return;
            for (const clientBoundary of affectedClients) {
              staleClients.set(
                `${clientBoundary.householdRef}\u0000${clientBoundary.matterId}`,
                clientBoundary
              );
            }
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
              void (async () => {
                const affected = new Set(staleClients.keys());
                staleClients.clear();
                const { fromUtc, toUtc } = todayWindowUtc();
                const events = await calendarListEvents(fromUtc, toUtc).catch(
                  () => []
                );
                const jobs = jobsForEvents(
                  events,
                  useMatterStore.getState().matters
                ).filter((job) =>
                  affected.has(
                    `${job.clientBoundary.householdRef}\u0000${job.clientBoundary.matterId}`
                  )
                );
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
