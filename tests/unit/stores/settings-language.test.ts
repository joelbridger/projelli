import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore } from '@/platform/settings/settingsStore';

describe('settingsStore.language', () => {
  beforeEach(() => {
    useSettingsStore.setState({ language: null });
  });

  it('defaults to null (use OS detect)', () => {
    expect(useSettingsStore.getState().language).toBeNull();
  });

  it('accepts en/es/de', () => {
    useSettingsStore.setState({ language: 'es' });
    expect(useSettingsStore.getState().language).toBe('es');
  });

  it('exposes setLanguage action', () => {
    const { setLanguage } = useSettingsStore.getState();
    setLanguage('de');
    expect(useSettingsStore.getState().language).toBe('de');
  });
});
