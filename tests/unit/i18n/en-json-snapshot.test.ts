import { describe, expect, it } from 'vitest';
import { buildLocaleCatalogs } from '@/i18nCatalogs';
import baseEn from '@/locales/en.json';

type JsonValue = string | boolean | { [key: string]: JsonValue };
type Catalog = Record<string, JsonValue>;

const shardModules = import.meta.glob('/src/features/**/locales/{en,es,de}.json', {
  eager: true,
  import: 'default',
}) as Record<string, Catalog>;

function flatten(catalog: Catalog, prefix = ''): string[] {
  return Object.entries(catalog).flatMap(([key, value]) => {
    if (key.includes('__')) return [];
    const path = prefix ? `${prefix}.${key}` : key;
    return value !== null && typeof value === 'object'
      ? flatten(value as Catalog, path)
      : [path];
  });
}

function shardInventory(locale: string): string[] {
  return Object.keys(shardModules)
    .filter((path) => path.endsWith(`/locales/${locale}.json`))
    .map((path) => path.replace(new RegExp(`/${locale}\\.json$`), ''))
    .sort();
}

describe('feature locale shard inventory', () => {
  it('keeps the base catalog limited to shared shell and cross-feature copy', () => {
    expect(Object.keys(baseEn).sort()).toEqual([
      'app',
      'app-surface',
      'commands',
      'common',
      'layout',
      'quick-open',
      'shortcuts-overlay',
      'spine',
      'tab-guard',
      'updater',
      'version',
      'whats-new',
    ]);
  });

  it('discovers the same feature shard inventory for English, Spanish, and German', () => {
    const english = shardInventory('en');
    expect(english.length).toBeGreaterThan(0);
    expect(english).toContain('/src/features/meetings/insights/keywords/locales');
    expect(shardInventory('es')).toEqual(english);
    expect(shardInventory('de')).toEqual(english);
  });

  it('keeps every target shard leaf-key-compatible with its English shard', () => {
    for (const featurePath of shardInventory('en')) {
      const englishKeys = flatten(shardModules[`${featurePath}/en.json`]!).sort();
      for (const locale of ['es', 'de']) {
        expect(
          flatten(shardModules[`${featurePath}/${locale}.json`]!).sort(),
          `${featurePath}/${locale}.json must mirror English leaf keys`,
        ).toEqual(englishKeys);
      }
    }
  });

  it('merges discovered shards in path order, independent of discovery order', () => {
    const base = { en: { common: { ok: 'OK' } }, es: {}, de: {} } as Record<'en' | 'es' | 'de', Catalog>;
    const shards = {
      '/src/features/z/locales/en.json': { z: { label: 'Z' } },
      '/src/features/a/locales/en.json': { a: { label: 'A' } },
    };
    const catalogs = buildLocaleCatalogs(base, shards as Record<string, Catalog>);
    expect(catalogs.en).toEqual({ common: { ok: 'OK' }, a: { label: 'A' }, z: { label: 'Z' } });
  });

  it('fails clearly when a base catalog and a shard define the same leaf key', () => {
    expect(() => buildLocaleCatalogs(
      { en: { ask: { title: 'Base' } }, es: {}, de: {} },
      { '/src/features/ask/locales/en.json': { ask: { title: 'Feature' } } },
    )).toThrow('[i18n] duplicate locale leaf key: ask.title');
  });
});
