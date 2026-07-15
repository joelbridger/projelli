import { describe, expect, it } from 'vitest';
import { deCatalog as de, enCatalog as en, esCatalog as es } from '@/i18nCatalogs';
import { crmHomeSurfaceRegistry } from './registry';
import { flagRegistry } from '@/platform/flags/registry';

type LocaleCatalog = Record<string, unknown>;

function resolveLocaleKey(catalog: LocaleCatalog, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (value, segment) =>
        value && typeof value === 'object'
          ? (value as LocaleCatalog)[segment]
          : undefined,
      catalog
    );
}

describe('crmHomeSurfaceRegistry', () => {
  it('has unique routes and shortcuts, valid parents, and locale-backed labels', () => {
    const routes = new Set<string>();
    const shortcuts = new Set<string>();

    for (const surface of crmHomeSurfaceRegistry) {
      expect(
        routes.has(surface.route),
        `duplicate route: ${surface.route}`
      ).toBe(false);
      routes.add(surface.route);

      if (surface.shortcut) {
        expect(
          shortcuts.has(surface.shortcut),
          `duplicate shortcut: ${surface.shortcut}`
        ).toBe(false);
        shortcuts.add(surface.shortcut);
      }

      for (const locale of [en, es, de]) {
        expect(
          resolveLocaleKey(locale, surface.labelKey),
          `${surface.labelKey} must resolve`
        ).toEqual(expect.any(String));
      }
    }

    for (const surface of crmHomeSurfaceRegistry) {
      if (surface.parentRoute)
        expect(routes.has(surface.parentRoute)).toBe(true);
    }
  });

  it('keeps internal firm projects dark until their feature flag is enabled', () => {
    const surface = crmHomeSurfaceRegistry.find(
      (entry) => entry.id === 'internal-projects'
    );
    expect(surface).toMatchObject({
      route: 'internal-projects',
      flagId: 'internal-projects',
    });
    expect(flagRegistry.find((flag) => flag.id === 'internal-projects')).toMatchObject({
      defaultEnabled: false,
      ownerLane: 'internal-projects',
    });
  });
});
