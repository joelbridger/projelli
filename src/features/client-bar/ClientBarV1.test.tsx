import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  issueSharedClientSelection,
  replaceCanonicalHouseholdDirectory,
  requestClearClientSelection,
  requestSharedClientSelection,
  useClientContextStore,
} from '@/platform/client-context';
import { ClientBarV1 } from './ClientBarV1';
import { projectClientPickerHouseholds } from './clientPickerHouseholds';
import {
  getSharedClientQuickActions,
  type ClientBarQuickAction,
} from './quickActions';

const tauriBoundary = vi.hoisted(() => ({
  invoke:
    vi.fn<
      (command: string, args?: Record<string, unknown>) => Promise<unknown>
    >(),
  isTauri: vi.fn<() => boolean>(),
}));

vi.mock('@tauri-apps/api/core', () => tauriBoundary);

const HOUSEHOLDS = [
  {
    provider: 'wealthbox',
    householdId: 'household-foster',
    displayName: 'Foster household',
    primaryPeople: ['Robert Foster', 'Elena Foster'],
    description: 'Robert & Elena Foster · Active client',
  },
  {
    provider: 'wealthbox',
    householdId: 'household-diaz',
    displayName: 'Diaz household',
    primaryPeople: ['Camila Diaz', 'Mateo Diaz'],
    description: 'Camila & Mateo Diaz · Active client',
  },
] as const;

