import { describe, expect, it } from 'vitest';
import en from '@/locales/en.json';
import es from '@/locales/es.json';
import de from '@/locales/de.json';
import { crmHomeSurfaceRegistry } from './registry';

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
});
