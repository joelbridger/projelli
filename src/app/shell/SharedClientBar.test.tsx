import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  SharedClientBar,
  SharedClientSurface,
} from '@/app/shell/SharedClientBar';
import {
  clientContextAdapterRegistry,
  validateClientContextAdapters,
} from '@/app/shell/client-context/clientContextAdapterRegistry';
import {
  requestClearClientSelection,
} from '@/platform/client-context';
import { crmClientsSharedClientContextAdapter } from '@/features/crm-clients';
import { askSharedClientContextAdapter } from '@/features/ask';
import { meetingsSharedClientContextAdapter } from '@/features/meetings';
import { readSharedClientContext } from '@/platform/client-context';
import { setDevFlagOverride } from '@/platform/flags';

describe('shared client bar seam', () => {
  afterEach(() => {
    requestClearClientSelection();
    setDevFlagOverride('shared-client-bar', undefined);
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
