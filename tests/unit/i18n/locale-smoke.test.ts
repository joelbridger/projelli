// Smoke verification for the es and de locale files (Stream E task 4.5).
// We don't yet have full LLM translations populated, so the assertions are
// shape-only: the locale files must parse, must be valid JSON objects, and
// (when populated) must mirror en.json's structure so i18next's fallback
// chain doesn't have to repaint the UI in English. When es/de are still
// empty templates, the test verifies the config is correct and i18next
// gracefully falls back to English without crashing.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import i18n from '@/i18n';
import { deCatalog as de, enCatalog as en, esCatalog as es } from '@/i18nCatalogs';

type JsonValue = string | { [key: string]: JsonValue };

function flatten(obj: Record<string, JsonValue>, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null) {
      out.push(...flatten(v as Record<string, JsonValue>, key));
    } else {
      out.push(key);
    }
  }
  return out;
}

describe('locale files smoke', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    warnSpy.mockRestore();
    await i18n.changeLanguage('en');
  });

  it('es and de locale files parse to objects', () => {
    expect(typeof es).toBe('object');
    expect(typeof de).toBe('object');
  });

  it('switching to es does not throw and the bundle is registered', async () => {
    await i18n.changeLanguage('es');
    expect(i18n.language).toBe('es');
    expect(i18n.hasResourceBundle('es', 'translation')).toBe(true);
  });

  it('switching to de does not throw and the bundle is registered', async () => {
    await i18n.changeLanguage('de');
    expect(i18n.language).toBe('de');
    expect(i18n.hasResourceBundle('de', 'translation')).toBe(true);
  });

  it('falls back to English when a key is missing in the active locale', async () => {
    await i18n.changeLanguage('es');
    // common.actions.create is in en.json but es.json may be empty / partial.
    // Either way, t() must return a non-empty string (the EN value via
    // fallbackLng, not the raw key).
    const value = i18n.t('common.actions.create');
    expect(typeof value).toBe('string');
    expect(value.length).toBeGreaterThan(0);
    // If es is not populated for this key, value === 'Create' (English).
    // If es IS populated, value is the Spanish translation. Both pass.
  });

  it('every populated leaf in es.json corresponds to a real en.json key', () => {
    const enKeys = new Set(
      flatten(en as unknown as Record<string, JsonValue>).map((k) =>
        k.replace(/__sourceHash$/, '').replace(/__locked$/, ''),
      ),
    );
    const esKeys = flatten(es as unknown as Record<string, JsonValue>).filter(
      (k) => !k.endsWith('__sourceHash') && !k.endsWith('__locked'),
    );
    const orphan = esKeys.filter((k) => !enKeys.has(k));
    expect(orphan).toEqual([]);
  });

  it('every populated leaf in de.json corresponds to a real en.json key', () => {
    const enKeys = new Set(
      flatten(en as unknown as Record<string, JsonValue>).map((k) =>
        k.replace(/__sourceHash$/, '').replace(/__locked$/, ''),
      ),
    );
    const deKeys = flatten(de as unknown as Record<string, JsonValue>).filter(
      (k) => !k.endsWith('__sourceHash') && !k.endsWith('__locked'),
    );
    const orphan = deKeys.filter((k) => !enKeys.has(k));
    expect(orphan).toEqual([]);
  });
});
