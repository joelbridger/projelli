import { createElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionCardDescriptor } from '@/features/account';
import { ActiveIntegrationsSection } from './ActiveIntegrationsSection';

function card(
  overrides: Partial<ConnectionCardDescriptor> = {}
): ConnectionCardDescriptor {
  return {
    id: 'ollama',
    labelKey: 'connectors.ollama',
    displayName: 'Ollama',
    placement: 'connections',
    order: 10,
    render: () => createElement('p', undefined, 'Connector-owned form'),
    isConnected: () => Promise.resolve(true),
    ...overrides,
  };
}

describe('ActiveIntegrationsSection', () => {
  it('renders one connector-owned form only after real connection proof succeeds', async () => {
    const providerCall = vi.fn();
    const renderConnector = vi.fn(() =>
      createElement('button', { onClick: providerCall }, 'Disconnect safely')
    );
    const isConnected = vi.fn(() => Promise.resolve(true));
    const readConnectionCards = vi.fn(() => [
      card({
        displayName: 'Microsoft 365',
        labelKey: 'connectors.microsoft365',
        render: renderConnector,
        isConnected,
      }),
    ]);

    render(
      <ActiveIntegrationsSection readConnectionCards={readConnectionCards} />
    );

    expect(
      screen.getByTestId('active-integrations-checking')
    ).toHaveTextContent('Checking your connections');
    expect(await screen.findByText('Microsoft 365')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.queryByText('connectors.microsoft365')).toBeNull();
    expect(
      screen.getAllByRole('button', { name: 'Disconnect safely' })
    ).toHaveLength(1);
    expect(isConnected).toHaveBeenCalledOnce();
    expect(renderConnector).toHaveBeenCalledOnce();
    expect(providerCall).not.toHaveBeenCalled();
  });

  it('does not call an unconnected provider active and reaches the empty state', async () => {
    const renderConnector = vi.fn(() =>
      createElement('button', undefined, 'Connect Microsoft 365')
    );
    const isConnected = vi.fn(() => Promise.resolve(false));

    render(
      <ActiveIntegrationsSection
        readConnectionCards={() => [
          card({
            displayName: 'Microsoft 365',
            render: renderConnector,
            isConnected,
          }),
        ]}
      />
    );

    expect(
      await screen.findByText('No integrations connected')
    ).toBeInTheDocument();
    expect(
      screen.getByText('When you connect an integration, it will appear here.')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('active-integrations-list')).toBeNull();
    expect(screen.queryByText('Microsoft 365')).toBeNull();
    expect(screen.queryByText('Connect Microsoft 365')).toBeNull();
    expect(isConnected).toHaveBeenCalledOnce();
    expect(renderConnector).not.toHaveBeenCalled();
  });

  it('renders only the provider whose own check proves it is connected', async () => {
    const disconnectedRender = vi.fn(() =>
      createElement('button', undefined, 'Connect Gmail')
    );

    render(
      <ActiveIntegrationsSection
        readConnectionCards={() => [
          card({
            id: 'gmail-mail',
            displayName: 'Gmail',
            render: disconnectedRender,
            isConnected: () => Promise.resolve(false),
          }),
          card({
            id: 'ollama',
            displayName: 'Ollama',
            render: () => createElement('p', undefined, 'Ollama status'),
            isConnected: () => Promise.resolve(true),
          }),
        ]}
      />
    );

    expect(await screen.findByText('Ollama')).toBeInTheDocument();
    expect(screen.queryByText('Gmail')).toBeNull();
    expect(screen.queryByText('Connect Gmail')).toBeNull();
    expect(disconnectedRender).not.toHaveBeenCalled();
  });

  it('removes a card after its connector-owned disconnect changes the proven state', async () => {
    let connected = true;
    const disconnect = vi.fn(() => {
      connected = false;
    });
    const readConnectionCards = vi.fn(() => [
      card({
        displayName: 'Wealthbox',
        isConnected: () => Promise.resolve(connected),
        render: () =>
          createElement(
            'button',
            { onClick: disconnect },
            'Disconnect Wealthbox'
          ),
      }),
    ]);

    render(
      <ActiveIntegrationsSection readConnectionCards={readConnectionCards} />
    );
    expect(await screen.findByText('Wealthbox')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Disconnect Wealthbox' })
    );

    expect(disconnect).toHaveBeenCalledOnce();
    expect(
      await screen.findByText('No integrations connected')
    ).toBeInTheDocument();
    expect(screen.queryByText('Wealthbox')).toBeNull();
    await waitFor(() => {
      expect(readConnectionCards.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('fails closed when a descriptor cannot prove a connection', async () => {
    const renderConnector = vi.fn(() =>
      createElement('p', undefined, 'Unsafe card')
    );
    const malformed = {
      ...card({ render: renderConnector }),
      isConnected: undefined,
    } as unknown as ConnectionCardDescriptor;

    render(
      <ActiveIntegrationsSection readConnectionCards={() => [malformed]} />
    );

    expect(
      await screen.findByText('No integrations connected')
    ).toBeInTheDocument();
    expect(renderConnector).not.toHaveBeenCalled();
  });

  it('fails closed when a provider connection check rejects', async () => {
    const renderConnector = vi.fn(() =>
      createElement('p', undefined, 'Unsafe card')
    );

    render(
      <ActiveIntegrationsSection
        readConnectionCards={() => [
          card({
            render: renderConnector,
            isConnected: () =>
              Promise.reject(new Error('native command unavailable')),
          }),
        ]}
      />
    );

    expect(
      await screen.findByText('No integrations connected')
    ).toBeInTheDocument();
    expect(renderConnector).not.toHaveBeenCalled();
  });

  it('shows unavailable rather than guessing when the public registry read fails', async () => {
    render(
      <ActiveIntegrationsSection
        readConnectionCards={() => {
          throw new Error('duplicate descriptor');
        }}
      />
    );

    expect(
      await screen.findByText('Integration details are unavailable')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('active-integrations-list')).toBeNull();
  });
});
