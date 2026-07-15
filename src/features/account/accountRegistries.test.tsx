import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import {
  getAccountSectionDescriptors,
  validateAccountSectionDescriptors,
} from './accountSectionRegistry';
import {
  getConnectionCardDescriptors,
  validateConnectionCardDescriptors,
} from './connectionCardRegistry';
import type {
  AccountSectionDescriptor,
  ConnectionCardDescriptor,
} from './accountRegistryTypes';

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
