import { createElement } from 'react';
import { Home } from 'lucide-react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appSurfaceRegistry,
  getAvailableAppSurfaceDescriptors,
  getAppSurfaceDescriptors,
  getOrderedAppSurfaces,
  resolveAppSurfaceDescriptor,
  resolveAppSurfaceRegistry,
  SAFE_APP_SURFACE_ID,
  validateAppSurfaceDescriptors,
} from '@/app/shell/registry/appSurfaceRegistry';
import type { AppSurfaceDescriptor } from '@/app/shell/registry/types';

const flagEnabled = vi.hoisted(() => new Map<string, boolean>());

vi.mock('@/platform/flags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/flags')>()),
  isEnabled: (id: string) => flagEnabled.get(id) ?? false,
}));

declare module '@/platform/types/navigation' {
  interface AppSurfaceMap {
    'availability-probe': true;
  }
}

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
  beforeEach(() => {
    flagEnabled.clear();
  });

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

  it('keeps a flag-off non-Meetings descriptor known but unavailable, so navigation would use Home', () => {
    const availabilityProbe = descriptor({
      id: 'availability-probe',
      availabilityFlag: 'home-surface-v1',
    });

    const resolution = resolveAppSurfaceDescriptor('availability-probe', [
      availabilityProbe,
    ]);

    expect(resolution).toEqual({
      status: 'known-but-unavailable',
      descriptor: availabilityProbe,
    });
    expect(
      resolution.status === 'known-but-unavailable' ? SAFE_APP_SURFACE_ID : null
    ).toBe('home');
    expect(getAvailableAppSurfaceDescriptors([availabilityProbe])).toEqual([]);
  });

  it('resolves the same non-Meetings descriptor when its named flag is on', () => {
    flagEnabled.set('home-surface-v1', true);
    const availabilityProbe = descriptor({
      id: 'availability-probe',
      availabilityFlag: 'home-surface-v1',
    });

    expect(
      resolveAppSurfaceDescriptor('availability-probe', [availabilityProbe])
    ).toEqual({
      status: 'resolved',
      descriptor: availabilityProbe,
    });
    expect(getAvailableAppSurfaceDescriptors([availabilityProbe])).toEqual([
      availabilityProbe,
    ]);
  });

  it('returns unknown only for an id that was never registered, so navigation refuses it', () => {
    const resolution = resolveAppSurfaceDescriptor('never-registered', []);

    expect(resolution).toEqual({
      status: 'unknown',
    });
    expect(resolution.status === 'known-but-unavailable').toBe(false);
  });
});
