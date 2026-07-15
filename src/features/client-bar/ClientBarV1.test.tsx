import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useClientContextStore } from '@/platform/client-context';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { Matter } from '@/platform/types/matter';
import { ClientBarV1 } from './ClientBarV1';

describe('ClientBarV1', () => {
  afterEach(() => {
    useClientContextStore.getState().clearClient();
    useMatterStore.setState({ activeMatterId: null, matters: [] });
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

  it('calls the shell-owned quick navigation callbacks', () => {
    const onNavigate = vi.fn();
    render(<ClientBarV1 onNavigate={onNavigate} />);

    fireEvent.click(screen.getByTestId('client-bar-open-crm'));
    fireEvent.click(screen.getByTestId('client-bar-open-ask'));
    fireEvent.click(screen.getByTestId('client-bar-open-meetings'));

    expect(onNavigate).toHaveBeenNthCalledWith(1, 'crm');
    expect(onNavigate).toHaveBeenNthCalledWith(2, 'ask');
    expect(onNavigate).toHaveBeenNthCalledWith(3, 'meetings');
  });
});
