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
// navigation path exists from the client surface's tab row, and (b) the
// event-bus's one-shot navigation requests (`clientMapHubTab`/
// `pendingMeetingOpen`) — previously written but never read by anything —
// are now honored.

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

describe('client surface Meeting Notes entry point', () => {
  beforeEach(() => {
    liveCrm.records = [{
      id: household.id,
      kind: 'household',
      matterId: 'matter-diaz',
      name: household.name,
    }];
    useMatterStore.setState({
      matters: [
        {
          id: 'matter-diaz',
          name: 'Diaz, Michelle',
          client: 'Diaz, Michelle',
          folderPaths: ['/practice/Diaz, Michelle'],
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
    expect(await screen.findByTestId('client-meetings-tab')).toBeInTheDocument();
    await waitFor(() => {
      expect(useMatterStore.getState().pendingMeetingOpen).toBeNull();
    });
  });
});
