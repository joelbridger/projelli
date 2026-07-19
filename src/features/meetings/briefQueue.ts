/**
 * The smallest queue that satisfies "background, queued, cancellable":
 * strictly sequential (one model call in flight), cancel clears pending and
 * ignores the in-flight result. The engine cannot abort mid-request; that
 * limitation is honest and documented in the strip's UI copy.
 */

import type { CalendarEventDto } from '@/platform/utils/calendar-commands';
import { generateMeetingBrief } from './generateBrief';
import { briefKey, localDay, useBriefStore } from './briefStore';

export interface BriefJob {
  householdRef: string;
  matterId: string;
  event: CalendarEventDto;
}

let pending: BriefJob[] = [];
let running = false;
let generation = 0; // bumped on cancel; stale completions are ignored

export function cancelBriefQueue(): void {
  pending = [];
  generation += 1;
}

export function enqueueBriefs(jobs: BriefJob[]): void {
  const store = useBriefStore.getState();
  const day = localDay();
  for (const job of jobs) {
    const key = briefKey(day, job.event.id, job.matterId);
    const existing = store.briefs[key];
    if (
      existing &&
      existing.householdRef === job.householdRef &&
      existing.status === 'ready' &&
      !existing.stale
    ) continue;
    if (
      existing && existing.householdRef === job.householdRef &&
      (existing.status === 'pending' || existing.status === 'generating')
    )
      continue;
    if (pending.some((j) =>
      briefKey(day, j.event.id, j.matterId) === key &&
      j.householdRef === job.householdRef
    ))
      continue;
    useBriefStore.getState().upsert({
      key,
      eventId: job.event.id,
      householdRef: job.householdRef,
      matterId: job.matterId,
      day,
      status: 'pending',
      markdown: existing?.markdown ?? '',
      citations: existing?.citations ?? [],
      bullets: existing?.bullets ?? [],
      generatedAt: existing?.generatedAt ?? '',
      stale: false,
      eventTitle: job.event.title,
    });
    pending.push(job);
  }
  void pump();
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (pending.length > 0) {
      const job = pending.shift();
      if (!job) break;
      const gen = generation;
      const key = briefKey(localDay(), job.event.id, job.matterId);
      useBriefStore.getState().setStatus(key, 'generating');
      try {
        const result = await generateMeetingBrief(job.matterId, job.event);
        if (gen !== generation) return; // cancelled while in flight
        useBriefStore.getState().upsert({
          key,
          eventId: job.event.id,
          householdRef: job.householdRef,
          matterId: job.matterId,
          day: localDay(),
          status: 'ready',
          markdown: result.markdown,
          citations: result.citations,
          bullets: result.bullets,
          generatedAt: result.generatedAt,
          stale: false,
          eventTitle: job.event.title,
        });
      } catch (err) {
        if (gen !== generation) return;
        useBriefStore
          .getState()
          .setStatus(
            key,
            'failed',
            err instanceof Error ? err.message : String(err)
          );
      }
    }
  } finally {
    running = false;
  }
}
