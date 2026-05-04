import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The plugin is loaded via dynamic import inside detectLocale, so we mock the
// module ID directly. Each test resets the mock with a fresh resolved/rejected
// value before calling detectLocale.
vi.mock('@tauri-apps/plugin-os', () => ({
  locale: vi.fn(),
}));

import { locale as mockLocaleFn } from '@tauri-apps/plugin-os';
import { detectLocale } from '@/lib/locale-detect';

describe('detectLocale', () => {
  const originalNavigator = global.navigator;

  beforeEach(() => {
    vi.mocked(mockLocaleFn).mockReset();
  });

  afterEach(() => {
    // Restore navigator if a test stubbed it.
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
  });

  it('returns "en" when OS locale is en-US', async () => {
    vi.mocked(mockLocaleFn).mockResolvedValue('en-US');
    expect(await detectLocale()).toBe('en');
  });

  it('returns "es" when OS locale is es-MX', async () => {
    vi.mocked(mockLocaleFn).mockResolvedValue('es-MX');
    expect(await detectLocale()).toBe('es');
  });

  it('returns "es" when OS locale is es-ES', async () => {
    vi.mocked(mockLocaleFn).mockResolvedValue('es-ES');
    expect(await detectLocale()).toBe('es');
  });

  it('returns "de" when OS locale is de-AT', async () => {
    vi.mocked(mockLocaleFn).mockResolvedValue('de-AT');
    expect(await detectLocale()).toBe('de');
  });

  it('returns "de" when OS locale is de-DE', async () => {
    vi.mocked(mockLocaleFn).mockResolvedValue('de-DE');
    expect(await detectLocale()).toBe('de');
  });

  it('falls back to "en" for unsupported locale (fr-FR)', async () => {
    vi.mocked(mockLocaleFn).mockResolvedValue('fr-FR');
    expect(await detectLocale()).toBe('en');
  });

  it('falls back to "en" when Tauri os.locale throws and no navigator.language', async () => {
    vi.mocked(mockLocaleFn).mockRejectedValue(new Error('not in tauri'));
    Object.defineProperty(global, 'navigator', {
      value: { language: '' },
      configurable: true,
      writable: true,
    });
    expect(await detectLocale()).toBe('en');
  });

  it('falls back to navigator.language when Tauri throws (web demo path)', async () => {
    vi.mocked(mockLocaleFn).mockRejectedValue(new Error('plugin missing'));
    Object.defineProperty(global, 'navigator', {
      value: { language: 'es-ES' },
      configurable: true,
      writable: true,
    });
    expect(await detectLocale()).toBe('es');
  });

  it('navigator.language fallback resolves to "de" for de-DE', async () => {
    vi.mocked(mockLocaleFn).mockRejectedValue(new Error('plugin missing'));
    Object.defineProperty(global, 'navigator', {
      value: { language: 'de-DE' },
      configurable: true,
      writable: true,
    });
    expect(await detectLocale()).toBe('de');
  });

  it('returns "en" for null/undefined OS locale', async () => {
    vi.mocked(mockLocaleFn).mockResolvedValue(null);
    expect(await detectLocale()).toBe('en');
  });
});
