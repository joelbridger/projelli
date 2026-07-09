/**
 * Cache of generated "Before you meet" briefs. Derived work product (like
 * the at-a-glance cache) keyed by local day + event + matter. Persisted so
 * an app restart the same morning does not regenerate everything.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SK_MEETING_BRIEFS } from '@/config/identity';
import type { MeetingBriefBullet } from './generateBrief';

export type BriefStatus = 'pending' | 'generating' | 'ready' | 'failed';

export interface MeetingBrief {
  key: string;
  eventId: string;
  matterId: string;
  day: string;
  status: BriefStatus;
  markdown: string;
  citations: { path: string; score: number }[];
  /** Optional: absent on briefs persisted before this field existed. */
  bullets?: MeetingBriefBullet[];
  generatedAt: string;
  stale: boolean;
  /** Demo-only briefs can stay visible when the sample client is opened on a later day. */
  isSample?: boolean;
  error?: string;
  /** The calendar event's title, captured at enqueue time — Task 17b's
   *  agenda export needs it and shouldn't have to re-fetch the event just
   *  to read a label it already had when the job was queued. */
  eventTitle: string;
}

export function localDay(d: Date = new Date()): string {
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function briefKey(
  day: string,
  eventId: string,
  matterId: string
): string {
  return `${day}:${eventId}:${matterId}`;
}

interface BriefStoreState {
  briefs: Record<string, MeetingBrief>;
  upsert: (brief: MeetingBrief) => void;
  setStatus: (key: string, status: BriefStatus, error?: string) => void;
  markStaleForMatter: (matterId: string) => void;
}

export const useBriefStore = create<BriefStoreState>()(
  persist(
    (set) => ({
      briefs: {},
      upsert: (brief) =>
        set((s) => ({ briefs: { ...s.briefs, [brief.key]: brief } })),
      setStatus: (key, status, error) =>
        set((s) => {
          const existing = s.briefs[key];
          if (!existing) return s;
          // exactOptionalPropertyTypes: an omitted `error` (e.g. moving to
          // 'generating' after a prior 'failed') must drop the key entirely,
          // not carry it over as an explicit `undefined`.
          const { error: _prevError, ...rest } = existing;
          const updated: MeetingBrief =
            error === undefined
              ? { ...rest, status }
              : { ...rest, status, error };
          return { briefs: { ...s.briefs, [key]: updated } };
        }),
      markStaleForMatter: (matterId) =>
        set((s) => {
          const briefs = { ...s.briefs };
          for (const [k, b] of Object.entries(briefs)) {
            if (b.matterId === matterId && b.status === 'ready') {
              briefs[k] = { ...b, stale: true };
            }
          }
          return { briefs };
        }),
    }),
    { name: SK_MEETING_BRIEFS }
  )
);
