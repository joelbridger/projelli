import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setDevFlagOverride } from '@/platform/flags';
import {
  getAccountSectionDescriptors,
  validateAccountSectionDescriptors,
} from './accountSectionRegistry';
import {
  getConnectionCardDescriptors,
  validateConnectionCardDescriptors,
} from './connectionCardRegistry';
import type { AccountSectionDescriptor } from './accountRegistryTypes';
import type { ConnectionCardDescriptor } from '@/platform/types/account';
import { ActiveIntegrationsSection } from './active-integrations';

declare module '@/platform/types/account' {
  interface AccountSectionIdMap {
    'dummy-section': true;
  }

  interface ConnectionCardIdMap {
    'dummy-card': true;
  }
}

afterEach(() => {
  setDevFlagOverride('active-integrations', undefined);
});

function section(
  overrides: Partial<AccountSectionDescriptor> = {}
): AccountSectionDescriptor {
  return {
    id: 'dummy-section',
    labelKey: 'dummy.section',
    legacyLabel: 'Dummy section',
    placement: 'tab',
    order: 999,
    render: () => createElement('div'),
    ...overrides,
  };
}

function card(
  overrides: Partial<ConnectionCardDescriptor> = {}
): ConnectionCardDescriptor {
  const render = () => createElement('div');
  return {
    id: 'dummy-card',
    labelKey: 'dummy.card',
    displayName: 'Dummy provider',
    placement: 'connections',
    order: 999,
    render,
    isConnected: () => Promise.resolve(true),
    ...overrides,
  };
}

describe('Account registries', () => {
  it('preserves the current Account section order and mounts a new section from its descriptor', () => {
    setDevFlagOverride('active-integrations', false);
    const sections = getAccountSectionDescriptors();
    expect(sections.map((descriptor) => descriptor.id)).toEqual([
      'account',
      'firm',
      'usage',
      'connections',
    ]);
    const dummy = getAccountSectionDescriptors([...sections, section()]).at(-1);
    expect(dummy).toBeDefined();
    expect(dummy?.render({})).toMatchObject({ type: 'div' });
  });

  it('appends and renders the one real active-integrations section only while enabled', () => {
    setDevFlagOverride('active-integrations', false);
    expect(
      getAccountSectionDescriptors().filter(
        (descriptor) => descriptor.id === 'active-integrations'
      )
    ).toHaveLength(0);

    setDevFlagOverride('active-integrations', true);
    const enabled = getAccountSectionDescriptors();
    expect(enabled.map((descriptor) => descriptor.id)).toEqual([
      'account',
      'firm',
      'usage',
      'connections',
      'active-integrations',
    ]);
    const mounted = enabled.filter(
      (descriptor) => descriptor.id === 'active-integrations'
    );
    expect(mounted).toHaveLength(1);
    const activeIntegrations = mounted[0];
    if (!activeIntegrations) {
      throw new Error('Expected the enabled Active integrations section');
    }
    expect(activeIntegrations.render({})).toMatchObject({
      type: ActiveIntegrationsSection,
    });

    render(activeIntegrations.render({}));

    expect(
      screen.getByTestId('active-integrations-section')
    ).toBeInTheDocument();
  });

  it('preserves connection-card order and mounts a new card from its descriptor', () => {
    const cards = getConnectionCardDescriptors('connections');
    expect(cards.map((descriptor) => descriptor.id)).toEqual([
      'microsoft-365-mail',
      'imap-mail',
      'gmail-mail',
      'onedrive',
      'box',
      'wealthbox',
      'addepar',
      'docusign',
      'sharefile',
      'jotform',
      'zocks',
      'calendly',
      'calendar',
      'salesforce',
      'redtail',
      'ollama',
    ]);
    expect(
      cards.every((descriptor) => typeof descriptor.isConnected === 'function')
    ).toBe(true);
    expect(
      getConnectionCardDescriptors('developer-tools').map(
        (descriptor) => descriptor.id
      )
    ).toEqual(['mcp']);
    const dummy = getConnectionCardDescriptors('connections', [
      ...cards,
      card(),
    ]).at(-1);
    expect(dummy).toBeDefined();
    expect(dummy?.render()).toMatchObject({ type: 'div' });
  });

  it('rejects duplicate Account section ids deterministically', () => {
    const descriptor = section();
    expect(() => {
      validateAccountSectionDescriptors([descriptor, descriptor]);
    }).toThrow('duplicate section id: dummy-section');
  });

  it('rejects duplicate connection-card ids deterministically', () => {
    const descriptor = card();
    expect(() => {
      validateConnectionCardDescriptors([descriptor, descriptor]);
    }).toThrow('duplicate card id: dummy-card');
  });

  it('rejects a connection card that cannot prove its real connection state', () => {
    const descriptor = card();
    delete descriptor.isConnected;

    expect(() => {
      validateConnectionCardDescriptors([descriptor]);
    }).toThrow('connection proof is required: dummy-card');
  });
});
