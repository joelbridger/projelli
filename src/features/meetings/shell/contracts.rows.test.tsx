import '@/i18n';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  projectMeetingSurface,
  type MeetingArtifact,
  type MeetingProjection,
  type MeetingSurfaceFacts,
  type MeetingSurfaceProjectionResult,
  type SealedMeetingClientBoundary,
} from '../foundation/contract';
import {
  getMeetingListComposition,
  type MeetingListContext,
  type MeetingListDescriptor,
} from './contracts';

const client = {
  householdRef: 'household-a',
  matterId: 'shared-matter',
  displayName: 'Avery Household',
} as SealedMeetingClientBoundary;

const meeting = {
  id: 'meeting-a',
  workspaceId: 'workspace-a',
  householdRef: client.householdRef,
  matterId: client.matterId,
  typeId: 'annual-review',
  ownerRef: 'advisor-a',
  scheduledStartUtc: '2026-07-20T10:00:00.000Z',
  scheduledEndUtc: '2026-07-20T11:00:00.000Z',
  timezone: 'UTC',
  state: 'scheduled',
  references: [],
} satisfies MeetingProjection;

const linkedMeeting = {
  ...meeting,
  legacyLink: {
    meetingDir: 'clients/avery/meetings/annual-review',
    linkedAt: '2026-07-19T12:00:00.000Z',
  },
} satisfies MeetingProjection;

const baseReviewFilter = {
  view: 'need-attention',
  type: 'all',
  owner: { kind: 'all' },
} as const;

function readySurface(
  meetings: readonly MeetingProjection[] = [meeting],
  facts: readonly MeetingSurfaceFacts[] = [],
  nowUtc = '2026-07-20T09:00:00.000Z'
): Extract<MeetingSurfaceProjectionResult, { readonly kind: 'ready' }> {
  const result = projectMeetingSurface(
    { kind: 'selected-client', client, meetings },
    facts,
    nowUtc
  );
  if (result.kind !== 'ready') {
    throw new Error('Expected a ready meeting surface.');
  }
  return result;
}

function context(
  surface = readySurface(),
  overrides: Partial<MeetingListContext> = {}
): MeetingListContext {
  return {
    client,
    surface,
    reviewResult: {
      kind: 'ready-empty',
      items: [],
      badgeMeetingCount: 0,
      emptyReason: 'no-items',
      emptyCopy:
        'Nothing waiting on you for Avery Household. This view is filtered to Avery Household.',
      filter: baseReviewFilter,
      retry: 'not-available',
    },
    reviewFilter: baseReviewFilter,
    currentMemberId: 'advisor-a',
    pastFilter: { status: 'all', typeId: 'all' },
    ownerFilterState: {
      applied: false,
      unfilteredCounts: { upcoming: surface.upcoming.length, past: surface.past.length },
    },
    openMeeting: vi.fn(() => Promise.resolve()),
    setReviewFilter: vi.fn(),
    setPastFilter: vi.fn(),
    retryReview: vi.fn(),
    ...overrides,
  };
}

function view(id: 'upcoming' | 'past' | 'actions'): MeetingListDescriptor {
  const descriptor = getMeetingListComposition().find(
    (candidate) => candidate.id === id
  );
  if (!descriptor) throw new Error(`Missing ${id} descriptor.`);
  return descriptor;
}

function pastMeeting(value: MeetingProjection = meeting): MeetingProjection {
  return {
    ...value,
    scheduledStartUtc: '2026-07-20T07:00:00.000Z',
    scheduledEndUtc: '2026-07-20T08:00:00.000Z',
    state: 'completed',
  };
}

function summaryArtifact(): MeetingArtifact {
  return {
    id: 'summary-a',
    meetingId: meeting.id,
    householdRef: client.householdRef,
    matterId: client.matterId,
    kind: 'summary',
    schemaVersion: 1,
    state: 'produced',
    producedAt: '2026-07-20T08:05:00.000Z',
    sourceRefs: [],
    provenance: 'local-processing',
    payload: {},
    createdAt: '2026-07-20T08:05:00.000Z',
  };
}

