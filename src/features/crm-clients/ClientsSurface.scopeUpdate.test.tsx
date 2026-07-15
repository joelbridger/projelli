import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ClientsSurface } from './ClientsSurface';
import {
  householdRecordExtensionRegistry,
  type HouseholdRecordExtensionDescriptor,
} from './recordRegistry';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useScopeUpdateStore } from '@/platform/rag/scopeUpdateStore';

const liveCrm = vi.hoisted(() => ({
  records: [] as Array<Record<string, unknown>>,
  save: vi.fn(),
  reload: vi.fn(),
}));

vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  useLiveCrmRecords: () => ({
    records: liveCrm.records,
    save: liveCrm.save,
    reload: liveCrm.reload,
    error: null,
    workspaceRoot: '/practice',
    freshness: { kind: 'syncing', lastSyncedAt: '2026-07-13T00:00:00.000Z' },
    sharedMatterId: null,
  }),
}));

describe('ClientsSurface during a CRM search update', () => {
  beforeEach(() => {
    localStorage.clear();
    liveCrm.records = [];
    liveCrm.save.mockReset();
    liveCrm.reload.mockReset();
    useScopeUpdateStore.getState().clearAll();
    useMatterStore.setState({
      matters: [
        {
          id: 'matter-wealthbox-1',
          name: 'Abernathy Household',
          client: 'Abernathy Household',
          folderPaths: ['/practice/Abernathy Household'],
          crmHouseholdKeys: ['wealthbox-household-1'],
          createdFromCrm: true,
          createdAt: '2026-07-13T00:00:00.000Z',
        },
      ],
      activeMatterId: 'matter-wealthbox-1',
      clientMapHubId: 'matter-wealthbox-1',
    });
    useScopeUpdateStore.getState().begin({
      id: 'matter:/practice/Abernathy Household',
      kind: 'matter',
      label: 'Updating search scope for 1 folder',
      excludeFolders: ['/practice/Abernathy Household'],
    });
  });

  afterEach(() => {
    cleanup();
    useScopeUpdateStore.getState().clearAll();
    const extensionRegistry =
      householdRecordExtensionRegistry as HouseholdRecordExtensionDescriptor[];
    const probeIndex = extensionRegistry.findIndex(
      (descriptor) => descriptor.id === 'future-extension-test-probe'
    );
    if (probeIndex >= 0) extensionRegistry.splice(probeIndex, 1);
  });

  it('opens an imported household selected in the sidebar while its search update is still running', () => {
    render(<ClientsSurface />);

    expect(screen.getByTestId('crm-household-record')).toBeInTheDocument();
    expect(screen.getByText('Abernathy Household')).toBeInTheDocument();
  });

  it('shows an imported household in the directory and lets the advisor open it before search is ready', () => {
    useMatterStore.setState({ activeMatterId: null, clientMapHubId: null });
    render(<ClientsSurface />);

    expect(screen.queryByText('No households match this search.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('crm-directory-household-matter-wealthbox-1'));
    expect(screen.getByTestId('crm-household-record')).toBeInTheDocument();
    expect(screen.getByText('Abernathy Household')).toBeInTheDocument();
  });

  it('never locks the imported household if its search update fails', () => {
    useScopeUpdateStore.getState().markFailed('matter:/practice/Abernathy Household');
    render(<ClientsSurface />);

    expect(screen.getByTestId('crm-household-record')).toBeInTheDocument();
    expect(screen.getByText('Abernathy Household')).toBeInTheDocument();
  });

  it('returns to the shared directory when the advisor chooses All clients', () => {
    render(<ClientsSurface />);
    expect(screen.getByTestId('crm-household-record')).toBeInTheDocument();

    act(() => {
      useMatterStore.getState().setClientMapHubId(null);
      useMatterStore.getState().setActiveMatter(null);
    });

    expect(screen.getByTestId('crm-directory-surface')).toBeInTheDocument();
    expect(screen.getByTestId('crm-directory-household-matter-wealthbox-1')).toBeInTheDocument();
  });

  it('saves professional contacts without changing other extension bags, then rehydrates both after remount', async () => {
    type FutureExtension = { survives: string };
    const futureExtension: HouseholdRecordExtensionDescriptor = {
      id: 'future-extension-test-probe',
      dataKey: 'future.extension' as never,
      defaultValue: { survives: '' },
      validate: (value): value is FutureExtension =>
        typeof value === 'object' &&
        value !== null &&
        typeof (value as Record<string, unknown>)['survives'] === 'string',
      renderSummary: ({ value }) => (
        <span data-testid="future-extension-summary">
          {(value as FutureExtension).survives}
        </span>
      ),
    };
    const extensionRegistry =
      householdRecordExtensionRegistry as HouseholdRecordExtensionDescriptor[];
    extensionRegistry.push(futureExtension);
    localStorage.setItem(
      'lantern:feature-flags',
      JSON.stringify({
        'record-professional-contacts': true,
      })
    );
    liveCrm.records = [
      {
        id: 'household-1',
        kind: 'household',
        matterId: 'matter-wealthbox-1',
        name: 'Abernathy Household',
        extensionData: {
          'crm.professional-contacts': {
            trusted_contact: {
              name: 'Prior trusted contact',
              relationship: 'Previous relationship',
              organization: '',
              email: '',
              phone: '',
              notes: '',
            },
            cpa: null,
            estate_attorney: null,
            insurance_professional: null,
          },
          'future.extension': { survives: 'Sibling extension content' },
        },
      },
    ];
    let savedRecord: Record<string, unknown> | undefined;
    liveCrm.save.mockImplementation((record: Record<string, unknown>) => {
      savedRecord = record;
      liveCrm.records = [record];
      return Promise.resolve(record);
    });

    const firstMount = render(<ClientsSurface />);

    fireEvent.click(
      screen.getByTestId('professional-contacts-edit-trusted_contact')
    );
    fireEvent.change(
      screen.getByTestId('professional-contacts-name-trusted_contact'),
      { target: { value: 'Amelia Foster' } }
    );
    fireEvent.change(
      screen.getByTestId('professional-contacts-relationship-trusted_contact'),
      { target: { value: 'Daughter' } }
    );
    fireEvent.click(
      screen.getByTestId('professional-contacts-save-trusted_contact')
    );

    await vi.waitFor(() => {
      expect(savedRecord).toBeDefined();
    });
    expect(savedRecord?.['extensionData']).toMatchObject({
      'crm.professional-contacts': {
        trusted_contact: {
          name: 'Amelia Foster',
          relationship: 'Daughter',
        },
      },
      'future.extension': { survives: 'Sibling extension content' },
    });

    firstMount.unmount();
    render(<ClientsSurface />);

    expect(
      screen.getByTestId('professional-contacts-summary-trusted_contact')
    ).toHaveTextContent('Amelia Foster');
    expect(screen.getByTestId('future-extension-summary')).toHaveTextContent(
      'Sibling extension content'
    );
  });
});
