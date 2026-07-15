import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SharedClientBar } from '@/app/shell/SharedClientBar';
import type { AppSurfaceDescriptor } from '@/app/shell/registry/types';
import {
  AppSurfaceRuntimeContext,
  type AppSurfaceCapabilities,
} from '@/app/shell/runtime/AppSurfaceRuntime';
import { setDevFlagOverride } from '@/platform/flags';
import { useClientContextStore } from '@/platform/client-context';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { Matter } from '@/platform/types/matter';
import { ClientBarV1, getSharedClientQuickActions } from './ClientBarV1';

describe('ClientBarV1', () => {
  afterEach(() => {
    useClientContextStore.getState().clearClient();
    useMatterStore.setState({ activeMatterId: null, matters: [] });
    setDevFlagOverride('shared-client-bar', undefined);
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
    useMatterStore.setState({
      matters: [
        {
          id: 'household-diaz',
          name: 'Diaz household',
          client: 'Diaz household',
          folderPaths: [],
          createdAt: '2026-07-15T00:00:00.000Z',
        } as Matter,
      ],
    });
    render(<ClientBarV1 />);

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
    expect(useMatterStore.getState().activeMatterId).toBe('household-diaz');
    expect(screen.queryByTestId('client-picker-modal')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('client-bar-picker'));
    fireEvent.click(screen.getByTestId('client-picker-clear'));
    expect(useClientContextStore.getState().client).toBeNull();
    expect(useMatterStore.getState().activeMatterId).toBeNull();
  });

  it('renders quick actions from shared primary surface descriptors', () => {
    const actions = getSharedClientQuickActions([
      surface({ id: 'home', clientContext: 'firm', order: 10 }),
      surface({ id: 'matters', clientContext: 'shared', order: 20 }),
      surface({ id: 'search', clientContext: 'shared', order: 30 }),
      surface({
        id: 'files',
        clientContext: 'shared',
        order: 40,
        placement: 'hidden',
      }),
    ]);

    expect(actions.map((action) => action.id)).toEqual(['matters', 'search']);
  });

  it('uses the shell public navigation action for registered quick actions', () => {
    const setSurface = vi.fn();
    const capabilities = {
      navigation: { setSurface },
    } as unknown as AppSurfaceCapabilities;
    render(
      <AppSurfaceRuntimeContext.Provider value={capabilities}>
        <ClientBarV1 />
      </AppSurfaceRuntimeContext.Provider>
    );

    fireEvent.click(screen.getByTestId('client-bar-open-matters'));
    fireEvent.click(screen.getByTestId('client-bar-open-search'));

    expect(setSurface).toHaveBeenNthCalledWith(1, 'matters');
    expect(setSurface).toHaveBeenNthCalledWith(2, 'search');
    expect(setSurface).toHaveBeenCalledTimes(2);
  });

  it('keeps the legacy plumbing bar when the shared-client-bar flag is off', () => {
    setDevFlagOverride('shared-client-bar', false);
    render(<SharedClientBar />);

    expect(screen.getByTestId('shared-client-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('client-bar-v1')).not.toBeInTheDocument();
  });
});

function surface(
  overrides: Partial<AppSurfaceDescriptor> &
    Pick<AppSurfaceDescriptor, 'id' | 'clientContext' | 'order'>
): AppSurfaceDescriptor {
  return {
    id: overrides.id,
    clientContext: overrides.clientContext,
    order: overrides.order,
    labelKey: 'spine.nav.clients',
    icon: () => null,
    placement: 'primary',
    errorLabel: 'Test surface',
    render: () => null,
    ...overrides,
  };
}