describe('Meetings shell factual rows', () => {
  it('renders every supported upcoming fact from the exact-pair projector', () => {
    const surface = readySurface(
      [linkedMeeting],
      [
        {
          meetingId: meeting.id,
          householdRef: client.householdRef,
          matterId: client.matterId,
          title: 'Annual planning review',
          platform: 'teams',
          joinUrl: 'https://teams.example/meeting',
          participants: [{ name: 'Alex' }, { email: 'sam@example.com' }],
          briefStatus: 'available',
          recordingStatus: 'recording',
        },
      ]
    );

    render(view('upcoming').render(context(surface)));

    const row = screen.getByTestId('meetings-row-meeting-a');
    expect(row).toHaveTextContent('Annual planning review');
    expect(row).toHaveTextContent('annual-review');
    expect(row).toHaveTextContent('Teams');
    expect(row).toHaveTextContent('Starts in 60 minutes');
    expect(row).toHaveTextContent('Avery Household');
    expect(row).toHaveTextContent('Matches selected client');
    expect(row).toHaveTextContent('Brief ready');
    expect(row).toHaveTextContent('Join details available');
    expect(row).toHaveTextContent('Recording in progress');
    expect(row).toHaveTextContent('Alex and 1 other');
    expect(screen.getByTestId('meetings-open-meeting-a')).toBeEnabled();
  });

  it('renders honest unavailable copy when optional upcoming facts are absent', () => {
    render(view('upcoming').render(context()));

    const row = screen.getByTestId('meetings-row-meeting-a');
    expect(row).toHaveTextContent('annual-review');
    expect(row).toHaveTextContent('Platform details are not available');
    expect(row).toHaveTextContent('Brief status is not available');
    expect(row).toHaveTextContent('Join details are not available');
    expect(row).toHaveTextContent('Recording status is not available');
    expect(row).toHaveTextContent('Participant details are not available');
    expect(row).not.toHaveTextContent('0 participants');
  });

  it('keeps folder availability beside the open action, not in the client-match cell', () => {
    render(view('upcoming').render(context()));

    const clientCell = screen.getByTestId('meetings-client-meeting-a');
    const folderStatus = screen.getByTestId('meetings-folder-status-meeting-a');
    expect(clientCell).toHaveTextContent('Matches selected client');
    expect(clientCell).not.toHaveTextContent('No linked meeting folder');
    expect(folderStatus).toHaveTextContent('No linked meeting folder');
    expect(folderStatus.closest('td')).not.toBe(clientCell);
    expect(screen.queryByTestId('meetings-open-meeting-a')).toBeNull();
  });

  it('uses selected-client empty copy only when the selected client truly has no rows', () => {
    render(view('upcoming').render(context(readySurface([]))));

    expect(screen.getByTestId('meetings-upcoming-empty')).toHaveTextContent(
      'No upcoming meetings for Avery Household. This view is filtered to Avery Household.'
    );
    expect(screen.queryByTestId('meetings-upcoming-filtered-empty')).toBeNull();
  });

  it('distinguishes an owner-filter miss from a client with no upcoming meetings', () => {
    render(
      view('upcoming').render(
        context(readySurface([]), {
          ownerFilterState: {
            applied: true,
            unfilteredCounts: { upcoming: 1, past: 0 },
          },
        })
      )
    );

    expect(
      screen.getByTestId('meetings-upcoming-filtered-empty')
    ).toHaveTextContent(
      'No upcoming meetings match these filters for Avery Household.'
    );
    expect(screen.queryByTestId('meetings-upcoming-empty')).toBeNull();
    expect(
      screen.queryByText(/No upcoming meetings for Avery Household/)
    ).toBeNull();
  });

  it('renders real past processing and output facts plus working status/type controls', () => {
    const past = pastMeeting();
    const surface = readySurface(
      [past],
      [
        {
          meetingId: past.id,
          householdRef: client.householdRef,
          matterId: client.matterId,
          processingStatus: 'needs-review',
          artifacts: [summaryArtifact()],
        },
      ],
      '2026-07-20T09:00:00.000Z'
    );
    const setPastFilter = vi.fn();

    render(view('past').render(context(surface, { setPastFilter })));

    const row = screen.getByTestId('meetings-row-meeting-a');
    expect(row).toHaveTextContent('Needs review');
    expect(row).toHaveTextContent('Summary ready');
    expect(row).not.toHaveTextContent('Transcript ready');
    fireEvent.change(screen.getByTestId('meetings-past-status-filter'), {
      target: { value: 'needs-review' },
    });
    expect(setPastFilter).toHaveBeenCalledWith({
      status: 'needs-review',
      typeId: 'all',
    });
    fireEvent.change(screen.getByTestId('meetings-past-type-filter'), {
      target: { value: 'annual-review' },
    });
    expect(setPastFilter).toHaveBeenCalledWith({
      status: 'all',
      typeId: 'annual-review',
    });
  });

  it('does not turn absent past facts into zero outputs or a known processing state', () => {
    const surface = readySurface(
      [pastMeeting()],
      [],
      '2026-07-20T09:00:00.000Z'
    );

    render(view('past').render(context(surface)));

    const row = screen.getByTestId('meetings-row-meeting-a');
    expect(row).toHaveTextContent('Processing status is not available');
    expect(row).toHaveTextContent('Output details are not available');
    expect(row).not.toHaveTextContent('Complete');
    expect(row).not.toHaveTextContent('No outputs');
  });

  it('distinguishes a filter miss from a client with no past meetings', () => {
    const surface = readySurface(
      [pastMeeting()],
      [],
      '2026-07-20T09:00:00.000Z'
    );

    render(
      view('past').render(
        context(surface, {
          pastFilter: { status: 'complete', typeId: 'all' },
        })
      )
    );

    expect(
      screen.getByTestId('meetings-past-filtered-empty')
    ).toHaveTextContent(
      'No past meetings match these filters for Avery Household.'
    );
    expect(screen.queryByTestId('meetings-past-empty')).toBeNull();
    expect(
      screen.queryByText(/No past meetings for Avery Household/)
    ).toBeNull();
  });

  it('renders real, unassigned, and unavailable action owners honestly', () => {
    const ownedContext = context(undefined, {
      reviewResult: {
        kind: 'ready-populated',
        badgeMeetingCount: 3,
        filter: baseReviewFilter,
        retry: 'not-available',
        items: [
          {
            id: 'action-owned',
            artifactId: 'artifact-owned',
            meetingId: meeting.id,
            client,
            meetingLabel: 'Annual planning review',
            clientLabel: 'Avery Household',
            owner: {
              ref: 'advisor-a',
              label: 'Morgan Lee',
              source: 'meeting',
            },
            reviewState: 'needs-review',
            archiveState: 'active',
            urgency: 'not-marked-urgent',
            producedAt: '2026-07-20T08:05:00.000Z',
            kind: 'task-proposal',
            proposal: {
              id: 'proposal-owned',
              kind: 'task',
              title: 'Follow up',
              detail: 'Call client',
              ownerRef: 'advisor-a',
              dueDate: null,
              transcriptRef: 'transcript:meeting-a',
            },
          },
          {
            id: 'action-unassigned',
            artifactId: 'artifact-unassigned',
            meetingId: meeting.id,
            client,
            meetingLabel: 'Annual planning review',
            clientLabel: 'Avery Household',
            owner: { ref: null, source: 'proposal' },
            reviewState: 'needs-review',
            archiveState: 'active',
            urgency: 'not-marked-urgent',
            producedAt: '2026-07-20T08:06:00.000Z',
            kind: 'task-proposal',
            proposal: {
              id: 'proposal-unassigned',
              kind: 'task',
              title: 'Send recap',
              detail: 'Prepare a recap',
              ownerRef: null,
              dueDate: null,
              transcriptRef: 'transcript:meeting-a',
            },
          },
          {
            id: 'action-owner-name-unavailable',
            artifactId: 'artifact-owner-name-unavailable',
            meetingId: meeting.id,
            client,
            meetingLabel: 'Annual planning review',
            clientLabel: 'Avery Household',
            owner: {
              ref: 'advisor-without-a-safe-label',
              source: 'meeting',
            },
            reviewState: 'needs-review',
            archiveState: 'active',
            urgency: 'not-marked-urgent',
            producedAt: '2026-07-20T08:07:00.000Z',
            kind: 'task-proposal',
            proposal: {
              id: 'proposal-owner-name-unavailable',
              kind: 'task',
              title: 'Prepare notes',
              detail: 'Prepare notes for the next review',
              ownerRef: 'advisor-without-a-safe-label',
              dueDate: null,
              transcriptRef: 'transcript:meeting-a',
            },
          },
        ],
      },
    });

    render(view('actions').render(ownedContext));

    expect(
      screen.getByTestId('meetings-action-action-owned')
    ).toHaveTextContent('Morgan Lee');
    expect(
      screen.getByTestId('meetings-action-action-unassigned')
    ).toHaveTextContent('Unassigned');
    expect(
      screen.getByTestId('meetings-action-action-owner-name-unavailable')
    ).toHaveTextContent('Owner name is not available');
  });

  it('keeps a failed Actions load as an error with recovery, never an empty inbox', () => {
    render(
      view('actions').render(
        context(undefined, {
          reviewResult: {
            kind: 'error',
            message: 'raw reader failure must not reach the screen',
            retry: 'available',
          },
        })
      )
    );

    expect(screen.getByTestId('meetings-actions-error')).toHaveTextContent(
      'Meeting review work could not be loaded right now.'
    );
    expect(screen.getByTestId('meetings-actions-retry')).toBeEnabled();
    expect(screen.queryByTestId('meetings-actions-empty')).toBeNull();
    expect(
      screen.queryByText('raw reader failure must not reach the screen')
    ).toBeNull();
  });

  it('renders a genuinely empty Actions inbox as empty, not failed or filtered', () => {
    render(view('actions').render(context()));

    expect(screen.getByTestId('meetings-actions-empty')).toHaveTextContent(
      'Nothing waiting on you for Avery Household.'
    );
    expect(screen.queryByTestId('meetings-actions-error')).toBeNull();
    expect(screen.queryByTestId('meetings-actions-filtered-empty')).toBeNull();
  });

  it('distinguishes an Actions filter miss from a truly empty inbox', () => {
    render(
      view('actions').render(
        context(undefined, {
          reviewResult: {
            kind: 'ready-empty',
            items: [],
            badgeMeetingCount: 1,
            emptyReason: 'filtered',
            emptyCopy: 'Nothing waiting on you for Avery Household.',
            filter: {
              view: 'need-attention',
              type: 'speaker-confirmation',
              owner: { kind: 'all' },
            },
            retry: 'not-available',
          },
        })
      )
    );

    expect(
      screen.getByTestId('meetings-actions-filtered-empty')
    ).toHaveTextContent('No Actions match these filters for Avery Household.');
    expect(screen.queryByTestId('meetings-actions-empty')).toBeNull();
    expect(
      screen.queryByText('Nothing waiting on you for Avery Household.')
    ).toBeNull();
  });

  it('does not render or leak a same-matter meeting from a different household', () => {
    const otherHouseholdMeeting = {
      ...meeting,
      id: 'meeting-private-b',
      householdRef: 'household-b',
    } satisfies MeetingProjection;
    const surface = readySurface(
      [meeting, otherHouseholdMeeting],
      [
        {
          meetingId: otherHouseholdMeeting.id,
          householdRef: otherHouseholdMeeting.householdRef,
          matterId: otherHouseholdMeeting.matterId,
          title: 'PRIVATE B HOUSEHOLD REVIEW',
          participants: [{ name: 'Private Person B' }],
        },
      ]
    );

    render(view('upcoming').render(context(surface)));

    expect(screen.getByTestId('meetings-row-meeting-a')).toBeInTheDocument();
    expect(screen.queryByTestId('meetings-row-meeting-private-b')).toBeNull();
    expect(screen.queryByText('PRIVATE B HOUSEHOLD REVIEW')).toBeNull();
    expect(screen.queryByText('Private Person B')).toBeNull();
    expect(within(document.body).queryByText('household-b')).toBeNull();
  });
});
