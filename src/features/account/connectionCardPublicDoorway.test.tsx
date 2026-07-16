import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as accountPublic from '@/features/account';
import { getConnectionCardDescriptors as getCanonicalConnectionCardDescriptors } from './connectionCardRegistry';
import { ActiveIntegrationsConsumerFixture } from './publicConnectionCardConsumer.fixture';
import type {
  ConnectionCardDescriptor,
  ConnectionCardPlacement,
} from '@/features/account';

function card(
  overrides: Partial<ConnectionCardDescriptor>
): ConnectionCardDescriptor {
  return {
    id: 'mcp',
    labelKey: 'connectors.mcp',
    placement: 'developer-tools',
    order: 10,
    render: () => createElement('div'),
    renderStatus: () => createElement('span', undefined, 'MCP connected'),
    renderSafeDisconnect: () =>
      createElement('button', undefined, 'Disconnect MCP safely'),
    ...overrides,
  };
}

describe('Account public connection-card doorway', () => {
  it('re-exports the canonical reader without exposing registry internals', () => {
    expect(accountPublic.getConnectionCardDescriptors).toBe(
      getCanonicalConnectionCardDescriptors
    );
    expect(accountPublic).not.toHaveProperty('connectionCardRegistry');
    expect(accountPublic).not.toHaveProperty(
      'validateConnectionCardDescriptors'
    );
  });

  it.each<ConnectionCardPlacement>(['connections', 'developer-tools'])(
    'returns the canonical ordered projection for %s',
    (placement) => {
      const descriptors: readonly ConnectionCardDescriptor[] = [
        card({
          id: 'ollama',
          labelKey: 'connectors.ollama',
          placement: 'connections',
          order: 20,
        }),
        card({ placement: 'developer-tools', order: 10 }),
        card({
          id: 'gmail-mail',
          labelKey: 'connectors.gmail',
          placement: 'connections',
          order: 5,
        }),
      ];
      const publicCards = accountPublic.getConnectionCardDescriptors(
        placement,
        descriptors
      );
      const canonicalCards = getCanonicalConnectionCardDescriptors(
        placement,
        descriptors
      );

      expect(publicCards).toEqual(canonicalCards);
      expect(publicCards.map((descriptor) => descriptor.id)).toEqual(
        placement === 'connections' ? ['gmail-mail', 'ollama'] : ['mcp']
      );
    }
  );

  it('preserves canonical validation for supplied descriptors', () => {
    const descriptor = card({});

    expect(() =>
      accountPublic.getConnectionCardDescriptors('developer-tools', [
        descriptor,
        descriptor,
      ])
    ).toThrow('duplicate card id: mcp');
  });

  it('lets a public-only consumer render connector-owned status and safe disconnect UI', () => {
    const descriptors: readonly ConnectionCardDescriptor[] = [
      card({
        id: 'ollama',
        labelKey: 'connectors.ollama',
        placement: 'connections',
        order: 20,
        renderStatus: () => createElement('span', undefined, 'Ollama is ready'),
        renderSafeDisconnect: () =>
          createElement('button', undefined, 'Disconnect Ollama safely'),
      }),
      card({
        placement: 'developer-tools',
        order: 1,
      }),
    ];

    render(
      createElement(ActiveIntegrationsConsumerFixture, {
        placement: 'connections',
        descriptors,
      })
    );

    expect(screen.getByText('Ollama is ready')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Disconnect Ollama safely' })
    ).toBeInTheDocument();
    expect(screen.queryByText('MCP connected')).not.toBeInTheDocument();
  });
});
