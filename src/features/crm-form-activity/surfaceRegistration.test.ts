import { describe, expect, it } from 'vitest';
import { crmHomeSurfaceRegistry } from '@/features/crm-home/registry';
import { flagRegistry } from '@/platform/flags/registry';
import { formActivitySurface } from './surface';

describe('form activity CRM Home registration', () => {
  it('uses a valid, unique CRM Home descriptor with an OFF-by-default flag', () => {
    const matching = crmHomeSurfaceRegistry.filter(
      (surface) => surface.id === formActivitySurface.id
    );
    expect(matching).toEqual([formActivitySurface]);
    expect(
      crmHomeSurfaceRegistry.filter(
        (surface) => surface.route === formActivitySurface.route
      )
    ).toEqual([formActivitySurface]);
    expect(formActivitySurface).toMatchObject({
      id: 'form-activity',
      route: 'form-activity',
      labelKey: 'form-activity.title',
      shortcut: 'a',
      flagId: 'form-activity',
    });
    expect(
      flagRegistry.find((flag) => flag.id === 'form-activity')
    ).toMatchObject({
      ownerLane: 'form-activity',
      defaultEnabled: false,
    });
  });
});
