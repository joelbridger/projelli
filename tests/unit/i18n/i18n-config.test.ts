import { describe, it, expect } from 'vitest';
import i18n from '@/i18n';

describe('i18n config', () => {
  it('exposes initialized i18n instance with en/es/de resources', async () => {
    expect(i18n.languages).toBeDefined();
    expect(i18n.options.fallbackLng).toEqual(['en']);
    expect(i18n.hasResourceBundle('en', 'translation')).toBe(true);
    expect(i18n.hasResourceBundle('es', 'translation')).toBe(true);
    expect(i18n.hasResourceBundle('de', 'translation')).toBe(true);
  });

  it('translates the seed key per locale', async () => {
    expect(i18n.t('_meta.test', { lng: 'en' })).toBe('i18n is working');
    expect(i18n.t('_meta.test', { lng: 'es' })).toBe('i18n está funcionando');
    expect(i18n.t('_meta.test', { lng: 'de' })).toBe('i18n funktioniert');
  });

  it('falls back to English on unknown locale', () => {
    expect(i18n.t('_meta.test', { lng: 'fr' })).toBe('i18n is working');
  });
});
