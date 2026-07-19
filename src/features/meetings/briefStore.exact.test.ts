import { describe, expect, it } from 'vitest';
import type {
  MeetingProjection,
  SealedMeetingClientBoundary,
} from './foundation/contract';
import {
  briefKey,
  selectExactMeetingBrief,
  type ExactMeetingBriefTarget,
  type MeetingBrief,
} from './briefStore';

const client = {
  householdRef: 'household-a',
  matterId: 'matter-a',
} as SealedMeetingClientBoundary;

function meeting(
  overrides: Partial<MeetingProjection> = {}
): MeetingProjection {
  return {
    id: 'meeting-a',
    workspaceId: 'workspace-a',
    householdRef: client.householdRef,
    matterId: client.matterId,
    typeId: 'review',
    ownerRef: 'advisor-a',
    scheduledStartUtc: '2026-07-20T09:00:00.000Z',
    scheduledEndUtc: '2026-07-20T10:00:00.000Z',
    timezone: 'America/Chicago',
    state: 'scheduled',
    references: ['event-a'],
    ...overrides,
  };
}

function brief(overrides: Partial<MeetingBrief> = {}): MeetingBrief {
  const day = '2026-07-20';
  return {
    key: briefKey({ clientBoundary: client, eventId: 'event-a', day }),
    eventId: 'event-a',
    householdRef: 'household-a',
    matterId: 'matter-a',
    day,
    status: 'ready',
    markdown: 'Brief A',
    citations: [],
    generatedAt: '2026-07-19T12:00:00.000Z',
    stale: false,
    eventTitle: 'Annual review',
    ...overrides,
  };
}

function target(
  overrides: Partial<ExactMeetingBriefTarget> = {}
): ExactMeetingBriefTarget {
  return {
    eventId: 'event-a',
    meeting: meeting(),
    clientBoundary: client,
    ...overrides,
  };
}

describe('selectExactMeetingBrief', () => {
  it('joins only the exact canonical event/meeting and sealed household + matter pair', () => {
    const exact = brief();
    const otherEvent = brief({
      key: briefKey({
        clientBoundary: client,
        eventId: 'event-b',
        day: '2026-07-20',
      }),
      eventId: 'event-b',
      eventTitle: 'Other meeting',
    });
    expect(selectExactMeetingBrief({ exact, otherEvent }, target())).toBe(
      exact
    );
    expect(
      selectExactMeetingBrief({ exact }, target({ eventId: 'event-b' }))
    ).toBeNull();
    expect(
      selectExactMeetingBrief(
        { exact },
        target({
          meeting: meeting({ references: ['event-b'] }),
        })
      )
    ).toBeNull();
  });

  it('fails closed when either half of the client pair changes', () => {
    const exact = brief();
    expect(
      selectExactMeetingBrief(
        { exact },
        target({
          clientBoundary: {
            householdRef: 'household-b',
            matterId: client.matterId,
          } as SealedMeetingClientBoundary,
        })
      )
    ).toBeNull();
    expect(
      selectExactMeetingBrief(
        { exact },
        target({
          clientBoundary: {
            householdRef: client.householdRef,
            matterId: 'matter-b',
          } as SealedMeetingClientBoundary,
        })
      )
    ).toBeNull();
  });

  it('fails closed when only the household changes for the same matter and event', () => {
    const householdABrief = brief();
    const householdB = {
      householdRef: 'household-b',
      matterId: client.matterId,
    } as SealedMeetingClientBoundary;

    expect(
      selectExactMeetingBrief(
        { householdABrief },
        {
          eventId: 'event-a',
          meeting: meeting({ householdRef: householdB.householdRef }),
          clientBoundary: householdB,
        }
      )
    ).toBeNull();
  });

  it('fails closed for a persisted brief that predates household identity', () => {
    const { householdRef: _legacyMissingField, ...legacyBrief } = brief();

    expect(
      selectExactMeetingBrief(
        { legacyBrief: legacyBrief as MeetingBrief },
        target()
      )
    ).toBeNull();
  });

  it('does not choose one when persisted identity is malformed or duplicated', () => {
    const exact = brief();
    const malformed = brief({ key: 'wrong-key' });
    expect(selectExactMeetingBrief({ malformed }, target())).toBeNull();
    expect(
      selectExactMeetingBrief({ one: exact, two: { ...exact } }, target())
    ).toBeNull();
  });
});
