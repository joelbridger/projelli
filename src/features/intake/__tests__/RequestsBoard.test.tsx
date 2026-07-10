import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EV_MATTER_LAUNCH } from '@/config/identity';
import { useIntakeStore, type IntakeRecord } from '@/platform/intake/intakeStore';
import { useMatterStore } from '@/platform/matter/matterStore';
import { intakeFactList, intakeFactMatchList } from '@/platform/intake/factsStore';
import { RequestsBoard } from '../RequestsBoard';

vi.mock('@/platform/intake/factsStore', () => ({
  intakeFactList: vi.fn(),
  intakeFactMatchList: vi.fn(),
}));

const now = new Date('2026-07-10T12:00:00.000Z');

function intake(overrides: Partial<IntakeRecord>): IntakeRecord {
  return {
    intakeId: overrides.intakeId ?? 'request-1', matterId: overrides.matterId ?? 'matter-1',
    clientFirstName: overrides.clientFirstName ?? 'Sarah', firmName: 'North Star',
    status: 'active', expiresAt: '2026-08-09T00:00:00.000Z', checklistVersion: 1,
    items: overrides.items ?? [{ itemId: 'item', label: 'Safe label', state: 'not_started' }],
    receivedItems: overrides.receivedItems ?? [], flags: overrides.flags ?? [],
    knownSessionIds: [], knownSubmissionIds: [], nudges: [], ...overrides,
  };
}

describe('RequestsBoard', () => {
  beforeEach(() => {
    useIntakeStore.getState().resetForTests();
    useMatterStore.setState({ clientMapHubTab: null, clientMapHubRequestId: null });
    vi.clearAllMocks();
  });

  it('sorts all requests by the established priority, filters onboarding from the same set, and never reads facts', () => {
    const store = useIntakeStore.getState();
    store.upsertIntake(intake({ intakeId: 'review', kind: 'standing', requestTitle: 'Tax return', clientFirstName: 'Review', items: [{ itemId: 'a', label: 'Tax return', state: 'received' }, { itemId: 'b', label: 'Safe label', state: 'not_started' }], lastClientActivityAt: '2026-07-09T00:00:00.000Z' }));
    store.upsertIntake(intake({ intakeId: 'stalled', kind: 'onboarding', clientFirstName: 'Stalled', lastClientActivityAt: '2026-07-01T00:00:00.000Z' }));
    store.upsertIntake(intake({ intakeId: 'link-issue', kind: 'standing', requestTitle: 'Beneficiary update', clientFirstName: 'Link', expiresAt: '2026-07-11T00:00:00.000Z' }));
    store.upsertIntake(intake({ intakeId: 'quiet', kind: 'onboarding', clientFirstName: 'Quiet', lastClientActivityAt: '2026-07-10T00:00:00.000Z' }));

    render(<RequestsBoard now={now} />);
    fireEvent.click(screen.getByTestId('requests-filter-all'));
    expect(screen.getAllByTestId(/^requests-board-row-/).map((row) => row.getAttribute('data-testid'))).toEqual([
      'requests-board-row-review', 'requests-board-row-stalled', 'requests-board-row-link-issue', 'requests-board-row-quiet',
    ]);
    expect(screen.getByText('Tax return')).toBeTruthy();
    expect(intakeFactList).not.toHaveBeenCalled();
    expect(intakeFactMatchList).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('requests-filter-onboarding'));
    expect(screen.getAllByTestId(/^requests-board-row-/).map((row) => row.getAttribute('data-testid'))).toEqual([
      'requests-board-row-stalled', 'requests-board-row-quiet',
    ]);
  });

  it('opens the exact request, not just its client', () => {
    useIntakeStore.getState().upsertIntake(intake({ intakeId: 'onboarding-1', matterId: 'same-client', kind: 'onboarding' }));
    useIntakeStore.getState().upsertIntake(intake({ intakeId: 'standing-1', matterId: 'same-client', kind: 'standing', requestTitle: 'Tax return' }));
    const launches: unknown[] = [];
    const listener = (event: Event) => { launches.push((event as CustomEvent).detail); };
    window.addEventListener(EV_MATTER_LAUNCH, listener);
    render(<RequestsBoard now={now} />);
    fireEvent.click(screen.getByTestId('requests-filter-all'));
    fireEvent.click(screen.getByTestId('onboarding-board-row-standing-1'));
    expect(launches).toEqual([{ matterId: 'same-client', surface: 'matters' }]);
    expect(useMatterStore.getState().clientMapHubTab).toBe('onboarding');
    expect(useMatterStore.getState().clientMapHubRequestId).toBe('standing-1');
    window.removeEventListener(EV_MATTER_LAUNCH, listener);
  });
});
