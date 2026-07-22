import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { ClientsSurface } from './ClientsSurface';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useScopeUpdateStore } from '@/platform/rag/scopeUpdateStore';
import { setDevFlagOverride } from '@/platform/flags';
import {
  issueSharedClientSelection,
  replaceCanonicalHouseholdDirectory,
  requestClearClientSelection,
  requestSharedClientSelection,
} from '@/platform/client-context';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type { Household, Person } from '@/platform/crm/types';
import {
  householdRecordExtensionRegistry,
  type HouseholdRecordExtensionDescriptor,
} from './recordRegistry';
import {
  createDirectoryComposition,
  type DirectoryQueryDescriptor,
} from './directoryRegistry';

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

async function sealImportedHouseholdSelection(
  householdId = 'wealthbox-household-1',
  displayName = 'Abernathy Household',
) {
  replaceCanonicalHouseholdDirectory('wealthbox', [{
    provider: 'wealthbox',
    householdId,
    displayName,
  }]);
  requestClearClientSelection();
  await requestSharedClientSelection(issueSharedClientSelection({
    provider: 'wealthbox',
    householdId,
    displayName,
  }));
}

describe('ClientsSurface during a CRM search update', () => {
  beforeEach(() => {
    localStorage.clear();
    setDevFlagOverride('selection-authority-boot-gate', false);
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
    requestClearClientSelection();
    replaceCanonicalHouseholdDirectory('wealthbox', null);
    useScopeUpdateStore.getState().begin({
      id: 'matter:/practice/Abernathy Household',
      kind: 'matter',
      label: 'Updating search scope for 1 folder',
      excludeFolders: ['/practice/Abernathy Household'],
    });
  });

  afterEach(() => {
    cleanup();
    setDevFlagOverride('record-employment', undefined);
    setDevFlagOverride('selection-authority-boot-gate', undefined);
    replaceCanonicalHouseholdDirectory('wealthbox', null);
    requestClearClientSelection();
    useScopeUpdateStore.getState().clearAll();
  });

  it('opens the one sealed imported household under production selection authority while its search update is still running', async () => {
    setDevFlagOverride('selection-authority-boot-gate', undefined);
    await sealImportedHouseholdSelection();
    render(<ClientsSurface />);

    expect(screen.getByTestId('crm-household-record')).toBeInTheDocument();
    expect(screen.getByText('Abernathy Household')).toBeInTheDocument();
  });

  it('closes detail immediately when the sealed import link becomes mismatched', async () => {
    setDevFlagOverride('selection-authority-boot-gate', true);
    await sealImportedHouseholdSelection();
    const view = render(<ClientsSurface />);
    expect(screen.getByTestId('crm-household-record')).toBeInTheDocument();

    act(() => {
      useMatterStore.setState((state) => ({
        matters: state.matters.map((matter) => matter.id === 'matter-wealthbox-1'
          ? { ...matter, crmHouseholdKeys: ['different-household'] }
          : matter),
      }));
      view.rerender(<ClientsSurface />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('crm-directory-surface')).toBeInTheDocument();
      expect(screen.queryByTestId('crm-household-record')).not.toBeInTheDocument();
    });
  });

  it('uses the sealed household rather than record order when two imports share one matter', async () => {
    setDevFlagOverride('selection-authority-boot-gate', true);
    await sealImportedHouseholdSelection();
    const view = render(<ClientsSurface />);
    act(() => {
      useMatterStore.setState((state) => ({
        matters: state.matters.map((matter) => matter.id === 'matter-wealthbox-1'
          ? { ...matter, crmHouseholdKeys: ['wealthbox-household-1', 'wealthbox-household-2'] }
          : matter),
      }));
      replaceCanonicalHouseholdDirectory('wealthbox', [{
        provider: 'wealthbox',
        householdId: 'wealthbox-household-2',
        displayName: 'Second household',
      }, {
        provider: 'wealthbox',
        householdId: 'wealthbox-household-1',
        displayName: 'Abernathy Household',
      }]);
      view.rerender(<ClientsSurface />);
    });

    await act(async () => {
      await requestSharedClientSelection(issueSharedClientSelection({
        provider: 'wealthbox',
        householdId: 'wealthbox-household-2',
        displayName: 'Second household',
      }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('crm-household-record')).toHaveTextContent('Second household');
      expect(screen.queryByRole('heading', { name: 'Abernathy Household' })).not.toBeInTheDocument();
    });
  });

  it('shows an imported household in the directory and lets the advisor open it before search is ready', async () => {
    useMatterStore.setState({ activeMatterId: null, clientMapHubId: null });
    render(<ClientsSurface />);

    expect(screen.queryByText('No households match this search.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('crm-directory-household-matter-wealthbox-1'));
    expect(await screen.findByTestId('crm-household-record')).toBeInTheDocument();
    expect(screen.getByText('Abernathy Household')).toBeInTheDocument();
  });

  it('maps canonical live-record projection fields into household and person directory projections', () => {
    const canonicalHouseholdTags = {
      kind: 'household',
      tagIds: ['tag:priority'],
    } satisfies Pick<Household, 'kind' | 'tagIds'>;
    const canonicalPersonTags = {
      kind: 'person',
      tagIds: ['tag:trusted-contact'],
    } satisfies Pick<Person, 'kind' | 'tagIds'>;
    liveCrm.records = [{
      id: 'household-timestamps-1',
      ...canonicalHouseholdTags,
      matterId: 'matter-wealthbox-1',
      name: 'Abernathy Household',
      createdAt: '2026-07-10T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z',
      members: [{
        id: 'person-timestamps-1',
        ...canonicalPersonTags,
        name: 'Avery Abernathy',
        personType: 'person',
        roles: [],
        relatedHouseholds: 1,
        createdAt: '2026-07-08T00:00:00.000Z',
        updatedAt: '2026-07-09T00:00:00.000Z',
      }],
    }, {
      id: 'household-without-tags',
      kind: 'household',
      name: 'Household without tags',
      members: [{
        id: 'person-without-tags',
        name: 'Person without tags',
        personType: 'person',
        roles: [],
        relatedHouseholds: 1,
      }],
    }, {
      id: 'activity-household-timestamps-1',
      kind: 'activityEvent',
      householdId: 'household-timestamps-1',
      at: '2026-07-12T00:00:00.000Z',
    }, {
      id: 'activity-person-timestamps-1',
      kind: 'activityEvent',
      at: '2026-07-13T00:00:00.000Z',
      targetRef: { kind: 'person', id: 'person-timestamps-1' },
    }];
    useMatterStore.setState({ activeMatterId: null, clientMapHubId: null });
    const observed = vi.fn();
    const timestampProbe: DirectoryQueryDescriptor<'test-timestamp-probe'> = {
      id: 'test-timestamp-probe',
      order: 10,
      isActive: () => true,
      filter: (result) => {
        observed(result.kind, result.record.id, result.record.createdAt, result.record.updatedAt, result.record.tagIds, result.record.lastActivityAt);
        return true;
      },
    };

    render(<ClientsSurface directoryComposition={createDirectoryComposition({ queries: [timestampProbe] })} />);

    expect(observed).toHaveBeenCalledWith(
      'household',
      'matter-wealthbox-1',
      '2026-07-10T00:00:00.000Z',
      '2026-07-11T00:00:00.000Z',
      ['tag:priority'],
      '2026-07-12T00:00:00.000Z',
    );
    expect(observed).toHaveBeenCalledWith(
      'person',
      'person-timestamps-1',
      '2026-07-08T00:00:00.000Z',
      '2026-07-09T00:00:00.000Z',
      ['tag:trusted-contact'],
      '2026-07-13T00:00:00.000Z',
    );
    expect(observed).toHaveBeenCalledWith(
      'household',
      'household-without-tags',
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(observed).toHaveBeenCalledWith(
      'person',
      'person-without-tags',
      undefined,
      undefined,
      undefined,
      undefined,
    );
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

  it('saves employment through ClientsSurface and rehydrates it without losing a sibling bag', async () => {
    setDevFlagOverride('record-employment', true);
    liveCrm.records = [
      {
        id: 'household-employment-1',
        kind: 'household',
        matterId: 'matter-wealthbox-1',
        name: 'Abernathy Household',
        lifecycle: 'Active',
        primaryAdvisor: 'Maya',
        serviceTier: 'Standard',
        members: [
          {
            id: 'member-1',
            name: 'Avery Abernathy',
            personType: 'person',
            roles: [],
            relatedHouseholds: 1,
          },
        ],
        extensionData: {
          'another-feature.value': { survives: true },
        },
      },
    ];
    useMatterStore.setState({ clientMapHubId: 'matter-wealthbox-1' });

    const firstRender = render(<ClientsSurface />);

    fireEvent.click(screen.getByTestId('crm-employment-edit'));
    fireEvent.change(screen.getByTestId('crm-employment-occupation'), {
      target: { value: 'Architect' },
    });
    fireEvent.change(screen.getByTestId('crm-employment-employer'), {
      target: { value: 'Abernathy Studio' },
    });
    fireEvent.change(screen.getByTestId('crm-employment-start'), {
      target: { value: '2012-06-01' },
    });
    fireEvent.change(screen.getByTestId('crm-employment-retirement'), {
      target: { value: '2030-01-01' },
    });
    fireEvent.change(screen.getByTestId('crm-employment-reduced-schedule'), {
      target: { value: 'Three days per week first' },
    });
    fireEvent.change(screen.getByTestId('crm-employment-income'), {
      target: { value: '284000' },
    });
    fireEvent.click(screen.getByTestId('crm-employment-save'));

    await waitFor(() => {
      expect(liveCrm.save).toHaveBeenCalledTimes(1);
    });
    const savedRecord = liveCrm.save.mock.calls[0]?.[0] as
      | LiveCrmRecord
      | undefined;
    expect(savedRecord).toMatchObject({
      kind: 'household',
      matterId: 'matter-wealthbox-1',
      extensionData: {
        'crm.employment': {
          version: 1,
          members: {
            'member-1': {
              occupation: 'Architect',
              employer: 'Abernathy Studio',
              occupationStart: '2012-06-01',
              plannedRetirement: '2030-01-01',
              reducedScheduleContext: 'Three days per week first',
            },
          },
          householdGrossAnnualIncome: 284000,
        },
        'another-feature.value': { survives: true },
      },
    });
    if (!savedRecord)
      throw new Error('Expected ClientsSurface to save the household');

    firstRender.unmount();
    liveCrm.records = [savedRecord];
    render(<ClientsSurface />);

    expect(screen.getByTestId('crm-employment-section')).toBeInTheDocument();
    expect(screen.getByTestId('crm-employment-occupation-value')).toHaveTextContent('Architect');
    expect(screen.getByTestId('crm-employment-income-value')).toHaveTextContent(
      '$284,000 household'
    );

    fireEvent.click(screen.getByTestId('crm-employment-edit'));
    fireEvent.click(screen.getByTestId('crm-employment-save'));
    await waitFor(() => {
      expect(liveCrm.save).toHaveBeenCalledTimes(2);
    });
    const rehydratedRecord = liveCrm.save.mock.calls[1]?.[0] as
      | LiveCrmRecord
      | undefined;
    expect(rehydratedRecord).toMatchObject({
      extensionData: {
        'crm.employment': {
          version: 1,
          members: {
            'member-1': {
              occupation: 'Architect',
              employer: 'Abernathy Studio',
              occupationStart: '2012-06-01',
              plannedRetirement: '2030-01-01',
              reducedScheduleContext: 'Three days per week first',
            },
          },
          householdGrossAnnualIncome: 284000,
        },
        'another-feature.value': { survives: true },
      },
    });
  });

  it('keeps every extension namespace through save and reload', async () => {
    localStorage.setItem(
      'lantern:feature-flags',
      JSON.stringify({ 'record-investment-profile': true })
    );
    setDevFlagOverride('selection-authority-boot-gate', false);
    liveCrm.records = [
      {
        id: 'household-investment-profile',
        kind: 'household',
        matterId: 'matter-wealthbox-1',
        name: 'Abernathy Household',
        extensionData: {
          'investment-profile.profile': {
            investmentObjective: 'growth',
            riskTolerance: 'moderate',
            timeHorizon: 'over-10-years',
            liquidityNeed: '$90K in 2 years',
          },
          'another-feature.value': { stays: 'intact' },
        },
      },
    ];

    render(<ClientsSurface />);

    expect(screen.getByLabelText('Investment objective')).toHaveValue('growth');
    expect(screen.getByLabelText('Risk tolerance')).toHaveValue('moderate');
    expect(screen.getByLabelText('Time horizon')).toHaveValue('over-10-years');
    expect(screen.getByLabelText('Liquidity need')).toHaveValue('$90K in 2 years');
    fireEvent.change(screen.getByLabelText('Liquidity need'), {
      target: { value: '$120K in 3 years' },
    });
    fireEvent.click(screen.getByTestId('investment-profile-save'));

    await waitFor(() => {
      expect(liveCrm.save).toHaveBeenCalledTimes(1);
    });
    expect(liveCrm.save.mock.calls[0]?.[0]).toMatchObject({
      id: 'household-investment-profile',
      extensionData: {
        'investment-profile.profile': {
          investmentObjective: 'growth',
          riskTolerance: 'moderate',
          timeHorizon: 'over-10-years',
          liquidityNeed: '$120K in 3 years',
        },
        'another-feature.value': { stays: 'intact' },
      },
    });
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
    setDevFlagOverride('selection-authority-boot-gate', false);
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
