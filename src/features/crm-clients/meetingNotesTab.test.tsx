import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HouseholdRecordSurface } from './HouseholdRecordSurface';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { HouseholdRecord } from './adapters';

// fix/matterhub-entry-point: the entire meeting-notes-review feature
// (recording, transcript, summary, action items) had zero reachable UI
// entry point after the CRM merge dropped MatterHub's mount — see
// .agent/results/legion-build-drive-c9fd5e96.json "remaining_risks" item 1
// and prep/PACKAGED-BUILD-TRUTH-c9fd5e96.md. These tests prove (a) a manual
// navigation path exists from the client surface's tab row, (b) the
// event-bus's one-shot navigation requests (`clientMapHubTab`/
// `pendingMeetingOpen`) — previously written but never read by anything —
// are now honored, and (c, codex-review round-2 P1) a captured direct-open
// meeting request never survives a household switch.
//
// `ClientMeetingsTab` is stubbed here: it's a large, shared, pre-existing
// component (recording, transcript, notice cards, calendar sync) well
// outside this fix's scope. Stubbing it isolates exactly the boundary this
// diff touches -- `meetingNotesTab.tsx`'s own props/state -- from that
// component's unrelated internals, which is what every assertion below
// actually needs (reachability + the matterId/initialSelectedMeeting handed
// down), not its full rendered UI.

const liveCrm = vi.hoisted(() => ({
  records: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  useLiveCrmRecords: () => ({
    records: liveCrm.records,
    save: vi.fn(),
    reload: vi.fn(),
    error: null,
    workspaceRoot: '/practice',
    freshness: { kind: 'fresh' },
    sharedMatterId: null,
  }),
}));

vi.mock('@/features/meetings/ClientMeetingsTab', () => ({
  ClientMeetingsTab: ({
    matterId,
    initialSelectedMeeting,
  }: {
    matterId: string;
    initialSelectedMeeting?: { dir: string };
  }) => (
    <div
      data-testid="client-meetings-tab"
      data-matter-id={matterId}
      data-initial-meeting-dir={initialSelectedMeeting?.dir ?? ''}
    />
  ),
}));

const household: HouseholdRecord = {
  id: 'household-diaz',
  name: 'Diaz, Michelle',
  lifecycle: 'Active',
  primaryAdvisor: 'Maya',
  ownership: 'mine',
  serviceTier: 'Standard',
  syncState: 'live',
  facts: [],
  accounts: [],
  members: [],
  externalParties: [],
  notes: [],
};

const householdB: HouseholdRecord = {
  id: 'household-second',
  name: 'Second Household',
  lifecycle: 'Active',
  primaryAdvisor: 'Maya',
  ownership: 'mine',
  serviceTier: 'Standard',
  syncState: 'live',
  facts: [],
  accounts: [],
  members: [],
  externalParties: [],
  notes: [],
};

