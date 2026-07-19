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
import {
  calendarListEvents,
  type CalendarEventDto,
} from '@/platform/utils/calendar-commands';
import {
  buildCalendarMatterMap,
  resolveMattersForCalendarEvent,
} from '@/platform/rag/matterResolver';
import type { Matter } from '@/platform/types/matter';
import { enqueueBriefs, type BriefJob } from './briefQueue';
import { todayWindowUtc } from './todayWindow';

export function jobsForEvents(
  events: CalendarEventDto[],
  matters: Matter[]
): BriefJob[] {
  const map = buildCalendarMatterMap(matters);
  const jobs: BriefJob[] = [];
  for (const event of events) {
    for (const matterId of resolveMattersForCalendarEvent(event, map)) {
      const matter = matters.find((candidate) => candidate.id === matterId);
      for (const householdRef of matter?.crmHouseholdKeys ?? []) {
        jobs.push({ householdRef, matterId, event });
      }
    }
  }
  return jobs;
}

export function useMeetingAutoprep(
  events: CalendarEventDto[],
  matters: Matter[]
): void {
  // matters identity churns on unrelated store writes; key on event
  // CONTENT+matters+taught-keys. codex-review (wave-1c self-review, P2):
  // meetingKeys must be in this signal too — teaching a new key (assigning
  // an unmatched meeting) changes NEITHER the matter id list NOR the event
  // id list, so without it this effect never re-fires and the
  // freshly-matched meeting never gets the brief the UI just promised it.
  //
  // COORDINATOR FINDING (P2): an ID-only signal also misses a re-synced
  // event that KEEPS its id but changes the fields matching actually reads
  // (attendees, organizerEmail, title, time) — e.g. a corrected attendee
  // list or a reschedule. Sign on that content, not just presence, so a
  // same-id event that newly matches (or needs a fresh brief for its new
  // time) re-triggers this effect too.
  const eventsSignature = events
    .map(
      (e) =>
        `${e.id}:${e.title}:${e.startUtc}:${e.organizerEmail}:${e.attendees
          .map((a) => a.email)
          .join('+')}`
    )
    .join('|');
  const matterIdsKey = matters.map((m) => m.id).join(',');
  const meetingKeysKey = matters
    .map((m) => (m.meetingKeys ?? []).join('+'))
    .join('|');

  useEffect(() => {
    if (events.length === 0) return;
    enqueueBriefs(jobsForEvents(events, matters));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsSignature, matterIdsKey, meetingKeysKey]);
}

export const RESCAN_INTERVAL_MS = 5 * 60 * 1000;

/**
 * v2 trigger: while the app is running, rescan today's calendar every few
 * minutes so meetings added during the day get briefs too. The app must be
 * open — there is deliberately no OS-level scheduler, and the UI says so.
 *
 * @param onError - QA-48: called (with no payload) whenever a rescan's
 * calendarListEvents call fails, so the caller can surface a visible
 * "calendar check failed" state instead of the failure reading as a silent
 * "no events this cycle" no-op (which is what happens internally here — a
 * failed fetch skips enqueueing, same as a genuinely empty calendar, but the
 * caller now gets told the difference).
 */
export function useAutoprepRescan(matters: Matter[], onError?: () => void): void {
  const matterIdsKey = matters.map((m) => m.id).join(',');
  // codex-review P2: same class of bug already fixed in useMeetingAutoprep
  // above — teaching/moving a meeting key changes no matter id, so without
  // signing on meetingKeys too the interval keeps matching events against a
  // stale key set until the strip remounts.
  const meetingKeysKey = matters
    .map((m) => (m.meetingKeys ?? []).join('+'))
    .join('|');

  useEffect(() => {
    let cancelled = false;
    const timer = setInterval(() => {
      void (async () => {
        const { fromUtc, toUtc } = todayWindowUtc();
        const events = await calendarListEvents(fromUtc, toUtc).catch((err: unknown) => {
          console.error('[useAutoprepRescan] calendar fetch failed:', err);
          onError?.();
          return null;
        });
        if (cancelled || events === null) return;
        if (events.length > 0) {
          enqueueBriefs(jobsForEvents(events, matters));
        }
      })();
    }, RESCAN_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matterIdsKey, meetingKeysKey]);
}
