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
    displayName: 'MCP servers',
    placement: 'developer-tools',
    order: 10,
    render: () => createElement('div', undefined, 'MCP setup'),
    isConnected: () => Promise.resolve(false),
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

  it('lets a public-only consumer render each connector-owned form once', () => {
    const descriptors: readonly ConnectionCardDescriptor[] = [
      card({
        id: 'ollama',
        labelKey: 'connectors.ollama',
        displayName: 'Ollama',
        placement: 'connections',
        order: 20,
        render: () => createElement('span', undefined, 'Ollama settings'),
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

    expect(screen.getAllByText('Ollama settings')).toHaveLength(1);
    expect(screen.queryByText('MCP setup')).not.toBeInTheDocument();
  });
});
