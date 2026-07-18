import { createElement } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionCardDescriptor } from '@/features/account';
import { ActiveIntegrationsSection } from './ActiveIntegrationsSection';

function card(
  overrides: Partial<ConnectionCardDescriptor> = {}
): ConnectionCardDescriptor {
  return {
    id: 'ollama',
    labelKey: 'connectors.ollama',
    placement: 'connections',
    order: 10,
    render: () => createElement('div'),
    renderStatus: () => createElement('p', undefined, 'Ready to use'),
    renderSafeDisconnect: () =>
      createElement('button', undefined, 'Disconnect safely'),
    ...overrides,
  };
}

describe('ActiveIntegrationsSection', () => {
  it('opens without calling a provider or disconnect operation and uses only public card renderers', () => {
    const providerCall = vi.fn();
    const disconnect = vi.fn();
    const renderStatus = vi.fn(() =>
      createElement('p', undefined, 'Connected with read-only access')
    );
    const renderSafeDisconnect = vi.fn(() =>
      createElement('button', { onClick: disconnect }, 'Disconnect safely')
    );
    const readConnectionCards = vi.fn(() => [
      card({ renderStatus, renderSafeDisconnect }),
    ]);

    render(
      <ActiveIntegrationsSection readConnectionCards={readConnectionCards} />
    );

    expect(readConnectionCards).toHaveBeenCalledWith('connections');
    expect(renderStatus).toHaveBeenCalledOnce();
    expect(renderSafeDisconnect).toHaveBeenCalledOnce();
    expect(
      screen.getByText('Connected with read-only access')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Disconnect safely' })
    ).toBeInTheDocument();
    expect(providerCall).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('performs a fresh public read after the connector-owned disconnect succeeds', async () => {
    let connected = true;
    const disconnect = vi.fn(() => {
      connected = false;
    });
    const readConnectionCards = vi.fn(() => [
      card({
        renderStatus: () =>
          createElement(
            'p',
            undefined,
            connected ? 'Connected' : 'Disconnected'
          ),
        renderSafeDisconnect: () =>
          createElement('button', { onClick: disconnect }, 'Disconnect safely'),
      }),
    ]);

    render(
      <ActiveIntegrationsSection readConnectionCards={readConnectionCards} />
    );
    expect(screen.getByText('Connected')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Disconnect safely' })
      );
      await Promise.resolve();
    });

    expect(disconnect).toHaveBeenCalledOnce();
    expect(readConnectionCards.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
  });

  it('omits a malformed card without inventing controls for it', () => {
    const valid = card({ id: 'ollama', order: 20 });
    const malformed = {
      ...card({ id: 'mcp', placement: 'connections', order: 10 }),
      renderSafeDisconnect: undefined,
    } as unknown as ConnectionCardDescriptor;

    render(
      <ActiveIntegrationsSection
        readConnectionCards={() => [malformed, valid]}
      />
    );

    expect(
      screen.queryByTestId('active-integration-card-mcp')
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId('active-integration-card-ollama')
    ).toBeInTheDocument();
    expect(screen.getByTestId('active-integrations-omitted')).toHaveTextContent(
      'One integration could not be shown'
    );
  });

  it('fails closed with an honest empty state when the public read is invalid', () => {
    render(
      <ActiveIntegrationsSection
        readConnectionCards={() => {
          throw new Error('duplicate descriptor');
        }}
      />
    );

    expect(screen.queryByTestId('active-integrations-list')).toBeNull();
    expect(screen.getByTestId('active-integrations-empty')).toHaveTextContent(
      'Integration details are unavailable'
    );
  });
});
