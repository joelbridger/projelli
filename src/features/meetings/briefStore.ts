/**
 * Cache of generated "Before you meet" briefs. Derived work product (like
 * the at-a-glance cache) keyed by local day + exact event + the complete
 * household/matter client boundary. Persisted so an app restart the same
 * morning does not regenerate everything.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SK_MEETING_BRIEFS } from '@/config/identity';
import type { MeetingBriefBullet } from './generateBrief';
import type {
  MeetingProjection,
  SealedMeetingClientBoundary,
} from './foundation/contract';

export type BriefStatus = 'pending' | 'generating' | 'ready' | 'failed';

export interface MeetingBrief {
  key: string;
  eventId: string;
  householdRef: string;
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
  /** The calendar event's title, captured at enqueue time. */
  eventTitle: string;
}

export type MeetingBriefDraft = Omit<
  MeetingBrief,
  'key' | 'eventId' | 'householdRef' | 'matterId' | 'day'
>;

export function localDay(d: Date = new Date()): string {
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Complete identity required by every brief-store write. */
export interface ExactMeetingBriefIdentity {
  /** Sealed household + matter authority; neither half may be omitted. */
  readonly clientBoundary: SealedMeetingClientBoundary;
  /** Exact canonical calendar-event reference. */
  readonly eventId: string;
  /** Local calendar day on which the brief belongs. */
  readonly day: string;
}

function requiredIdentityPart(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Meeting brief ${label} is required.`);
  }
  return value.trim();
}

function normalizedIdentity(identity: ExactMeetingBriefIdentity): {
  readonly householdRef: string;
  readonly matterId: string;
  readonly eventId: string;
  readonly day: string;
} {
  const candidate = identity as
    | Partial<ExactMeetingBriefIdentity>
    | null
    | undefined;
  if (!candidate?.clientBoundary) {
    throw new Error('Meeting brief sealed client boundary is required.');
  }
  return {
    householdRef: requiredIdentityPart(
      candidate.clientBoundary.householdRef,
      'household reference'
    ),
    matterId: requiredIdentityPart(
      candidate.clientBoundary.matterId,
      'matter id'
    ),
    eventId: requiredIdentityPart(candidate.eventId, 'event id'),
    day: requiredIdentityPart(candidate.day, 'day'),
  };
}

/**
 * Build the only accepted brief key. The household is included by
 * construction, so equal day/event/matter values cannot collide across two
 * households. Length-prefixing prevents separator characters inside ids from
 * making two different identities produce the same key.
 */
export function briefKey(identity: ExactMeetingBriefIdentity): string {
  const exact = normalizedIdentity(identity);
  return [exact.day, exact.householdRef, exact.eventId, exact.matterId]
    .map((part) => `${String(part.length)}:${part}`)
    .join('|');
}

export interface ExactMeetingBriefTarget {
  /** Exact canonical calendar-event reference carried by the meeting. */
  readonly eventId: string;
  /** Canonical meeting opened through the sealed Meetings foundation. */
  readonly meeting: MeetingProjection;
  /** Sealed household + matter authority minted beside that meeting. */
  readonly clientBoundary: SealedMeetingClientBoundary;
}

function identityFromStoredBrief(
  brief: MeetingBrief
): ExactMeetingBriefIdentity | null {
  try {
    const clientBoundary = {
      householdRef: requiredIdentityPart(
        brief.householdRef,
        'household reference'
      ),
      matterId: requiredIdentityPart(brief.matterId, 'matter id'),
    } as SealedMeetingClientBoundary;
    return {
      clientBoundary,
      eventId: requiredIdentityPart(brief.eventId, 'event id'),
      day: requiredIdentityPart(brief.day, 'day'),
    };
  } catch {
    return null;
  }
}

/** Reject malformed and pre-household persisted records. */
export function isValidMeetingBrief(value: unknown): value is MeetingBrief {
  if (!value || typeof value !== 'object') return false;
  const brief = value as MeetingBrief;
  const identity = identityFromStoredBrief(brief);
  if (!identity) return false;
  try {
    return brief.key === briefKey(identity);
  } catch {
    return false;
  }
}

/**
 * Select one brief for one canonical event/meeting and one sealed client pair.
 *
 * A missing event reference, either pair-field changing, a malformed persisted
 * key, or duplicate exact matches all fail closed. The target itself is
 * non-optional: callers must handle a missing canonical meeting before reading.
 */
export function selectExactMeetingBrief(
  briefs: Readonly<Record<string, MeetingBrief>>,
  target: ExactMeetingBriefTarget
): MeetingBrief | null {
  let eventId: string;
  let householdRef: string;
  let matterId: string;
  try {
    eventId = requiredIdentityPart(target.eventId, 'event id');
    householdRef = requiredIdentityPart(
      target.clientBoundary.householdRef,
      'household reference'
    );
    matterId = requiredIdentityPart(
      target.clientBoundary.matterId,
      'matter id'
    );
  } catch {
    return null;
  }
  const { meeting } = target;
  if (
    meeting.householdRef !== householdRef ||
    meeting.matterId !== matterId ||
    !meeting.references.includes(eventId)
  ) {
    return null;
  }

  const matches = Object.values(briefs).filter((brief) => {
    if (!isValidMeetingBrief(brief)) return false;
    return (
      brief.eventId === eventId &&
      brief.householdRef === householdRef &&
      brief.matterId === matterId &&
      brief.key ===
        briefKey({
          clientBoundary: target.clientBoundary,
          eventId,
          day: brief.day,
        })
    );
  });
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

interface BriefStoreState {
  briefs: Record<string, MeetingBrief>;
  upsert: (
    identity: ExactMeetingBriefIdentity,
    brief: MeetingBriefDraft
  ) => void;
  setStatus: (
    identity: ExactMeetingBriefIdentity,
    status: BriefStatus,
    error?: string
  ) => void;
  markStale: (identity: ExactMeetingBriefIdentity) => void;
}

export const useBriefStore = create<BriefStoreState>()(
  persist(
    (set) => ({
      briefs: {},
      upsert: (identity, brief) => {
        const exact = normalizedIdentity(identity);
        const key = briefKey(identity);
        const stored: MeetingBrief = {
          ...brief,
          key,
          eventId: exact.eventId,
          householdRef: exact.householdRef,
          matterId: exact.matterId,
          day: exact.day,
        };
        set((state) => ({
          briefs: { ...state.briefs, [key]: stored },
        }));
      },
      setStatus: (identity, status, error) => {
        const key = briefKey(identity);
        set((state) => {
          const existing = state.briefs[key];
          if (!existing || !isValidMeetingBrief(existing)) return state;
          const { error: _previousError, ...rest } = existing;
          const updated: MeetingBrief =
            error === undefined
              ? { ...rest, status }
              : { ...rest, status, error };
          return { briefs: { ...state.briefs, [key]: updated } };
        });
      },
      markStale: (identity) => {
        const key = briefKey(identity);
        set((state) => {
          const existing = state.briefs[key];
          if (
            !existing ||
            !isValidMeetingBrief(existing) ||
            existing.status !== 'ready'
          ) {
            return state;
          }
          return {
            briefs: {
              ...state.briefs,
              [key]: { ...existing, stale: true },
            },
          };
        });
      },
    }),
    {
      name: SK_MEETING_BRIEFS,
      merge: (persistedState, currentState) => {
        const persistedBriefs = (
          persistedState as Partial<BriefStoreState> | undefined
        )?.briefs;
        const briefs: Record<string, MeetingBrief> = {};
        if (persistedBriefs && typeof persistedBriefs === 'object') {
          for (const [key, value] of Object.entries(persistedBriefs)) {
            if (isValidMeetingBrief(value) && value.key === key) {
              briefs[key] = value;
            }
          }
        }
        return { ...currentState, briefs };
      },
    }
  )
);
