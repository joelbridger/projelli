import { afterEach, describe, expect, it } from 'vitest';
import {
  getNavigationTargetDescriptors,
  navigationTargetRegistry,
  resolveNavigationTargetDescriptor,
  resolveNavigationTargetRegistry,
  validateNavigationTargetDescriptors,
  type NavigationTargetDescriptor,
} from '@/app/commands/registry/navigationTargetRegistry';
import {
  getAppSurfaceDescriptors,
  getKnownAppSurfaceDescriptors,
} from '@/app/shell/registry/appSurfaceRegistry';
import { setDevFlagOverride } from '@/platform/flags';
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
  afterEach(() => {
    setDevFlagOverride('meetings-shell-v1', undefined);
  });

  it('owns every existing matter-launch alias and accepts Meetings while its flag is on', async () => {
    setDevFlagOverride('meetings-shell-v1', true);
    await resolveNavigationTargetRegistry();

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
    expect(
      getKnownAppSurfaceDescriptors().find(({ id }) => id === 'meetings')
    ).toMatchObject({
      id: 'meetings',
      availabilityFlag: 'meetings-shell-v1',
    });
    expect(getAppSurfaceDescriptors().map(({ id }) => id)).toContain(
      'meetings'
    );
  });

  it('keeps Meetings registered but unavailable while its flag is off', async () => {
    setDevFlagOverride('meetings-shell-v1', false);
    await resolveNavigationTargetRegistry();

    expect(
      getKnownAppSurfaceDescriptors().find(({ id }) => id === 'meetings')
    ).toMatchObject({
      id: 'meetings',
      availabilityFlag: 'meetings-shell-v1',
    });
    expect(getAppSurfaceDescriptors().map(({ id }) => id)).not.toContain(
      'meetings'
    );
  });

  it('rejects duplicate target ids', () => {
    expect(() => {
      validateNavigationTargetDescriptors([descriptor(), descriptor()]);
    }).toThrow('duplicate target id: example-target');
  });

  it('rejects targets that do not resolve to an app-surface descriptor', async () => {
    await resolveNavigationTargetRegistry();

    expect(() => {
      validateNavigationTargetDescriptors([
        descriptor({ appSurfaceId: 'missing' as AppSurfaceId }),
      ]);
    }).toThrow('unknown app surface: missing');
  });

  it('returns no descriptor for an unknown alias so the router can refuse it', async () => {
    await expect(
      Promise.resolve(
        resolveNavigationTargetDescriptor({
          matterId: 'missing-client',
          surface: 'not-registered',
        })
      )
    ).resolves.toBeUndefined();
  });
});
