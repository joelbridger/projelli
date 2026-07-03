/**
 * v1 trigger: when Client Map first mounts (app open), queue a brief for
 * every matched meeting today. Runs once per mount; re-runs when a calendar
 * sync completes (the strip refetches and calls this again via effect deps).
 *
 * NOT YET MOUNTED ANYWHERE: TodaysMeetingsStrip.tsx (Task 13) is held
 * pending the Wave 0 Client Map merge. This hook is self-contained and
 * tested standalone; wiring it in is Task 13's one-line addition.
 */

import { useEffect } from 'react';
import type { CalendarEventDto } from '@/platform/utils/calendar-commands';
import {
  buildCalendarMatterMap,
  resolveMattersForCalendarEvent,
} from '@/platform/rag/matterResolver';
import type { Matter } from '@/platform/types/matter';
import { enqueueBriefs, type BriefJob } from './briefQueue';

export function jobsForEvents(
  events: CalendarEventDto[],
  matters: Matter[]
): BriefJob[] {
  const map = buildCalendarMatterMap(matters);
  const jobs: BriefJob[] = [];
  for (const event of events) {
    for (const matterId of resolveMattersForCalendarEvent(event, map)) {
      jobs.push({ matterId, event });
    }
  }
  return jobs;
}

export function useMeetingAutoprep(
  events: CalendarEventDto[],
  matters: Matter[]
): void {
  // matters identity churns on unrelated store writes; key on ids+events
  // +taught-keys. codex-review (wave-1c self-review, P2): meetingKeys must
  // be in this signal too — teaching a new key (assigning an unmatched
  // meeting) changes NEITHER the matter id list NOR the event id list, so
  // without it this effect never re-fires and the freshly-matched meeting
  // never gets the brief the UI just promised it.
  const eventIdsKey = events.map((e) => e.id).join(',');
  const matterIdsKey = matters.map((m) => m.id).join(',');
  const meetingKeysKey = matters
    .map((m) => (m.meetingKeys ?? []).join('+'))
    .join('|');

  useEffect(() => {
    if (events.length === 0) return;
    enqueueBriefs(jobsForEvents(events, matters));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventIdsKey, matterIdsKey, meetingKeysKey]);
}
