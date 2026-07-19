import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const activePrepClient = vi.hoisted(() => ({
  householdRef: 'household-a',
  matterId: 'matter-a',
}));

vi.mock('@/platform/client-context', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/platform/client-context')>();
  return {
    ...actual,
    readSelectionOperationDecision: () => ({
      kind: 'matter' as const,
      sourceKind: 'matter' as const,
      matter: { id: activePrepClient.matterId },
      client: {
        provider: 'wealthbox' as const,
        householdId: activePrepClient.householdRef,
        displayName: activePrepClient.householdRef,
      },
    }),
  };
});
import type {
  MeetingProjection,
  MeetingSurfaceFacts,
  SealedMeetingClientBoundary,
} from './foundation/contract';
import { MeetingPrepPanel } from './MeetingPrepPanel';
import {
  briefKey,
  useBriefStore,
  type ExactMeetingBriefTarget,
  type MeetingBrief,
} from './briefStore';

const NOW = '2026-07-20T08:00:00.000Z';

function selectTarget(value: ExactMeetingBriefTarget): void {
  activePrepClient.householdRef = value.clientBoundary.householdRef;
  activePrepClient.matterId = value.clientBoundary.matterId;
}

function target(suffix: string): ExactMeetingBriefTarget {
  const client = {
    householdRef: `household-${suffix}`,
    matterId: `matter-${suffix}`,
  } as SealedMeetingClientBoundary;
  const meeting: MeetingProjection = {
    id: `meeting-${suffix}`,
    workspaceId: 'workspace-a',
    householdRef: client.householdRef,
    matterId: client.matterId,
    typeId: 'review',
    ownerRef: 'advisor-a',
    scheduledStartUtc: '2026-07-20T09:00:00.000Z',
    scheduledEndUtc: '2026-07-20T10:00:00.000Z',
    timezone: 'America/Chicago',
    state: 'scheduled',
    references: [`event-${suffix}`],
  };
  return { eventId: `event-${suffix}`, meeting, clientBoundary: client };
}

function brief(
  suffix: string,
  overrides: Partial<MeetingBrief> = {}
): MeetingBrief {
  const day = '2026-07-20';
  const clientBoundary = {
    householdRef: `household-${suffix}`,
    matterId: `matter-${suffix}`,
  } as SealedMeetingClientBoundary;
  return {
    key: briefKey({
      clientBoundary,
      eventId: `event-${suffix}`,
      day,
    }),
    eventId: `event-${suffix}`,
    householdRef: `household-${suffix}`,
    matterId: `matter-${suffix}`,
    day,
    status: 'ready',
    markdown: [
      '### Client Snapshot',
      'Morgan is retired and holds a concentrated employer-stock position.',
      '### Last Meeting Recap',
      '- Decided to keep a six-month cash reserve.',
      '### Current Concerns and Life Events',
      '- Morgan changed jobs in June.',
      '## Suggested Talking Points',
      '1. Confirm the beneficiary update.',
    ].join('\n'),
    citations: [
      { path: '/workspace/Clients/Morgan/plan.docx', score: 0.9 },
      { path: '/workspace/Clients/Morgan/meeting-notes.docx', score: 0.8 },
    ],
    generatedAt: '2026-07-19T12:00:00.000Z',
    stale: false,
    eventTitle: `Annual review ${suffix}`,
    ...overrides,
  };
}

function facts(value: ExactMeetingBriefTarget): readonly MeetingSurfaceFacts[] {
  return [
    {
      meetingId: value.meeting.id,
      householdRef: value.clientBoundary.householdRef,
      matterId: value.clientBoundary.matterId,
      platform: 'zoom',
      joinUrl: 'https://zoom.us/j/123',
      recordingStatus: 'not-recorded',
    },
  ];
}

afterEach(() => {
  useBriefStore.setState({ briefs: {} });
});

