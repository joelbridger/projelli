// Smoke test for the i18n bootstrap. Per Stream E plan task 1.10: confirms
// init runs without crashing and that an unknown key falls through to the
// key string itself (i18next default behavior). Locale files are intentionally
// empty at this point in Stream E; group II populates en.json.
import { describe, it, expect } from 'vitest';
import i18n from '@/i18n';

describe('i18n config', () => {
  it('exposes initialized i18n instance with en/es/de resources', () => {
    expect(i18n.languages).toBeDefined();
    expect(i18n.options.fallbackLng).toEqual(['en']);
    expect(i18n.hasResourceBundle('en', 'translation')).toBe(true);
    expect(i18n.hasResourceBundle('es', 'translation')).toBe(true);
    expect(i18n.hasResourceBundle('de', 'translation')).toBe(true);
  });

  it('returns the key when no translation is registered (key fallthrough)', () => {
    expect(i18n.t('hello.world')).toBe('hello.world');
  });

  it('returns the key for any locale when no translation is registered', () => {
    expect(i18n.t('hello.world', { lng: 'es' })).toBe('hello.world');
    expect(i18n.t('hello.world', { lng: 'de' })).toBe('hello.world');
    expect(i18n.t('hello.world', { lng: 'fr' })).toBe('hello.world');
  });
});