describe('ClientBarV1', () => {
  beforeEach(() => {
    tauriBoundary.invoke.mockReset();
    tauriBoundary.isTauri.mockReturnValue(false);
  });

  afterEach(() => {
    requestClearClientSelection();
  });

  it('shows the empty and selected shared-client states', () => {
    render(<ClientBarV1 />);

    expect(screen.getByTestId('client-bar-current')).toHaveTextContent(
      'No client selected'
    );
    expect(
      screen.getByText(
        'Choose a client to carry the same context between tools.'
      )
    ).toBeInTheDocument();

    act(() => {
      const client = {
        provider: 'wealthbox' as const,
        householdId: 'household-foster',
        displayName: 'Foster household',
        primaryPeople: ['Robert Foster', 'Elena Foster'],
      };
      replaceCanonicalHouseholdDirectory('wealthbox', [client]);
      void requestSharedClientSelection(
        issueSharedClientSelection(client)
      ).catch((error: unknown) => {
        console.error('[ClientBar test] Client selection failed.', error);
      });
    });

    expect(screen.getByTestId('client-bar-current')).toHaveTextContent(
      'Foster household'
    );
    expect(
      screen.getByText(
        'This client follows you between CRM, Ask, and Meetings.'
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('client-bar-clear'));
    expect(screen.getByTestId('client-bar-current')).toHaveTextContent(
      'No client selected'
    );
  });

  it('searches, selects, and clears the shared household identity', () => {
    render(<ClientBarV1 households={HOUSEHOLDS} />);

    fireEvent.click(screen.getByTestId('client-bar-picker'));
    expect(screen.getByTestId('client-picker-modal')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('client-picker-search'), {
      target: { value: 'Diaz' },
    });
    expect(
      screen.getByTestId('client-picker-option-household-diaz')
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('client-picker-option-household-foster')
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('client-picker-option-household-diaz'));
    expect(useClientContextStore.getState().client).toMatchObject({
      householdId: 'household-diaz',
      displayName: 'Diaz household',
    });
    expect(screen.queryByTestId('client-picker-modal')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('client-bar-picker'));
    fireEvent.click(screen.getByTestId('client-picker-clear'));
    expect(useClientContextStore.getState().client).toBeNull();
  });

  it('shows the real empty state when the native household directory is empty', async () => {
    render(<ClientBarV1 />);

    fireEvent.click(screen.getByTestId('client-bar-picker'));
    expect(await screen.findByTestId('client-picker-empty')).toHaveTextContent(
      'No clients match your search.'
    );
    expect(
      screen.queryByTestId('client-picker-option-household-foster')
    ).not.toBeInTheDocument();
  });

  it('does not expose a provisional household list before workspace hydration is ready', () => {
    const { rerender } = render(
      <ClientBarV1 directoryReady={false} households={HOUSEHOLDS} />
    );

    fireEvent.click(screen.getByTestId('client-bar-picker'));
    expect(
      screen.queryByTestId('client-picker-option-household-foster')
    ).not.toBeInTheDocument();

    rerender(<ClientBarV1 directoryReady households={HOUSEHOLDS} />);
    expect(
      screen.getByTestId('client-picker-option-household-foster')
    ).toBeInTheDocument();
  });

  it('never asks a connector to populate the picker', async () => {
    tauriBoundary.isTauri.mockReturnValue(true);
    render(<ClientBarV1 />);

    fireEvent.click(screen.getByTestId('client-bar-picker'));

    expect(
      await screen.findByTestId('client-picker-empty')
    ).toBeInTheDocument();
    expect(tauriBoundary.invoke).not.toHaveBeenCalled();
  });

  it('projects only uniquely linked live Matters and prefers the local CRM name', () => {
    const createdAt = '2026-07-22T00:00:00.000Z';
    const projected = projectClientPickerHouseholds(
      [
        {
          id: 'matter-hendricks',
          name: 'Hendricks plan',
          client: 'Matter fallback',
          folderPaths: [],
          crmHouseholdKeys: ['household-hendricks'],
          createdAt,
        },
        {
          id: 'matter-fallback',
          name: 'Fallback by Matter name',
          client: '',
          folderPaths: [],
          crmHouseholdKeys: ['household-fallback'],
          createdAt,
        },
        {
          id: 'matter-ambiguous-a',
          name: 'Ambiguous A',
          client: 'Ambiguous A',
          folderPaths: [],
          crmHouseholdKeys: ['household-ambiguous'],
          createdAt,
        },
        {
          id: 'matter-ambiguous-b',
          name: 'Ambiguous B',
          client: 'Ambiguous B',
          folderPaths: [],
          crmHouseholdKeys: ['household-ambiguous'],
          createdAt,
        },
        {
          id: 'matter-archived',
          name: 'Archived',
          client: 'Archived',
          folderPaths: [],
          crmHouseholdKeys: ['household-archived'],
          archived: true,
          createdAt,
        },
      ],
      [
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
      ]
    );

    expect(projected).toEqual([
      {
        provider: 'wealthbox',
        householdId: 'household-hendricks',
        displayName: 'Hendricks household',
      },
      {
        provider: 'wealthbox',
        householdId: 'household-fallback',
        displayName: 'Fallback by Matter name',
      },
    ]);
  });

  it('renders quick actions from shared primary surface descriptors', () => {
    const actions = getSharedClientQuickActions([
      quickAction({ id: 'home', clientContext: 'firm', order: 10 }),
      quickAction({ id: 'matters', clientContext: 'shared', order: 20 }),
      quickAction({
        id: 'search',
        clientContext: 'shared',
        labelKey: 'spine.nav.ask',
        order: 30,
      }),
      quickAction({
        id: 'files',
        clientContext: 'shared',
        order: 40,
        placement: 'hidden',
      }),
    ]);

    expect(actions.map((action) => action.id)).toEqual(['matters', 'search']);

    render(<ClientBarV1 quickActions={actions} />);
    expect(
      screen.getByRole('button', { name: 'Open CRM' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask' })).toBeInTheDocument();
  });

  it('renders a future lazy-resolved Meetings action without client-bar changes', async () => {
    const navigate = vi.fn();
    const lazyMeetingsRegistration = (): Promise<ClientBarQuickAction> =>
      Promise.resolve(
        quickAction({
          id: 'meetings',
          labelKey: 'meetings.surface.title',
          order: 40,
        })
      );
    const meetingsAction = await lazyMeetingsRegistration();
    render(
      <ClientBarV1 onNavigate={navigate} quickActions={[meetingsAction]} />
    );

    fireEvent.click(screen.getByTestId('client-bar-open-meetings'));

    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith('meetings');
  });
});

function quickAction({
  id,
  clientContext = 'shared',
  order = 10,
  ...overrides
}: Pick<ClientBarQuickAction, 'id'> &
  Partial<Omit<ClientBarQuickAction, 'id' | 'clientContext' | 'order'>> & {
    clientContext?: ClientBarQuickAction['clientContext'];
    order?: number;
  }): ClientBarQuickAction {
  return {
    id,
    clientContext,
    order,
    labelKey: 'spine.nav.clients',
    placement: 'primary',
    ...overrides,
  };
}
