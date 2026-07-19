import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import type { CalendarEventDto } from '@/platform/utils/calendar-commands';

const activeQueueClient = vi.hoisted(() => ({
  householdRef: 'household-a',
  matterId: 'matter-shared',
}));

vi.mock('@/platform/client-context', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/platform/client-context')>();
  return {
    ...actual,
    readSelectionOperationDecision: () => ({
      kind: 'matter' as const,
      sourceKind: 'matter' as const,
      matter: { id: activeQueueClient.matterId },
      client: {
        provider: 'wealthbox' as const,
        householdId: activeQueueClient.householdRef,
        displayName: activeQueueClient.householdRef,
      },
    }),
  };
});
import { cancelBriefQueue, enqueueBriefs } from './briefQueue';
import {
  selectExactMeetingBrief,
  useBriefStore,
  type ExactMeetingBriefTarget,
} from './briefStore';
import type {
  MeetingProjection,
  SealedMeetingClientBoundary,
} from './foundation/contract';
import { MeetingPrepPanel } from './MeetingPrepPanel';

vi.mock('./generateBrief', () => ({
  generateMeetingBrief: vi.fn((_matterId: string, event: CalendarEventDto) =>
    Promise.resolve({
      markdown: `### Client Snapshot\nGenerated for ${event.title}`,
      citations: [],
      bullets: [],
      generatedAt: '2026-07-20T08:00:00.000Z',
    })
  ),
}));

const event = {
  id: 'event-shared',
  provider: 'ics',
  title: 'Annual review',
  startUtc: '2026-07-20T09:00:00.000Z',
  endUtc: '2026-07-20T10:00:00.000Z',
  attendees: [],
  organizerEmail: '',
  joinUrl: '',
} as CalendarEventDto;

function target(householdRef: string): ExactMeetingBriefTarget {
  const clientBoundary = {
    householdRef,
    matterId: 'matter-shared',
  } as SealedMeetingClientBoundary;
  const meeting = {
    id: `meeting-${householdRef}`,
    workspaceId: 'workspace-a',
    ...clientBoundary,
    typeId: 'review',
    ownerRef: 'advisor-a',
    scheduledStartUtc: event.startUtc,
    scheduledEndUtc: event.endUtc,
    timezone: 'UTC',
    state: 'scheduled',
    references: [event.id],
  } as MeetingProjection;
  return { eventId: event.id, meeting, clientBoundary };
}

function selectTarget(value: ExactMeetingBriefTarget): void {
  activeQueueClient.householdRef = value.clientBoundary.householdRef;
  activeQueueClient.matterId = value.clientBoundary.matterId;
}

afterEach(() => {
  cancelBriefQueue();
  useBriefStore.setState({ briefs: {} });
});

describe('brief queue household isolation', () => {
  it('writes and reads only the generated brief for the sealed household', async () => {
    const householdA = target('household-a');
    const householdB = target('household-b');
    selectTarget(householdA);
    enqueueBriefs([{ clientBoundary: householdA.clientBoundary, event }]);
    await waitFor(() => {
      expect(
        selectExactMeetingBrief(useBriefStore.getState().briefs, householdA)
          ?.status
      ).toBe('ready');
    });
    expect(
      selectExactMeetingBrief(useBriefStore.getState().briefs, householdB)
    ).toBeNull();
    const view = render(
      createElement(MeetingPrepPanel, {
        target: householdA,
        surfaceFacts: [],
        nowUtc: '2026-07-20T08:00:00.000Z',
      })
    );
    expect(screen.getByText(/Generated for Annual review/)).toBeInTheDocument();
    selectTarget(householdB);
    view.rerender(
      createElement(MeetingPrepPanel, {
        target: householdB,
        surfaceFacts: [],
        nowUtc: '2026-07-20T08:00:00.000Z',
      })
    );
    expect(screen.getByTestId('meeting-prep-empty')).toBeInTheDocument();
    expect(
      screen.queryByText(/Generated for Annual review/)
    ).not.toBeInTheDocument();
    expect(
      selectExactMeetingBrief(useBriefStore.getState().briefs, householdA)
    ).toBeNull();
    const briefA = Object.values(useBriefStore.getState().briefs).find(
      (candidate) => candidate.householdRef === householdA.clientBoundary.householdRef
    );
    expect(briefA?.householdRef).toBe('household-a');

    enqueueBriefs([{ clientBoundary: householdB.clientBoundary, event }]);
    await waitFor(() => {
      expect(
        selectExactMeetingBrief(useBriefStore.getState().briefs, householdB)
          ?.status
      ).toBe('ready');
    });
    const briefBAfterSwitch = selectExactMeetingBrief(
      useBriefStore.getState().briefs,
      householdB
    );
    const briefAAfterSwitch = selectExactMeetingBrief(
      useBriefStore.getState().briefs,
      householdA
    );
    expect(briefBAfterSwitch?.householdRef).toBe('household-b');
    expect(briefAAfterSwitch).toBeNull();
    expect(briefA?.key).not.toBe(briefBAfterSwitch?.key);
    expect(Object.keys(useBriefStore.getState().briefs)).toHaveLength(2);
    expect(screen.getByText(/Generated for Annual review/)).toBeInTheDocument();
    selectTarget(householdA);
    view.rerender(
      createElement(MeetingPrepPanel, {
        target: householdA,
        surfaceFacts: [],
        nowUtc: '2026-07-20T08:00:00.000Z',
      })
    );
    expect(screen.getByText(/Generated for Annual review/)).toBeInTheDocument();
  });
});
