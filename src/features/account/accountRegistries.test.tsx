import { createElement } from 'react';
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
    placement: 'connections',
    order: 999,
    render,
    renderStatus: render,
    renderSafeDisconnect: render,
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

  it('appends exactly one active-integrations section through the real Account registry only while enabled', () => {
    setDevFlagOverride('active-integrations', false);
    expect(
      getAccountSectionDescriptors().filter(
        (descriptor) => descriptor.id === 'active-integrations'
      )
    ).toHaveLength(0);

    setDevFlagOverride('active-integrations', true);
    const enabled = getAccountSectionDescriptors();
    const mounted = enabled.filter(
      (descriptor) => descriptor.id === 'active-integrations'
    );
    expect(mounted).toHaveLength(1);
    expect(mounted[0]?.render({})).toMatchObject({
      type: ActiveIntegrationsSection,
    });
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
      cards.every(
        (descriptor) =>
          typeof descriptor.renderStatus === 'function' &&
          typeof descriptor.renderSafeDisconnect === 'function'
      )
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
});
