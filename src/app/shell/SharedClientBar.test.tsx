import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  SharedClientBar,
  SharedClientSurface,
} from '@/app/shell/SharedClientBar';
import {
  clientContextAdapterRegistry,
  validateClientContextAdapters,
} from '@/app/shell/client-context/clientContextAdapterRegistry';
import {
  replaceCanonicalHouseholdDirectory,
  requestClearClientSelection,
  useClientContextStore,
} from '@/platform/client-context';
import { crmClientsSharedClientContextAdapter } from '@/features/crm-clients';
import { askSharedClientContextAdapter } from '@/features/ask';
import { meetingsSharedClientContextAdapter } from '@/features/meetings';
import { readSharedClientContext } from '@/platform/client-context';
import { setDevFlagOverride } from '@/platform/flags';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import {
  __resetMattersWorkspaceDiskSyncForTests,
  hydrateMattersFromWorkspaceDisk,
  useMatterStore,
} from '@/platform/matter/matterStore';
import { setActiveWorkspaceScopeRoot } from '@/platform/state/workspaceScope';

const tauriBoundary = vi.hoisted(() => ({
  invoke:
    vi.fn<
      (command: string, args?: Record<string, unknown>) => Promise<unknown>
    >(),
  isTauri: vi.fn(() => true),
}));

vi.mock('@tauri-apps/api/core', () => tauriBoundary);

