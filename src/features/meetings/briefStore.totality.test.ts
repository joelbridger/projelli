import { beforeEach, describe, expect, it } from 'vitest';
import { SK_MEETING_BRIEFS } from '@/config/identity';
import type { CalendarEventDto } from '@/platform/utils/calendar-commands';
import { cancelBriefQueue, enqueueBriefs } from './briefQueue';
import {
  briefKey,
  selectExactMeetingBrief,
  useBriefStore,
  type ExactMeetingBriefIdentity,
  type MeetingBriefDraft,
} from './briefStore';

const event = {
  id: 'event-a',
  provider: 'ics',
  title: 'Annual review',
  startUtc: '2026-07-20T09:00:00.000Z',
  endUtc: '2026-07-20T10:00:00.000Z',
  attendees: [],
  organizerEmail: '',
  joinUrl: '',
} as CalendarEventDto;

const draft: MeetingBriefDraft = {
  status: 'ready',
  markdown: 'Brief',
  citations: [],
  generatedAt: '2026-07-20T08:00:00.000Z',
  stale: false,
  eventTitle: event.title,
};

beforeEach(() => {
  cancelBriefQueue();
  localStorage.removeItem(SK_MEETING_BRIEFS);
  useBriefStore.setState({ briefs: {} });
});

describe('brief store total sealed-pair boundary', () => {
  it('makes matter-only brief reads and writes fail typechecking', () => {
    const compileMatterOnlyShapes = () => {
      void briefKey({
        // @ts-expect-error brief keys require the complete sealed household + matter pair.
        clientBoundary: { matterId: 'matter-a' },
        eventId: event.id,
        day: '2026-07-20',
      });
      enqueueBriefs([
        {
          // @ts-expect-error queue writes cannot be built from matter-only authority.
          clientBoundary: { matterId: 'matter-a' },
          event,
        },
      ]);
      void selectExactMeetingBrief(
        {},
        {
          eventId: event.id,
          meeting: {} as never,
          // @ts-expect-error exact reads require the same complete sealed pair.
          clientBoundary: { matterId: 'matter-a' },
        }
      );
    };
    expect(compileMatterOnlyShapes).toBeTypeOf('function');
  });

  it('rejects empty or partial identities before any store write', () => {
    const partial = {
      clientBoundary: { householdRef: '', matterId: 'matter-a' },
      eventId: event.id,
      day: '2026-07-20',
    } as unknown as ExactMeetingBriefIdentity;

    expect(() => briefKey(partial)).toThrow(/household reference/i);
    expect(() => {
      useBriefStore.getState().upsert(partial, draft);
    }).toThrow(/household reference/i);
    expect(() => {
      enqueueBriefs([
        {
          clientBoundary: partial.clientBoundary,
          event,
        },
      ]);
    }).toThrow(/household reference/i);
    expect(useBriefStore.getState().briefs).toEqual({});
  });

  it('drops persisted legacy records that lack the complete pair', async () => {
    localStorage.setItem(
      SK_MEETING_BRIEFS,
      JSON.stringify({
        state: {
          briefs: {
            legacy: {
              key: '2026-07-20:event-a:matter-a',
              eventId: event.id,
              matterId: 'matter-a',
              day: '2026-07-20',
              ...draft,
            },
          },
        },
        version: 0,
      })
    );

    await useBriefStore.persist.rehydrate();

    expect(useBriefStore.getState().briefs).toEqual({});
  });
});
