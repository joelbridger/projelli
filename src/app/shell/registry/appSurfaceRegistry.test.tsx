import { createElement } from 'react';
import { Home } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import {
  appSurfaceRegistry,
  getAppSurfaceDescriptors,
  getOrderedAppSurfaces,
  validateAppSurfaceDescriptors,
} from '@/app/shell/registry/appSurfaceRegistry';
import type { AppSurfaceDescriptor } from '@/app/shell/registry/types';

function descriptor(
  overrides: Partial<AppSurfaceDescriptor> = {}
): AppSurfaceDescriptor {
  const Component = () => createElement('div');
  return {
    id: 'example',
    labelKey: 'example.title',
    icon: Home,
    placement: 'hidden',
    order: 1,
    clientContext: 'firm',
    errorLabel: 'Example',
    load: () => Promise.resolve({ default: Component }),
    render: () => createElement(Component),
    ...overrides,
  };
}

describe('appSurfaceRegistry', () => {
  it('is the complete source for current routing and primary navigation', () => {
    const descriptors = getAppSurfaceDescriptors();
    expect(appSurfaceRegistry).toHaveLength(13);
    expect(descriptors.map(({ id }) => id)).toEqual([
      'home',
      'matters',
      'search',
      'scheduling',
      'settings',
      'files',
      'email',
      'workflows',
      'audit',
      'privacy',
      'ai-assistant',
      'research',
      'trash',
    ]);
    expect(getOrderedAppSurfaces('primary').map(({ id }) => id)).toEqual([
      'home',
      'matters',
      'search',
    ]);
  });

  it('rejects duplicate ids', () => {
    expect(() => {
      validateAppSurfaceDescriptors([
        descriptor(),
        descriptor({ labelKey: 'other.title' }),
      ]);
    }).toThrow('duplicate surface id: example');
  });

  it('rejects duplicate shortcuts after normalization', () => {
    expect(() => {
      validateAppSurfaceDescriptors([
        descriptor({ id: 'one', shortcuts: ['Ctrl+1'] }),
        descriptor({ id: 'two', shortcuts: ['ctrl+1'] }),
      ]);
    }).toThrow('duplicate shortcut: ctrl+1');
  });

  it('rejects label keys without a translation namespace', () => {
    expect(() => {
      validateAppSurfaceDescriptors([descriptor({ labelKey: 'title' })]);
    }).toThrow('labelKey must include a namespace: example');
  });
});
