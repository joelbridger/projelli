import { describe, expect, it, vi } from 'vitest';
import {
  getNavigationTargetDescriptors,
  navigationTargetRegistry,
  resolveNavigationTarget,
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
    expect(navigationTargetRegistry).toHaveLength(9);
    expect(getNavigationTargetDescriptors().map(({ id }) => id)).toEqual([
      'home',
      'search',
      'files',
      'email',
      'meetings',
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

  it('diagnoses unknown targets and uses the named safe fallback', () => {
    const setSurface = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    void resolveNavigationTarget(
      { matterId: 'missing-client', surface: 'not-registered' },
      {
        setSurface,
        setDocumentsView: vi.fn(),
        setAskPrefill: vi.fn(),
      }
    );

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('using restore-matter-snapshot')
    );
    expect(setSurface).toHaveBeenCalledExactlyOnceWith('matters');
    warn.mockRestore();
  });
});
