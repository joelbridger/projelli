import { describe, expect, it } from 'vitest';
import {
  getNavigationTargetDescriptors,
  navigationTargetRegistry,
  resolveNavigationTargetDescriptor,
  validateNavigationTargetDescriptors,
  type NavigationTargetDescriptor,
} from '@/app/commands/registry/navigationTargetRegistry';
import type { AppSurfaceId } from '@/app/shell/registry/types';

function descriptor(
  overrides: Partial<NavigationTargetDescriptor> = {}
): NavigationTargetDescriptor {
  return {
    id: 'example-target',
    appSurfaceId: 'home',
    resolve: () => undefined,
    ...overrides,
  };
}

describe('navigationTargetRegistry', () => {
  it('owns every existing matter-launch alias', () => {
    expect(navigationTargetRegistry).toHaveLength(8);
    expect(getNavigationTargetDescriptors().map(({ id }) => id)).toEqual([
      'home',
      'search',
      'files',
      'email',
      'workflows',
      'audit',
      'privacy',
      'matters',
    ]);
  });

  it('rejects duplicate target ids', () => {
    expect(() => {
      validateNavigationTargetDescriptors([descriptor(), descriptor()]);
    }).toThrow('duplicate target id: example-target');
  });

  it('rejects targets that do not resolve to an app-surface descriptor', () => {
    expect(() => {
      validateNavigationTargetDescriptors([
        descriptor({ appSurfaceId: 'missing' as AppSurfaceId }),
      ]);
    }).toThrow('unknown app surface: missing');
  });

  it('returns no descriptor for an unknown alias so the router can refuse it', () => {
    expect(
      resolveNavigationTargetDescriptor({
        matterId: 'missing-client',
        surface: 'not-registered',
      })
    ).toBeUndefined();
  });
});
