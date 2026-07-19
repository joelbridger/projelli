import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import type { CalendarEventDto } from '@/platform/utils/calendar-commands';
import { cancelBriefQueue, enqueueBriefs } from './briefQueue';
import { selectExactMeetingBrief, useBriefStore, type ExactMeetingBriefTarget } from './briefStore';
import type { MeetingProjection, SealedMeetingClientBoundary } from './foundation/contract';

vi.mock('./generateBrief', () => ({
  generateMeetingBrief: vi.fn(async (_matterId: string, event: CalendarEventDto) => ({
    markdown: `### Client Snapshot\nGenerated for ${event.title}`,
    citations: [],
    bullets: [],
    generatedAt: '2026-07-20T08:00:00.000Z',
  })),
}));

const event = {
  id: 'event-shared', provider: 'ics', title: 'Annual review', startUtc: '2026-07-20T09:00:00.000Z',
  endUtc: '2026-07-20T10:00:00.000Z', attendees: [], organizerEmail: '', joinUrl: '',
} as CalendarEventDto;

function target(householdRef: string): ExactMeetingBriefTarget {
  const clientBoundary = { householdRef, matterId: 'matter-shared' } as SealedMeetingClientBoundary;
  const meeting = {
    id: `meeting-${householdRef}`, workspaceId: 'workspace-a', ...clientBoundary,
    typeId: 'review', ownerRef: 'advisor-a', scheduledStartUtc: event.startUtc,
    scheduledEndUtc: event.endUtc, timezone: 'UTC', state: 'scheduled', references: [event.id],
  } as MeetingProjection;
  return { eventId: event.id, meeting, clientBoundary };
}

afterEach(() => {
  cancelBriefQueue();
  useBriefStore.setState({ briefs: {} });
});

describe('brief queue household isolation', () => {
  it('writes and reads only the generated brief for the sealed household', async () => {
    const householdA = target('household-a');
    const householdB = target('household-b');
    enqueueBriefs([{ householdRef: 'household-a', matterId: 'matter-shared', event }]);
    await waitFor(() => expect(selectExactMeetingBrief(useBriefStore.getState().briefs, householdA)?.status).toBe('ready'));
    expect(selectExactMeetingBrief(useBriefStore.getState().briefs, householdB)).toBeNull();

    enqueueBriefs([{ householdRef: 'household-b', matterId: 'matter-shared', event }]);
    await waitFor(() => expect(selectExactMeetingBrief(useBriefStore.getState().briefs, householdB)?.status).toBe('ready'));
    expect(selectExactMeetingBrief(useBriefStore.getState().briefs, householdA)).toBeNull();
  });
});
