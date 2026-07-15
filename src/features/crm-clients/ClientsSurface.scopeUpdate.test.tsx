import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ClientsSurface } from './ClientsSurface';
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

  it('keeps every extension namespace through save and reload', async () => {
    localStorage.setItem(
      'lantern:feature-flags',
      JSON.stringify({ 'record-investment-profile': true })
    );
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
});
