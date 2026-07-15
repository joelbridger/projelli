import baseDe from './locales/de.json';
import baseEn from './locales/en.json';
import baseEs from './locales/es.json';

type Catalog = Record<string, unknown>;
type Locale = 'en' | 'es' | 'de';

const baseCatalogs: Record<Locale, Catalog> = {
  en: baseEn,
  es: baseEs,
  de: baseDe,
};

const shardModules = import.meta.glob<Catalog>('./features/**/locales/{en,es,de}.json', {
  eager: true,
  import: 'default',
});

function mergeCatalogs(target: Catalog, source: Catalog, path: string[] = []): Catalog {
  for (const [key, sourceValue] of Object.entries(source)) {
    const targetValue = target[key];
    const keyPath = [...path, key];
    const sourceIsObject = sourceValue !== null && typeof sourceValue === 'object' && !Array.isArray(sourceValue);
    const targetIsObject = targetValue !== null && typeof targetValue === 'object' && !Array.isArray(targetValue);

    if (targetValue === undefined) {
      target[key] = sourceIsObject
        ? mergeCatalogs({}, sourceValue as Catalog, keyPath)
        : sourceValue;
    } else if (sourceIsObject && targetIsObject) {
      mergeCatalogs(targetValue as Catalog, sourceValue as Catalog, keyPath);
    } else {
      throw new Error(`[i18n] duplicate locale leaf key: ${keyPath.join('.')}`);
    }
  }
  return target;
}

function localeFromPath(path: string): Locale {
  const match = path.match(/\/(en|es|de)\.json$/);
  if (!match) throw new Error(`[i18n] unsupported locale shard path: ${path}`);
  return match[1] as Locale;
}

export function buildLocaleCatalogs(
  base: Record<Locale, Catalog> = baseCatalogs,
  shards: Record<string, Catalog> = shardModules,
): Record<Locale, Catalog> {
  const catalogs: Record<Locale, Catalog> = {
    en: mergeCatalogs({}, base.en),
    es: mergeCatalogs({}, base.es),
    de: mergeCatalogs({}, base.de),
  };

  for (const path of Object.keys(shards).sort()) {
    mergeCatalogs(catalogs[localeFromPath(path)], shards[path] ?? {});
  }
  return catalogs;
}

export const localeCatalogs = buildLocaleCatalogs();
export const enCatalog = localeCatalogs.en;
export const esCatalog = localeCatalogs.es;
export const deCatalog = localeCatalogs.de;
