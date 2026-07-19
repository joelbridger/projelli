import '@testing-library/jest-dom/vitest';
import type { ReactElement } from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import type { TranscriptFile } from '@/platform/types/meeting';
import {
  BLESSED_MEETING_PANEL_IDS,
  meetingPanelRegistry,
} from './meetingPanelRegistry';
import type { MeetingPanelContext } from './meetingWorkspaceTypes';

vi.mock('./SpeakerNamesPanel', () => ({
  SpeakerNamesPanel: () => (
    <button type="button" data-testid="speaker-review-access">
      Review speakers
    </button>
  ),
}));

const transcript: TranscriptFile = {
  segments: [
    {
      startMs: 0,
      endMs: 60_000,
      channel: 'mic',
      speaker: 'You',
      text: 'We discussed the Roth conversion.',
    },
    {
      startMs: 65_000,
      endMs: 125_000,
      channel: 'sys',
      speaker: 'Alex',
      text: 'The tax estimate is ready.',
    },
    {
      startMs: 130_000,
      endMs: 190_000,
      channel: 'mic',
      speaker: 'You',
      text: 'Call the custodian next.',
    },
  ],
  meta: {
    startedAt: '2026-07-19T09:00:00.000Z',
    durationMs: 190_000,
    matterId: 'matter-1',
    consent: {
      mode: 'one-party',
      confirmedBy: 'advisor-1',
      confirmedAt: '2026-07-19T09:00:00.000Z',
    },
  },
};

const translations: Record<string, string> = {
  'meetings.entry.transcript-search-label': 'Search this transcript',
  'meetings.entry.transcript-search-placeholder': 'Search this transcript',
  'meetings.entry.transcript-search-empty': 'No matching transcript turns.',
};

const t = ((key: string, options?: { count?: number; total?: number }) => {
  if (key === 'meetings.entry.transcript-search-count') {
    return `${String(options?.count)} of ${String(options?.total)} turns`;
  }
  return translations[key] ?? key;
}) as unknown as TFunction;

interface TargetIdentity {
  householdRef: string;
  matterId: string;
  meetingRef: string;
}

function context(
  identity: TargetIdentity = {
    householdRef: 'household-1',
    matterId: 'matter-1',
    meetingRef: 'meeting-1',
  }
): MeetingPanelContext {
  return {
    t,
    matterId: identity.matterId,
    canonicalMeeting: {
      id: identity.meetingRef,
      workspaceId: 'workspace-1',
      householdRef: identity.householdRef,
      matterId: identity.matterId,
      typeId: 'annual-review',
      ownerRef: 'advisor-1',
      scheduledStartUtc: '2026-07-19T09:00:00.000Z',
      scheduledEndUtc: '2026-07-19T10:00:00.000Z',
      timezone: 'America/Chicago',
      state: 'completed',
      references: [],
    },
    clientBoundary: {
      householdRef: identity.householdRef,
      matterId: identity.matterId,
    } as NonNullable<MeetingPanelContext['clientBoundary']>,
    meetingDir: `Clients/${identity.householdRef}/Meetings/${identity.meetingRef}`,
    clientName: 'Roth household',
    workspaceRoot: '/workspace',
    workspaceService: null,
    firm: { org: null, role: null },
    meta: null,
    transcript,
    summaryExtraction: null,
    summaryText: '',
    audioSrc: null,
    renderAudioPlayer: () => null,
    seekMs: undefined,
    hasAudio: false,
    hasNotes: false,
    summaryReady: false,
    crmBlockedReason: null,
    retryingNotes: false,
    retryingTranscript: false,
    onSeek: vi.fn(),
    onRetryNotes: vi.fn(),
    onRetryTranscript: vi.fn(),
  };
}

function transcriptPanel() {
  const matches = meetingPanelRegistry.filter(
    (descriptor) => descriptor.id === 'transcript'
  );
  expect(matches).toHaveLength(1);
  const panel = matches[0];
  if (!panel) throw new Error('Expected the transcript compatibility panel');
  return panel;
}

afterEach(cleanup);

describe('Transcript compatibility panel search projection', () => {
  it('rebinds the one blessed transcript descriptor instead of registering a duplicate', () => {
    expect(
      BLESSED_MEETING_PANEL_IDS.filter((id) => id === 'transcript')
    ).toHaveLength(1);
    expect(
      meetingPanelRegistry.filter(
        (descriptor) => descriptor.id === 'transcript'
      )
    ).toHaveLength(1);
  });

  it('filters only the loaded turns and preserves timestamps, speaker labels, seeking, and speaker review', () => {
    const panelContext = context();
    render(transcriptPanel().mount(panelContext) as ReactElement);

    expect(screen.getAllByTestId('transcript-turn')).toHaveLength(3);
    fireEvent.change(screen.getByTestId('meeting-transcript-search-input'), {
      target: { value: 'ALEX' },
    });

    const result = screen.getByTestId('transcript-turn');
    expect(within(result).getByText('1:05')).toBeInTheDocument();
    expect(within(result).getByText('Alex')).toBeInTheDocument();
    expect(
      within(result).getByText('The tax estimate is ready.')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('meeting-transcript-search-count')
    ).toHaveTextContent('1 of 3 turns');

    fireEvent.click(result);
    expect(panelContext.onSeek).toHaveBeenCalledWith(65_000);
    expect(screen.getByTestId('speaker-review-access')).toBeInTheDocument();
  });

  it('keeps speaker review reachable when the local projection has no matches', () => {
    render(transcriptPanel().mount(context()) as ReactElement);
    fireEvent.change(screen.getByTestId('meeting-transcript-search-input'), {
      target: { value: 'not in this transcript' },
    });

    expect(screen.queryByTestId('transcript-turn')).not.toBeInTheDocument();
    expect(
      screen.getByTestId('meeting-transcript-search-empty')
    ).toHaveAttribute('role', 'status');
    expect(screen.getByTestId('speaker-review-access')).toBeInTheDocument();
  });

  it.each([
    {
      boundary: 'household',
      next: {
        householdRef: 'household-2',
        matterId: 'matter-1',
        meetingRef: 'meeting-1',
      },
    },
    {
      boundary: 'matter',
      next: {
        householdRef: 'household-1',
        matterId: 'matter-2',
        meetingRef: 'meeting-1',
      },
    },
    {
      boundary: 'meeting',
      next: {
        householdRef: 'household-1',
        matterId: 'matter-1',
        meetingRef: 'meeting-2',
      },
    },
  ])(
    'clears query and results when the $boundary target changes',
    ({ next }) => {
      const panel = transcriptPanel();
      const view = render(panel.mount(context()) as ReactElement);
      fireEvent.change(screen.getByTestId('meeting-transcript-search-input'), {
        target: { value: 'tax' },
      });
      expect(screen.getAllByTestId('transcript-turn')).toHaveLength(1);

      view.rerender(panel.mount(context(next)) as ReactElement);

      expect(screen.getByTestId('meeting-transcript-search-input')).toHaveValue(
        ''
      );
      expect(screen.getAllByTestId('transcript-turn')).toHaveLength(3);
      expect(
        screen.queryByTestId('meeting-transcript-search-count')
      ).not.toBeInTheDocument();
    }
  );
});
