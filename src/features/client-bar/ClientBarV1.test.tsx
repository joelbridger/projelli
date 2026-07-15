import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useClientContextStore } from '@/platform/client-context';
import { ClientBarV1 } from './ClientBarV1';
import {
  getSharedClientQuickActions,
  type ClientBarQuickAction,
} from './quickActions';

const tauriBoundary = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => tauriBoundary);

const HOUSEHOLDS = [
  {
    householdId: 'household-foster',
    displayName: 'Foster household',
    primaryPeople: ['Robert Foster', 'Elena Foster'],
    description: 'Robert & Elena Foster · Active client',
  },
  {
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
    useClientContextStore.getState().clearClient();
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
      useClientContextStore.getState().setClient({
        householdId: 'household-foster',
        displayName: 'Foster household',
        primaryPeople: ['Robert Foster', 'Elena Foster'],
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

  it('loads and selects households through the native Tauri boundary', async () => {
    tauriBoundary.isTauri.mockReturnValue(true);
    tauriBoundary.invoke.mockResolvedValue([
      { id: 'household-native', name: 'Native household' },
    ]);
    render(<ClientBarV1 />);

    fireEvent.click(screen.getByTestId('client-bar-picker'));

    expect(tauriBoundary.invoke).toHaveBeenCalledWith('crm_list_households', {
      runId: expect.any(String),
    });
    fireEvent.click(
      await screen.findByTestId('client-picker-option-household-native')
    );
    expect(useClientContextStore.getState().client).toEqual({
      householdId: 'household-native',
      displayName: 'Native household',
    });
    expect(screen.getByTestId('client-bar-current')).toHaveTextContent(
      'Native household'
    );
  });

  it('shows a loading state while the native directory request is pending', async () => {
    tauriBoundary.isTauri.mockReturnValue(true);
    let finishRequest: ((value: readonly unknown[]) => void) | undefined;
    tauriBoundary.invoke.mockReturnValue(
      new Promise((resolve) => {
        finishRequest = resolve;
      })
    );
    render(<ClientBarV1 />);

    fireEvent.click(screen.getByTestId('client-bar-picker'));
    expect(screen.getByTestId('client-picker-loading')).toHaveTextContent(
      'Loading clients…'
    );

    await act(async () => {
      finishRequest?.([]);
    });
    expect(screen.getByTestId('client-picker-empty')).toBeInTheDocument();
  });

  it('shows a safe load error and retries the native household request', async () => {
    tauriBoundary.isTauri.mockReturnValue(true);
    tauriBoundary.invoke
      .mockRejectedValueOnce(new Error('native details stay hidden'))
      .mockResolvedValueOnce([]);
    render(<ClientBarV1 />);

    fireEvent.click(screen.getByTestId('client-bar-picker'));
    expect(await screen.findByTestId('client-picker-error')).toHaveTextContent(
      'Clients could not be loaded. Your CRM data is still safe.'
    );
    fireEvent.click(screen.getByTestId('client-picker-retry'));

    expect(await screen.findByTestId('client-picker-empty')).toBeInTheDocument();
    expect(tauriBoundary.invoke).toHaveBeenCalledTimes(2);
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
    expect(screen.getByRole('button', { name: 'Open CRM' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask' })).toBeInTheDocument();
  });

  it('renders a future lazy-resolved Meetings action without client-bar changes', async () => {
    const navigate = vi.fn();
    const lazyMeetingsRegistration = async (): Promise<ClientBarQuickAction> =>
      quickAction({
        id: 'meetings',
        labelKey: 'meetings.surface.title',
        order: 40,
      });
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