describe('shared client bar seam', () => {
  afterEach(() => {
    requestClearClientSelection();
    setDevFlagOverride('shared-client-bar', undefined);
    setDevFlagOverride('selection-authority-boot-gate', undefined);
    replaceCanonicalHouseholdDirectory('wealthbox', null);
    useMatterStore.setState({ matters: [], activeMatterId: null });
    setActiveWorkspaceScopeRoot(null);
    __resetMattersWorkspaceDiskSyncForTests();
    useWorkspaceStore.setState({ rootPath: null });
    tauriBoundary.invoke.mockReset();
  });

  it('renders no bar when the feature flag is off', () => {
    render(
      <SharedClientSurface enabled={false} clientContext="shared">
        <div data-testid="surface-content" />
      </SharedClientSurface>
    );

    expect(screen.queryByTestId('shared-client-bar')).not.toBeInTheDocument();
    expect(screen.getByTestId('surface-content')).toBeInTheDocument();
  });

  it('renders the bar only for a shared surface when the flag is on', () => {
    const { rerender } = render(
      <SharedClientSurface enabled clientContext="firm">
        <div />
      </SharedClientSurface>
    );
    expect(screen.queryByTestId('shared-client-bar')).not.toBeInTheDocument();

    rerender(
      <SharedClientSurface enabled clientContext="shared">
        <div />
      </SharedClientSurface>
    );
    expect(screen.getByTestId('shared-client-bar')).toBeInTheDocument();
  });

  it('renders the shared selection and clears it from the bar', () => {
    crmClientsSharedClientContextAdapter.selectHousehold({
      provider: 'wealthbox',
      householdId: 'household-foster',
      displayName: 'Foster household',
    });
    render(<SharedClientBar />);

    expect(screen.getByTestId('shared-client-bar-current')).toHaveTextContent(
      'Foster household'
    );
    fireEvent.click(screen.getByTestId('shared-client-bar-clear'));
    expect(screen.getByTestId('shared-client-bar-current')).toHaveTextContent(
      'No client selected'
    );
  });

  it('keeps legacy plumbing off and swaps to the v1 bar only when enabled', () => {
    setDevFlagOverride('shared-client-bar', false);
    const { rerender } = render(<SharedClientBar />);
    expect(screen.getByTestId('shared-client-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('client-bar-v1')).not.toBeInTheDocument();

    setDevFlagOverride('shared-client-bar', true);
    rerender(<SharedClientBar />);
    expect(screen.getByTestId('client-bar-v1')).toBeInTheDocument();
    expect(screen.queryByTestId('shared-client-bar')).not.toBeInTheDocument();
  });

  it('keeps a locally saved client visible and selectable with production authority on and no Wealthbox call', async () => {
    tauriBoundary.invoke.mockImplementation((command) => {
      if (command === 'crm_set_workspace') return Promise.resolve(undefined);
      if (command === 'crm_live_list') {
        return Promise.resolve([
          {
            id: 'household-hendricks',
            kind: 'household',
            matterId: 'matter-hendricks',
            name: 'Hendricks household',
          },
          {
            id: 'household-unlinked',
            kind: 'household',
            matterId: 'matter-unlinked',
            name: 'Unlinked household',
          },
        ]);
      }
      return Promise.reject(new Error(`Unexpected native command: ${command}`));
    });
    useWorkspaceStore.setState({ rootPath: 'C:\\Lantern-M1-Smoke' });
    setActiveWorkspaceScopeRoot('C:\\Lantern-M1-Smoke');
    await hydrateMattersFromWorkspaceDisk('C:\\Lantern-M1-Smoke');
    useMatterStore.setState({
      matters: [
        {
          id: 'matter-hendricks',
          name: 'Hendricks plan',
          client: 'Hendricks fallback',
          folderPaths: [],
          crmHouseholdKeys: ['household-hendricks'],
          createdAt: '2026-07-22T00:00:00.000Z',
        },
        {
          id: 'matter-ambiguous-a',
          name: 'Ambiguous A',
          client: 'Ambiguous A',
          folderPaths: [],
          crmHouseholdKeys: ['household-ambiguous'],
          createdAt: '2026-07-22T00:00:00.000Z',
        },
        {
          id: 'matter-ambiguous-b',
          name: 'Ambiguous B',
          client: 'Ambiguous B',
          folderPaths: [],
          crmHouseholdKeys: ['household-ambiguous'],
          createdAt: '2026-07-22T00:00:00.000Z',
        },
        {
          id: 'matter-archived',
          name: 'Archived client',
          client: 'Archived client',
          folderPaths: [],
          crmHouseholdKeys: ['household-archived'],
          archived: true,
          createdAt: '2026-07-22T00:00:00.000Z',
        },
      ],
      activeMatterId: null,
    });
    setDevFlagOverride('shared-client-bar', true);
    setDevFlagOverride('selection-authority-boot-gate', true);
    render(<SharedClientBar />);

    fireEvent.click(screen.getByTestId('client-bar-picker'));

    await waitFor(() => {
      expect(
        screen.getByTestId('client-picker-option-household-hendricks')
      ).toHaveTextContent('Hendricks household');
    });
    expect(
      screen.queryByTestId('client-picker-option-household-unlinked')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('client-picker-option-household-ambiguous')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('client-picker-option-household-archived')
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByTestId('client-picker-option-household-hendricks')
    );

    await waitFor(() => {
      expect(useClientContextStore.getState().client).toMatchObject({
        householdId: 'household-hendricks',
        displayName: 'Hendricks household',
      });
    });
    expect(useMatterStore.getState().activeMatterId).toBe('matter-hendricks');
    expect(tauriBoundary.invoke).toHaveBeenCalledWith('crm_live_list');
    expect(
      tauriBoundary.invoke.mock.calls.some(
        ([command]) => command === 'crm_list_households'
      )
    ).toBe(false);
  });

  it('propagates one CRM selection across Ask and Meetings adapters', () => {
    crmClientsSharedClientContextAdapter.selectHousehold({
      provider: 'wealthbox',
      householdId: 'household-foster',
      displayName: 'Foster household',
    });

    expect(readSharedClientContext(askSharedClientContextAdapter)).toEqual({
      scope: 'client',
      householdId: 'household-foster',
    });
    expect(readSharedClientContext(meetingsSharedClientContextAdapter)).toEqual(
      {
        filter: 'client',
        householdId: 'household-foster',
      }
    );

    meetingsSharedClientContextAdapter.showAllMeetings();
    expect(readSharedClientContext(askSharedClientContextAdapter)).toEqual({
      scope: 'whole-firm',
    });
  });

  it('registers one adapter for CRM clients, Ask, and Meetings', () => {
    expect(clientContextAdapterRegistry.map((adapter) => adapter.id)).toEqual([
      'crm-clients',
      'ask',
      'meetings',
    ]);
    expect(() => {
      validateClientContextAdapters([
        clientContextAdapterRegistry[0],
        clientContextAdapterRegistry[0],
      ]);
    }).toThrow(/duplicate adapter id/);
  });
});
