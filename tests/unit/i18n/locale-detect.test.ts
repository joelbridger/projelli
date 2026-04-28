import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/plugin-os', () => ({
  locale: vi.fn(),
}));

import { locale as mockLocaleFn } from '@tauri-apps/plugin-os';
import { detectLocale } from '@/lib/locale-detect';

describe('detectLocale', () => {
  beforeEach(() => {
    vi.mocked(mockLocaleFn).mockReset();
  });

  it('returns "en" when OS locale is en-US', async () => {
    vi.mocked(mockLocaleFn).mockResolvedValue('en-US');
    expect(await detectLocale()).toBe('en');
  });

  it('returns "es" when OS locale is es-MX', async () => {
    vi.mocked(mockLocaleFn).mockResolvedValue('es-MX');
    expect(await detectLocale()).toBe('es');
  });

  it('returns "de" when OS locale is de-AT', async () => {
    vi.mocked(mockLocaleFn).mockResolvedValue('de-AT');
    expect(await detectLocale()).toBe('de');
  });

  it('falls back to "en" for unsupported locale (fr-FR)', async () => {
    vi.mocked(mockLocaleFn).mockResolvedValue('fr-FR');
    expect(await detectLocale()).toBe('en');
  });

  it('falls back to "en" when Tauri os.locale throws', async () => {
    vi.mocked(mockLocaleFn).mockRejectedValue(new Error('not in tauri'));
    expect(await detectLocale()).toBe('en');
  });

  it('returns "en" for null/undefined locale', async () => {
    vi.mocked(mockLocaleFn).mockResolvedValue(null);
    expect(await detectLocale()).toBe('en');
  });
});
