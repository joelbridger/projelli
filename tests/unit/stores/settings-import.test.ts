/**
 * BUG-026: importSettings must validate each value against the schema (type +
 * options + range), reject invalid values, and MERGE into existing settings
 * rather than replacing them (so a partial import can't silently reset other
 * settings — including privacy/workspace choices).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore } from '@/platform/settings/settingsStore';

describe('settingsStore.importSettings (BUG-026)', () => {
  beforeEach(() => {
    useSettingsStore.setState({ values: {} });
  });

  it('accepts valid values and rejects wrong-typed ones', () => {
    const ok = useSettingsStore.getState().importSettings(
      JSON.stringify({
        fontSize: 'huge', // wrong type (number expected) → rejected
        showWhatsNew: false, // valid toggle → accepted
      }),
    );
    expect(ok).toBe(true);
    const v = useSettingsStore.getState().values;
    expect(v.fontSize).toBeUndefined();
    expect(v.showWhatsNew).toBe(false);
  });

  it('rejects out-of-range numbers and invalid select options', () => {
    useSettingsStore.getState().importSettings(
      JSON.stringify({ fontSize: 30, theme: 'rainbow' }), // 30 > max 24; not a theme option
    );
    let v = useSettingsStore.getState().values;
    expect(v.fontSize).toBeUndefined();
    expect(v.theme).toBeUndefined();

    useSettingsStore.getState().importSettings(JSON.stringify({ fontSize: 16, theme: 'dark' }));
    v = useSettingsStore.getState().values;
    expect(v.fontSize).toBe(16);
    expect(v.theme).toBe('dark');
  });

  it('MERGES into existing settings rather than replacing them', () => {
    useSettingsStore.setState({ values: { showWhatsNew: false } });
    useSettingsStore.getState().importSettings(JSON.stringify({ theme: 'light' }));
    const v = useSettingsStore.getState().values;
    expect(v.theme).toBe('light'); // applied
    expect(v.showWhatsNew).toBe(false); // preserved, NOT reset
  });

  it('ignores unknown keys', () => {
    useSettingsStore.getState().importSettings(JSON.stringify({ notARealSetting: 'x' }));
    expect(useSettingsStore.getState().values.notARealSetting).toBeUndefined();
  });

  it('returns false for non-object JSON', () => {
    expect(useSettingsStore.getState().importSettings('[]')).toBe(false);
    expect(useSettingsStore.getState().importSettings('nope')).toBe(false);
  });
});
