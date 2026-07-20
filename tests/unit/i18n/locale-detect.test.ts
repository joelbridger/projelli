import { describe, it, expect, afterEach } from 'vitest';

import { detectLocale } from '@/lib/locale-detect';

// detectLocale resolves the locale from `navigator.language` on every target.
// The former `@tauri-apps/plugin-os::locale()` desktop branch was dead (no os
// Rust plugin, no `os:` grant) and has been removed (c34), so there is no Tauri
// plugin to mock — driving `navigator.language` covers desktop and web alike.
describe('detectLocale', () => {
  const originalNavigator = global.navigator;

  const setLanguage = (language: string) => {
    Object.defineProperty(global, 'navigator', {
      value: { language },
      configurable: true,
      writable: true,
    });
  };

  afterEach(() => {
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
  });

  it('returns "en" when navigator.language is en-US', async () => {
    setLanguage('en-US');
    expect(await detectLocale()).toBe('en');
  });

  it('returns "es" when navigator.language is es-MX', async () => {
    setLanguage('es-MX');
    expect(await detectLocale()).toBe('es');
  });

  it('returns "es" when navigator.language is es-ES', async () => {
    setLanguage('es-ES');
    expect(await detectLocale()).toBe('es');
  });

  it('returns "de" when navigator.language is de-AT', async () => {
    setLanguage('de-AT');
    expect(await detectLocale()).toBe('de');
  });

  it('returns "de" when navigator.language is de-DE', async () => {
    setLanguage('de-DE');
    expect(await detectLocale()).toBe('de');
  });

  it('falls back to "en" for an unsupported locale (fr-FR)', async () => {
    setLanguage('fr-FR');
    expect(await detectLocale()).toBe('en');
  });

  it('falls back to "en" when navigator.language is empty', async () => {
    setLanguage('');
    expect(await detectLocale()).toBe('en');
  });
});
