/**
 * BUG-026: importSettings must validate each value against the schema (type +
 * options + range), reject invalid values, and MERGE into existing settings
 * rather than replacing them (so a partial import can't silently reset other
 * settings — including privacy/workspace choices).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TEMPLATE_MODEL_OVERRIDES_KEY } from '@/features/workflows/engine/resolveTemplateModel';
import { getConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
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

describe('settingsStore persisted privacy migration (BUG-089)', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      values: {},
      _migrated: true,
      featuresTourCompleted: false,
      language: null,
    });
  });

  it('fails closed when a stale persisted confidentiality mode is invalid', async () => {
    localStorage.setItem(
      'lantern:settings',
      JSON.stringify({
        state: {
          values: {
            confidentialityMode: 'local',
          },
          _migrated: true,
          featuresTourCompleted: false,
          language: null,
        },
        version: 0,
      }),
    );

    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState().values.confidentialityMode).toBe('local-only');
    expect(getConfidentialityMode()).toBe('local-only');
  });
});

describe('settingsStore workflow model override transfer (BUG-090)', () => {
  beforeEach(() => {
    useSettingsStore.setState({ values: {} });
  });

  it('exports per-template model overrides', () => {
    useSettingsStore.getState().setSetting(TEMPLATE_MODEL_OVERRIDES_KEY, {
      'legal-privilege-log': { provider: 'ollama', model: 'llama3.2:3b' },
    });

    const exported = JSON.parse(useSettingsStore.getState().exportSettings()) as Record<string, unknown>;

    expect(exported[TEMPLATE_MODEL_OVERRIDES_KEY]).toEqual({
      'legal-privilege-log': { provider: 'ollama', model: 'llama3.2:3b' },
    });
  });

  it('imports valid per-template model overrides', () => {
    const ok = useSettingsStore.getState().importSettings(
      JSON.stringify({
        [TEMPLATE_MODEL_OVERRIDES_KEY]: {
          'legal-privilege-log': { provider: 'ollama', model: 'llama3.2:3b' },
        },
      }),
    );

    expect(ok).toBe(true);
    expect(useSettingsStore.getState().values[TEMPLATE_MODEL_OVERRIDES_KEY]).toEqual({
      'legal-privilege-log': { provider: 'ollama', model: 'llama3.2:3b' },
    });
  });

  it('drops imported per-template overrides with unsupported providers (BUG-091)', () => {
    const ok = useSettingsStore.getState().importSettings(
      JSON.stringify({
        [TEMPLATE_MODEL_OVERRIDES_KEY]: {
          stale: { provider: 'local', model: 'llama3.2:3b' },
          trimmed: { provider: 'ollama ', model: 'llama3.2:3b' },
          valid: { provider: 'ollama', model: 'llama3.2:3b' },
        },
      }),
    );

    expect(ok).toBe(true);
    expect(useSettingsStore.getState().values[TEMPLATE_MODEL_OVERRIDES_KEY]).toEqual({
      valid: { provider: 'ollama', model: 'llama3.2:3b' },
    });
  });
});
