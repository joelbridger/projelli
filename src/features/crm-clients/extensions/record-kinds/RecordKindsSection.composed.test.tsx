import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type { HouseholdSectionContext } from '../../recordRegistry';

const fixture = vi.hoisted(() => ({
  records: [] as LiveCrmRecord[],
  decision: null as unknown,
  save: vi.fn(),
  reloadRecords: vi.fn(),
}));

vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  useLiveCrmRecords: () => ({
    records: fixture.records,
    save: fixture.save,
    reloadRecords: fixture.reloadRecords,
    reload: fixture.reloadRecords,
    error: null,
    workspaceRoot: '/practice',
    freshness: { kind: 'idle' },
    sharedMatterId: null,
  }),
}));

vi.mock('@/platform/client-context', () => ({
  useSelectionOperationDecision: () => fixture.decision,
  readSelectionOperationDecision: () => fixture.decision,
  readSharedClientContext: () => null,
  useClientContextStore: Object.assign(
    <T,>(selector: (state: { client: null }) => T) =>
      selector({ client: null }),
    { getState: () => ({ client: null }) }
  ),
}));

import { setDevFlagOverride } from '@/platform/flags';
import { RecordKindsSection } from './RecordKindsSection';

function context(
  householdId: string,
  matterId: string,
  name: string
): HouseholdSectionContext {
  return {
    householdRef: {
      kind: 'household',
      id: householdId,
      matterId,
      label: name,
    },
    matterId,
  };
}

function contactRecords(
  householdId: string,
  matterId: string,
  householdName: string,
  personId: string,
  firstName: string,
  lastName: string
): LiveCrmRecord[] {
  return [
    {
      id: householdId,
      kind: 'household',
      matterId,
      name: householdName,
      lifecycle: 'Active',
      primaryAdvisor: 'Sarah Morgan',
      channels: [],
      contactLinks: [],
      contextRefs: [],
      tagIds: [],
    },
    {
      id: personId,
      kind: 'person',
      matterId,
      firstName,
      lastName,
      lifecycle: 'Active',
      primaryAdvisor: 'Sarah Morgan',
      channels: [],
      contactLinks: [],
      contextRefs: [],
      tagIds: [],
    },
  ];
}

function selectedDecision(householdId: string, matterId: string, name: string) {
  return {
    kind: 'matter',
    sourceKind: 'matter',
    matter: {
      id: matterId,
      name,
      client: name,
      folderPaths: [`/practice/${name}`],
      createdAt: '2026-07-19T00:00:00.000Z',
    },
    client: {
      provider: 'wealthbox',
      householdId,
      displayName: name,
    },
  };
}

describe('record-kinds composed household surface isolation', () => {
  beforeEach(() => {
    setDevFlagOverride('record-kinds-v1', true);
    fixture.records = [
      ...contactRecords(
        'household:a',
        'matter-a',
        'Foster household',
        'person:a',
        'Robert',
        'Foster'
      ),
      ...contactRecords(
        'household:b',
        'matter-b',
        'Diaz household',
        'person:b',
        'Camila',
        'Diaz'
      ),
    ];
    fixture.decision = selectedDecision(
      'household:a',
      'matter-a',
      'Foster household'
    );
    fixture.save.mockReset();
    fixture.reloadRecords.mockReset();
    fixture.reloadRecords.mockImplementation(() =>
      Promise.resolve(fixture.records)
    );
  });

  afterEach(() => {
    cleanup();
    setDevFlagOverride('record-kinds-v1', undefined);
  });

  it('switches A to B at the composed surface with no prior-client record left behind', async () => {
    const contextA = context('household:a', 'matter-a', 'Foster household');
    const contextB = context('household:b', 'matter-b', 'Diaz household');
    const view = render(<RecordKindsSection context={contextA} />);

    const sectionA = await screen.findByTestId('record-kinds-section');
    expect(within(sectionA).getByText('Robert Foster')).toBeInTheDocument();
    expect(within(sectionA).queryByText('Camila Diaz')).not.toBeInTheDocument();

    fixture.decision = selectedDecision(
      'household:b',
      'matter-b',
      'Diaz household'
    );
    view.rerender(<RecordKindsSection context={contextB} />);

    await waitFor(() => {
      const sectionB = screen.getByTestId('record-kinds-section');
      expect(within(sectionB).getByText('Camila Diaz')).toBeInTheDocument();
      expect(
        within(sectionB).queryByText('Robert Foster')
      ).not.toBeInTheDocument();
      expect(
        within(sectionB).queryByText('Foster household')
      ).not.toBeInTheDocument();
    });
  });

  it('shows a valid empty store as empty, not as a read failure', async () => {
    fixture.records = [];
    render(
      <RecordKindsSection
        context={context('household:a', 'matter-a', 'Foster household')}
      />
    );
    expect(await screen.findByTestId('record-kinds-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('record-kinds-error')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('record-kinds-blocked')
    ).not.toBeInTheDocument();
  });

  it('keeps a mismatched active selection on the blocked branch, never the empty branch', async () => {
    fixture.decision = selectedDecision(
      'household:b',
      'matter-b',
      'Diaz household'
    );
    render(
      <RecordKindsSection
        context={context('household:a', 'matter-a', 'Foster household')}
      />
    );
    expect(
      await screen.findByTestId('record-kinds-blocked')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('record-kinds-empty')).not.toBeInTheDocument();
  });
});