describe('client surface Meeting Notes entry point', () => {
  beforeEach(() => {
    liveCrm.records = [
      {
        id: household.id,
        kind: 'household',
        matterId: 'matter-diaz',
        name: household.name,
      },
      {
        id: householdB.id,
        kind: 'household',
        matterId: 'matter-second',
        name: householdB.name,
      },
    ];
    useMatterStore.setState({
      matters: [
        {
          id: 'matter-diaz',
          name: 'Diaz, Michelle',
          client: 'Diaz, Michelle',
          folderPaths: ['/practice/Diaz, Michelle'],
          createdAt: '2026-07-13T00:00:00.000Z',
        },
        {
          id: 'matter-second',
          name: 'Second Household',
          client: 'Second Household',
          folderPaths: ['/practice/Second Household'],
          createdAt: '2026-07-13T00:00:00.000Z',
        },
      ],
      activeMatterId: 'matter-diaz',
      clientMapHubId: 'matter-diaz',
      clientMapHubTab: null,
      pendingMeetingOpen: null,
    });
  });

  afterEach(() => {
    cleanup();
    useMatterStore.getState().setClientMapHubTab(null);
    useMatterStore.getState().setPendingMeetingOpen(null);
  });

  it('reaches the meeting-notes-review panel from the household tab row (manual navigation)', () => {
    render(<HouseholdRecordSurface household={household} />);

    fireEvent.click(screen.getByRole('button', { name: 'Meeting Notes' }));

    expect(screen.getByTestId('client-meetings-tab')).toBeInTheDocument();
  });

  it('does not confuse the notes-review Meeting Notes tab with the unrelated connected-calendar Meetings tab', () => {
    render(<HouseholdRecordSurface household={household} />);

    fireEvent.click(screen.getByRole('button', { name: 'Meetings' }));
    expect(screen.queryByTestId('client-meetings-tab')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Meeting Notes' }));
    expect(screen.getByTestId('client-meetings-tab')).toBeInTheDocument();
  });

  it('honors the event bus\'s "open this client\'s meetings" request (clientMapHubTab) without a manual click', async () => {
    render(<HouseholdRecordSurface household={household} />);

    expect(screen.queryByTestId('client-meetings-tab')).not.toBeInTheDocument();

    act(() => {
      useMatterStore.getState().setClientMapHubTab('meetings');
    });

    // Consumed via queueMicrotask (matches the pre-merge MatterHub contract) —
    // give it a tick to switch tabs and clear the one-shot request.
    expect(await screen.findByTestId('client-meetings-tab')).toBeInTheDocument();
    await waitFor(() => {
      expect(useMatterStore.getState().clientMapHubTab).toBeNull();
    });
  });

  it('honors a meeting-sourced citation\'s request for one exact meeting (pendingMeetingOpen)', async () => {
    render(<HouseholdRecordSurface household={household} />);

    act(() => {
      useMatterStore.getState().setPendingMeetingOpen({
        meetingDir: '/practice/Diaz, Michelle/Meetings/2026-07-13-driver4-headline',
        startMs: 4200,
      });
    });

    // Consumed via queueMicrotask (matches the pre-merge MatterHub contract) —
    // give it a tick to switch tabs and clear the one-shot request.
    const tab = await screen.findByTestId('client-meetings-tab');
    await waitFor(() => {
      expect(tab).toHaveAttribute(
        'data-initial-meeting-dir',
        '/practice/Diaz, Michelle/Meetings/2026-07-13-driver4-headline',
      );
    });
    expect(tab).toHaveAttribute('data-matter-id', 'matter-diaz');
    await waitFor(() => {
      expect(useMatterStore.getState().pendingMeetingOpen).toBeNull();
    });
  });

  it('clears a household A meeting selection when the advisor switches to household B (codex-review round-2 P1 client-switch regression)', async () => {
    // ClientsSurface keeps HouseholdRecordSurface mounted across a household
    // switch and only swaps its `household` prop (no per-household `key`) —
    // `rerender` on the same instance reproduces that exactly.
    const { rerender } = render(<HouseholdRecordSurface household={household} />);
    fireEvent.click(screen.getByRole('button', { name: 'Meeting Notes' }));

    act(() => {
      useMatterStore.getState().setPendingMeetingOpen({
        meetingDir: '/practice/Diaz, Michelle/Meetings/2026-07-13-driver4-headline',
        startMs: 4200,
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId('client-meetings-tab')).toHaveAttribute(
        'data-initial-meeting-dir',
        '/practice/Diaz, Michelle/Meetings/2026-07-13-driver4-headline',
      );
    });

    // The advisor switches to a different client (the real navigation code
    // sets these two together — matterDocumentNavigation.ts / useGlobalEventBus.ts).
    act(() => {
      useMatterStore.getState().setActiveMatter('matter-second');
      useMatterStore.getState().setClientMapHubId('matter-second');
    });
    rerender(<HouseholdRecordSurface household={householdB} />);

    // Household A's meeting must NOT be handed to household B's mounted tab.
    const tabAfterSwitch = screen.getByTestId('client-meetings-tab');
    expect(tabAfterSwitch).toHaveAttribute('data-matter-id', 'matter-second');
    expect(tabAfterSwitch).toHaveAttribute('data-initial-meeting-dir', '');
  });
});