describe('MeetingPrepPanel', () => {
  it('projects the real brief, exact client match, source count, readiness, and handoffs', () => {
    const value = target('a');
    selectTarget(value);
    useBriefStore.setState({ briefs: { a: brief('a') } });
    const join = vi.fn();
    const record = vi.fn();
    const openSource = vi.fn();
    render(
      <MeetingPrepPanel
        target={value}
        surfaceFacts={facts(value)}
        nowUtc={NOW}
        handoffs={{ join, record, openSource }}
      />
    );

    expect(screen.getByText(/Morgan changed jobs in June/)).toBeInTheDocument();
    expect(
      screen.getByText(/Decided to keep a six-month cash reserve/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Confirm the beneficiary update/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/concentrated employer-stock position/)
    ).toBeInTheDocument();
    expect(screen.getByText('Generated from 2 sources.')).toBeInTheDocument();
    expect(screen.getByTestId('meeting-prep-client-match')).toHaveTextContent(
      'Exact client match'
    );

    fireEvent.click(screen.getByTestId('meeting-prep-join'));
    fireEvent.click(screen.getByTestId('meeting-prep-record'));
    fireEvent.click(
      screen.getAllByTestId('meeting-prep-source')[0] as HTMLElement
    );
    expect(join).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledOnce();
    expect(openSource).toHaveBeenCalledWith(
      '/workspace/Clients/Morgan/plan.docx'
    );
  });

  it('renders distinct loading, empty, and error states without borrowing another brief', () => {
    const value = target('a');
    selectTarget(value);
    useBriefStore.setState({
      briefs: { a: brief('a', { status: 'generating' }) },
    });
    const view = render(
      <MeetingPrepPanel target={value} surfaceFacts={[]} nowUtc={NOW} />
    );
    expect(screen.getByTestId('meeting-prep-loading')).toBeInTheDocument();

    act(() => {
      useBriefStore.setState({
        briefs: {
          a: brief('a', {
            status: 'failed',
            error: 'Local model unavailable.',
          }),
        },
      });
    });
    expect(screen.getByTestId('meeting-prep-error')).toHaveTextContent(
      'Local model unavailable.'
    );

    const clientB = target('b');
    selectTarget(clientB);
    view.rerender(
      <MeetingPrepPanel target={clientB} surfaceFacts={[]} nowUtc={NOW} />
    );
    expect(screen.getByTestId('meeting-prep-empty')).toBeInTheDocument();
    expect(screen.queryByText(/Annual review a/)).not.toBeInTheDocument();
  });

  it('clears client A content immediately when the event, household, and matter target changes', () => {
    const clientA = target('a');
    const clientB = target('b');
    selectTarget(clientA);
    useBriefStore.setState({ briefs: { a: brief('a') } });
    const view = render(
      <MeetingPrepPanel
        target={clientA}
        surfaceFacts={facts(clientA)}
        nowUtc={NOW}
      />
    );
    expect(screen.getByText('Annual review a')).toBeInTheDocument();

    selectTarget(clientB);
    view.rerender(
      <MeetingPrepPanel
        target={clientB}
        surfaceFacts={facts(clientB)}
        nowUtc={NOW}
      />
    );
    expect(screen.queryByText('Annual review a')).not.toBeInTheDocument();
    expect(screen.getByTestId('meeting-prep-empty')).toBeInTheDocument();
  });

  it('shows no brief when only the household changes for the same matter and event', () => {
    const householdA = target('a');
    const householdB: ExactMeetingBriefTarget = {
      eventId: householdA.eventId,
      meeting: {
        ...householdA.meeting,
        householdRef: 'household-b',
      },
      clientBoundary: {
        householdRef: 'household-b',
        matterId: householdA.clientBoundary.matterId,
      } as SealedMeetingClientBoundary,
    };
    selectTarget(householdA);
    useBriefStore.setState({ briefs: { a: brief('a') } });
    const view = render(
      <MeetingPrepPanel
        target={householdA}
        surfaceFacts={facts(householdA)}
        nowUtc={NOW}
      />
    );
    expect(screen.getByText('Annual review a')).toBeInTheDocument();

    selectTarget(householdB);
    view.rerender(
      <MeetingPrepPanel
        target={householdB}
        surfaceFacts={facts(householdB)}
        nowUtc={NOW}
      />
    );
    expect(screen.queryByText('Annual review a')).not.toBeInTheDocument();
    expect(screen.getByTestId('meeting-prep-empty')).toBeInTheDocument();
  });

  it('does not claim join or record readiness from wrong-pair facts', () => {
    const value = target('a');
    selectTarget(value);
    const exactFacts = facts(value);
    const exactFact = exactFacts[0];
    if (!exactFact) throw new Error('expected exact meeting facts');
    useBriefStore.setState({ briefs: { a: brief('a') } });
    render(
      <MeetingPrepPanel
        target={value}
        surfaceFacts={[
          { ...exactFact, householdRef: 'household-b', matterId: 'matter-b' },
        ]}
        nowUtc={NOW}
        handoffs={{ join: vi.fn(), record: vi.fn() }}
      />
    );
    expect(screen.queryByTestId('meeting-prep-join')).not.toBeInTheDocument();
    expect(screen.queryByTestId('meeting-prep-record')).not.toBeInTheDocument();
    expect(screen.getByTestId('meeting-prep-readiness')).toHaveTextContent(
      'No proven join handoff is available.'
    );
    expect(screen.getByTestId('meeting-prep-readiness')).toHaveTextContent(
      'No proven recording handoff is available.'
    );
  });
});
