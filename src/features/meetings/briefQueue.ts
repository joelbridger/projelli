/**
 * The smallest queue that satisfies "background, queued, cancellable":
 * strictly sequential (one model call in flight), cancel clears pending and
 * ignores the in-flight result. The engine cannot abort mid-request; that
 * limitation is honest and documented in the strip's UI copy.
 */

import type { CalendarEventDto } from '@/platform/utils/calendar-commands';
import { generateMeetingBrief } from './generateBrief';
import {
  briefKey,
  isValidMeetingBrief,
  localDay,
  useBriefStore,
  type ExactMeetingBriefIdentity,
} from './briefStore';
import type { SealedMeetingClientBoundary } from './foundation/contract';

export interface BriefJob {
  readonly clientBoundary: SealedMeetingClientBoundary;
  readonly event: CalendarEventDto;
}

interface QueuedBriefJob extends BriefJob {
  readonly identity: ExactMeetingBriefIdentity;
}

let pending: QueuedBriefJob[] = [];
let running = false;
let generation = 0; // bumped on cancel; stale completions are ignored

export function cancelBriefQueue(): void {
  pending = [];
  generation += 1;
}

export function enqueueBriefs(jobs: BriefJob[]): void {
  const store = useBriefStore.getState();
  const day = localDay();
  // Validate the whole batch before the first write. A missing/partial/empty
  // pair or event therefore rejects the call without leaving half a batch in
  // the store.
  const exactJobs: QueuedBriefJob[] = jobs.map((job) => {
    const identity: ExactMeetingBriefIdentity = {
      clientBoundary: job.clientBoundary,
      eventId: job.event.id,
      day,
    };
    void briefKey(identity);
    return { ...job, identity };
  });
  for (const job of exactJobs) {
    const key = briefKey(job.identity);
    const existing = store.briefs[key];
    if (
      existing &&
      isValidMeetingBrief(existing) &&
      existing.status === 'ready' &&
      !existing.stale
    )
      continue;
    if (
      existing &&
      isValidMeetingBrief(existing) &&
      (existing.status === 'pending' || existing.status === 'generating')
    )
      continue;
    if (pending.some((queued) => briefKey(queued.identity) === key)) continue;
    useBriefStore.getState().upsert(job.identity, {
      status: 'pending',
      markdown: isValidMeetingBrief(existing) ? existing.markdown : '',
      citations: isValidMeetingBrief(existing) ? existing.citations : [],
      bullets: isValidMeetingBrief(existing) ? (existing.bullets ?? []) : [],
      generatedAt: isValidMeetingBrief(existing) ? existing.generatedAt : '',
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
      useBriefStore.getState().setStatus(job.identity, 'generating');
      try {
        const result = await generateMeetingBrief(
          job.clientBoundary.matterId,
          job.event
        );
        if (gen !== generation) return; // cancelled while in flight
        useBriefStore.getState().upsert(job.identity, {
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
            job.identity,
            'failed',
            err instanceof Error ? err.message : String(err)
          );
      }
    }
  } finally {
    running = false;
  }
}
