import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
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

  it('drops client A open editor when switching to client B', async () => {
    const contextA = context('household:a', 'matter-a', 'Foster household');
    const contextB = context('household:b', 'matter-b', 'Diaz household');
    const view = render(<RecordKindsSection context={contextA} />);

    await screen.findByTestId('record-kinds-section');
    fireEvent.click(screen.getByTestId('record-kinds-edit-person:a'));

    const editor = await screen.findByTestId('record-kinds-editor');
    expect(within(editor).getByDisplayValue('Robert')).toBeInTheDocument();
    expect(screen.getByText('Edit Robert Foster')).toBeInTheDocument();

    fixture.decision = selectedDecision(
      'household:b',
      'matter-b',
      'Diaz household'
    );
    view.rerender(<RecordKindsSection context={contextB} />);

    await waitFor(() => {
      const sectionB = screen.getByTestId('record-kinds-section');
      expect(within(sectionB).getByText('Camila Diaz')).toBeInTheDocument();
    });
    // A's open editor — its title, its form, and its field values — is gone.
    expect(screen.queryByTestId('record-kinds-editor')).not.toBeInTheDocument();
    expect(screen.queryByText('Edit Robert Foster')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Robert')).not.toBeInTheDocument();
    expect(screen.queryByText('Robert Foster')).not.toBeInTheDocument();
  });

  it('renders a client whose household has no individuals without a read failure', async () => {
    fixture.records = [
      {
        id: 'household:a',
        kind: 'household',
        matterId: 'matter-a',
        name: 'Foster household',
        lifecycle: 'Active',
        primaryAdvisor: 'Sarah Morgan',
        channels: [],
        contactLinks: [],
        contextRefs: [],
        tagIds: [],
      },
    ];
    render(
      <RecordKindsSection
        context={context('household:a', 'matter-a', 'Foster household')}
      />
    );
    const section = await screen.findByTestId('record-kinds-section');
    expect(within(section).getByText('Foster household')).toBeInTheDocument();
    expect(screen.queryByTestId('record-kinds-error')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('record-kinds-blocked')
    ).not.toBeInTheDocument();
  });

  it('fails closed (never empty) when the selected household is absent from storage', async () => {
    // A raw whole-firm store is no longer reachable from the UI, and an absent
    // household can no longer resolve to a silent empty list (Findings #1 + #2).
    fixture.records = [];
    render(
      <RecordKindsSection
        context={context('household:a', 'matter-a', 'Foster household')}
      />
    );
    expect(await screen.findByTestId('record-kinds-error')).toBeInTheDocument();
    expect(screen.queryByTestId('record-kinds-empty')).not.toBeInTheDocument();
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
