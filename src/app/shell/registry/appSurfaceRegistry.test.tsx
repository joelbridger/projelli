import { createElement } from 'react';
import { Home } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import {
  appSurfaceRegistry,
  getAppSurfaceDescriptors,
  getOrderedAppSurfaces,
  resolveAppSurfaceRegistry,
  validateAppSurfaceDescriptors,
} from '@/app/shell/registry/appSurfaceRegistry';
import type { AppSurfaceDescriptor } from '@/app/shell/registry/types';

function descriptor(
  overrides: Partial<AppSurfaceDescriptor> = {}
): AppSurfaceDescriptor {
  return {
    id: 'home',
    labelKey: 'example.title',
    icon: Home,
    placement: 'hidden',
    order: 1,
    clientContext: 'firm',
    errorLabel: 'Example',
    render: () => createElement('div'),
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
    }).toThrow('duplicate surface id: home');
  });

  it('rejects duplicate shortcuts after normalization', () => {
    expect(() => {
      validateAppSurfaceDescriptors([
        descriptor({ id: 'home', shortcuts: ['Ctrl+1'] }),
        descriptor({ id: 'matters', shortcuts: ['ctrl+1'] }),
      ]);
    }).toThrow('duplicate shortcut: ctrl+1');
  });

  it('rejects label keys without a translation namespace', () => {
    expect(() => {
      validateAppSurfaceDescriptors([descriptor({ labelKey: 'title' })]);
    }).toThrow('labelKey must include a namespace: home');
  });

  it('keeps the existing CRM doorway in the original Home descriptor', async () => {
    const descriptors = await resolveAppSurfaceRegistry();

    expect(descriptors.map(({ id }) => id)).not.toContain('crm');
    expect(getOrderedAppSurfaces('primary').map(({ id }) => id)).toEqual([
      'home',
      'matters',
      'search',
    ]);
  });
});
