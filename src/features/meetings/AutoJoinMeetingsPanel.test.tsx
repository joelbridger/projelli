import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEventDto } from '@/platform/utils/calendar-commands';
import type { Matter } from '@/platform/types/matter';
import type { SelectionOperationDecision } from '@/platform/client-context';
import type { SealedMeetingClientBoundary } from './foundation/contract';

let matters: Matter[] = [];
let selection: SelectionOperationDecision = {
  kind: 'all-matters',
  client: null,
};
let activeClient: SealedMeetingClientBoundary | null = null;

const calendarListEvents = vi.fn<
  (startUtc: string, endUtc: string) => Promise<CalendarEventDto[]>
>();
const calendarPrefs = { outlook: true } as const;
const disabledKeys = new Set<string>();

vi.mock('@/platform/matter/matterStore', () => ({
  useActiveMatters: () => matters,
}));

vi.mock('@/platform/client-context', () => ({
  useSelectionOperationDecision: () => selection,
}));

vi.mock('@/platform/utils/calendar-commands', () => ({
  CALENDAR_SYNC_EVENT: 'calendar-sync',
  calendarListEvents: (...args: [string, string]) => calendarListEvents(...args),
}));

vi.mock('./autoJoinSettings', () => ({
  markAutoJoinOccurrencesPresented: vi.fn(),
  setAutoJoinEventDisabled: vi.fn(),
  useAutoJoinCalendarPrefs: () => calendarPrefs,
  useDisabledAutoJoinEventKeys: () => disabledKeys,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: () => Promise.resolve(() => undefined),
}));

vi.mock('./foundation/contract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./foundation/contract')>();
  return {
    ...actual,
    useActiveMeetingClientBoundary: () => activeClient,
  };
});

import {
  AutoJoinMeetingsPanel,
} from './AutoJoinMeetingsPanel';
import {
  filterAutoJoinCandidatesForManagement,
  type AutoJoinManagementScope,
} from './autoJoinManagementScope';
import { discoverAutoJoinMeetings } from './meetingAutoJoin';

const NOW = Date.parse('2026-07-19T16:00:00.000Z');
const clientA = {
  householdRef: 'household-a',
  matterId: 'matter-shared',
  displayName: 'Alpha Household',
} as SealedMeetingClientBoundary;
const clientB = {
  householdRef: 'household-b',
  matterId: 'matter-shared',
  displayName: 'Beta Household',
} as SealedMeetingClientBoundary;

function matter(): Matter {
  return {
    id: 'matter-shared',
    name: 'Shared matter',
    client: 'Alpha Household',
    folderPaths: ['/workspace/Clients/Alpha'],
    crmHouseholdKeys: [clientA.householdRef],
    meetingKeys: ['alpha@example.test'],
    createdAt: '2026-07-01T00:00:00.000Z',
  };
}

function event(): CalendarEventDto {
  return {
    id: 'event-a',
    provider: 'outlook',
    title: 'Alpha review',
    startUtc: '2026-07-19T16:05:00.000Z',
    endUtc: '2026-07-19T17:00:00.000Z',
    attendees: [{ email: 'alpha@example.test', name: 'Alpha' }],
    organizerEmail: 'advisor@example.test',
    joinUrl: 'https://teams.microsoft.com/l/meetup-join/alpha',
  };
}

function selectedDecision(
  client: SealedMeetingClientBoundary
): SelectionOperationDecision {
  return {
    kind: 'matter',
    sourceKind: 'matter',
    matter: matter(),
    client: {
      provider: 'wealthbox',
      householdId: client.householdRef,
      displayName: client.displayName ?? 'Client',
    },
  };
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  cleanup();
  matters = [];
  selection = { kind: 'all-matters', client: null };
  activeClient = null;
  calendarListEvents.mockReset();
  vi.restoreAllMocks();
});

describe('AutoJoinMeetingsPanel pair-aware management', () => {
  it('shows a selected household only its proven pair, even when another household uses the same matter id', () => {
    const linkedMatter = matter();
    const candidate = discoverAutoJoinMeetings(
      [event()],
      [linkedMatter],
      { outlook: true },
      new Set(),
      NOW
    ).willJoin;

    expect(
      filterAutoJoinCandidatesForManagement(candidate, [linkedMatter], {
        kind: 'selected-client',
        client: clientA,
      })
    ).toHaveLength(1);
    expect(
      filterAutoJoinCandidatesForManagement(candidate, [linkedMatter], {
        kind: 'selected-client',
        client: clientB,
      })
    ).toEqual([]);
  });

  it('keeps selected-client counts and rows pair-filtered while all-matters is firm-wide', async () => {
    matters = [matter()];
    calendarListEvents.mockResolvedValue([event()]);
    activeClient = clientB;
    selection = selectedDecision(clientB);
    const selectedView = render(<AutoJoinMeetingsPanel />);

    expect(await screen.findByTestId('meeting-auto-join-empty')).toHaveTextContent(
      'No upcoming meetings for this client'
    );
    expect(screen.queryByTestId('meeting-auto-join-row')).toBeNull();
    selectedView.unmount();

    activeClient = null;
    selection = { kind: 'all-matters', client: null };
    render(<AutoJoinMeetingsPanel />);
    await waitFor(() => {
      expect(screen.getByTestId('meeting-auto-join-toggle')).toHaveTextContent(
        'Will auto-join 1 meeting'
      );
    });
    fireEvent.click(screen.getByTestId('meeting-auto-join-toggle'));
    expect(screen.getByTestId('meeting-auto-join-row')).toHaveTextContent(
      'Alpha Household'
    );
  });

  it('renders loading, translated error, retry, and empty states without raw failures', async () => {
    matters = [matter()];
    calendarListEvents
      .mockRejectedValueOnce(new Error('RAW CALENDAR FAILURE'))
      .mockResolvedValueOnce([]);
    render(<AutoJoinMeetingsPanel />);

    expect(screen.getByTestId('meeting-auto-join-loading')).toBeInTheDocument();
    const error = await screen.findByTestId('meeting-auto-join-error');
    expect(error).toHaveTextContent("Couldn't check upcoming meetings.");
    expect(error).not.toHaveTextContent('RAW CALENDAR FAILURE');
    fireEvent.click(screen.getByTestId('meeting-auto-join-retry'));
    expect(await screen.findByTestId('meeting-auto-join-empty')).toHaveTextContent(
      'No upcoming firm meetings'
    );
    expect(calendarListEvents).toHaveBeenCalledTimes(2);
  });

  it('has no matter-only selected Automations scope', () => {
    const compileNegativeShapes = () => {
      const matterOnly: AutoJoinManagementScope = {
        kind: 'selected-client',
        // @ts-expect-error a matter id is not a sealed household + matter pair.
        client: { matterId: 'matter-shared' },
      };
      void matterOnly;
    };
    expect(compileNegativeShapes).toBeTypeOf('function');
  });
});
