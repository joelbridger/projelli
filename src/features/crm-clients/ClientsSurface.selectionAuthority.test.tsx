import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import {
  issueAllMattersScopeSelection,
  issueMatterScopeSelection,
  replaceCanonicalHouseholdDirectory,
  requestClearClientSelection,
  requestMatterScopeSelection,
  useSelectionPresentation,
} from '@/platform/client-context';
import { setDevFlagOverride } from '@/platform/flags';
import { useMatterStore } from '@/platform/matter/matterStore';
import { ClientsSurface } from './ClientsSurface';

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
    workspaceRoot: '/selection-authority-practice',
    freshness: { kind: 'live' },
    sharedMatterId: null,
  }),
}));

const householdA = {
  provider: 'wealthbox' as const,
  householdId: 'household-a',
  displayName: 'Alpha household',
};
const householdB = {
  provider: 'wealthbox' as const,
  householdId: 'household-b',
  displayName: 'Beta household',
};

function BarFacingAuthority() {
  const selection = useSelectionPresentation();
  const name = selection.scope.kind === 'matter'
    ? selection.matterId === 'matter-a'
      ? 'Alpha household'
      : selection.matterId === 'matter-b'
        ? 'Beta household'
        : 'Unknown household'
    : 'Directory';
  return <output data-testid="bar-facing-authority">{name}</output>;
}

async function selectMatter(matterId: string) {
  return requestMatterScopeSelection(issueMatterScopeSelection(matterId));
}

beforeEach(async () => {
  localStorage.clear();
  setDevFlagOverride('selection-authority-boot-gate', false);
  useMatterStore.setState({
    matters: [
      {
        id: 'matter-a',
        name: 'Alpha household',
        client: 'Alpha household',
        folderPaths: [],
        crmHouseholdKeys: ['household-a'],
        createdAt: '2026-07-22T00:00:00.000Z',
      },
      {
        id: 'matter-b',
        name: 'Beta household',
        client: 'Beta household',
        folderPaths: [],
        crmHouseholdKeys: ['household-b'],
        createdAt: '2026-07-22T00:00:00.000Z',
      },
    ],
    activeMatterId: null,
    clientMapHubId: null,
  });
  replaceCanonicalHouseholdDirectory('wealthbox', null);
  requestClearClientSelection();
  setDevFlagOverride('selection-authority-boot-gate', true);
  replaceCanonicalHouseholdDirectory('wealthbox', [householdA, householdB]);
  liveCrm.records = [
    {
      id: 'household-a',
      kind: 'household',
      matterId: 'matter-a',
      name: 'Alpha household',
      lifecycle: 'Active',
      primaryAdvisor: 'Avery Advisor',
      serviceTier: 'Standard',
    },
    {
      id: 'household-b',
      kind: 'household',
      matterId: 'matter-b',
      name: 'Beta household',
      lifecycle: 'Active',
      primaryAdvisor: 'Blair Advisor',
      serviceTier: 'Standard',
    },
  ];
  liveCrm.save.mockReset();
  liveCrm.reload.mockReset();
  await selectMatter('matter-a');
  await waitFor(() => {
    expect(useMatterStore.getState().activeMatterId).toBe('matter-a');
  });
});

afterEach(() => {
  cleanup();
  setDevFlagOverride('selection-authority-boot-gate', false);
  useMatterStore.setState({ matters: [], activeMatterId: null, clientMapHubId: null });
  replaceCanonicalHouseholdDirectory('wealthbox', null);
  requestClearClientSelection();
  localStorage.clear();
  setDevFlagOverride('selection-authority-boot-gate', undefined);
});

describe('ClientsSurface selection authority', () => {
  it('keeps the visible CRM household exactly aligned with the sealed authority', async () => {
    render(<><BarFacingAuthority /><ClientsSurface /></>);

    expect(await screen.findByTestId('crm-household-record')).toHaveTextContent('Alpha household');
    expect(screen.getByTestId('bar-facing-authority')).toHaveTextContent('Alpha household');

    await act(async () => {
      await selectMatter('matter-b');
    });

    await waitFor(() => {
      expect(screen.getByTestId('crm-household-record')).toHaveTextContent('Beta household');
      expect(screen.getByTestId('bar-facing-authority')).toHaveTextContent('Beta household');
      expect(screen.queryByRole('heading', { name: 'Alpha household' })).not.toBeInTheDocument();
    });

    await act(async () => {
      await requestMatterScopeSelection(issueAllMattersScopeSelection());
    });

    await waitFor(() => {
      expect(screen.getByTestId('crm-directory-surface')).toBeInTheDocument();
      expect(screen.getByTestId('bar-facing-authority')).toHaveTextContent('Directory');
      expect(screen.queryByRole('heading', { name: 'Beta household' })).not.toBeInTheDocument();
    });

    await act(async () => {
      await selectMatter('matter-a');
      const refused = await selectMatter('missing-matter');
      expect(refused).toMatchObject({ kind: 'refused' });
    });

    await waitFor(() => {
      expect(screen.getByTestId('crm-directory-surface')).toBeInTheDocument();
      expect(screen.getByTestId('bar-facing-authority')).toHaveTextContent('Directory');
      expect(screen.queryByRole('heading', { name: 'Alpha household' })).not.toBeInTheDocument();
    });

    await act(async () => {
      await selectMatter('matter-b');
    });
    await waitFor(() => {
      expect(screen.getByTestId('crm-household-record')).toHaveTextContent('Beta household');
    });

    const staleAlphaRequest = issueMatterScopeSelection('matter-a');
    await act(async () => {
      await selectMatter('matter-b');
      const refused = await requestMatterScopeSelection(staleAlphaRequest);
      expect(refused).toMatchObject({ kind: 'refused', reason: 'stale-matter-scope-request' });
    });

    await waitFor(() => {
      expect(screen.getByTestId('crm-directory-surface')).toBeInTheDocument();
      expect(screen.getByTestId('bar-facing-authority')).toHaveTextContent('Directory');
      expect(screen.queryByRole('heading', { name: 'Alpha household' })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Beta household' })).not.toBeInTheDocument();
    });
  });
});
