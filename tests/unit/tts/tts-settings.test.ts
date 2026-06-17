/**
 * Task 10 — TTS Settings keys
 *
 * Verifies that the voice-output settings keys added to SETTINGS_SCHEMA
 * exist with the expected defaults and categories.
 *
 * Keys being tested:
 *   ttsEnabled      — toggle, default false, category 'voice'
 *   ttsVoice        — select, default 'en_US-amy-medium', category 'voice'
 *   ttsSpeed        — number, default 1.0, range 0.5–2.0, category 'voice'
 *   ttsAutoRead     — toggle, default false, category 'voice'
 *   ttsShortcut     — shortcut-display, default 'Ctrl+Shift+R', category 'voice'
 */

import { describe, it, expect } from 'vitest';
import { SETTINGS_SCHEMA, getSchemaDefaults } from '@/settings/schema';
import { VOICE_CATALOG, BUNDLED_VOICE_ID } from '@/features/dictation/engine/voiceCatalog';

const TTS_KEYS = ['ttsEnabled', 'ttsVoice', 'ttsSpeed', 'ttsAutoRead', 'ttsShortcut'] as const;

describe('TTS settings schema entries', () => {
  it('all TTS keys are present in SETTINGS_SCHEMA', () => {
    const keys = new Set(SETTINGS_SCHEMA.map((d) => d.key));
    for (const k of TTS_KEYS) {
      expect(keys.has(k), `expected SETTINGS_SCHEMA to contain "${k}"`).toBe(true);
    }
  });

  it('all TTS keys have category "voice"', () => {
    for (const k of TTS_KEYS) {
      const def = SETTINGS_SCHEMA.find((d) => d.key === k);
      expect(def?.category, `${k} category`).toBe('voice');
    }
  });

  it('ttsEnabled is a toggle defaulting to false', () => {
    const def = SETTINGS_SCHEMA.find((d) => d.key === 'ttsEnabled')!;
    expect(def.type).toBe('toggle');
    expect(def.defaultValue).toBe(false);
  });

  it('ttsVoice is a select defaulting to the bundled English voice', () => {
    const def = SETTINGS_SCHEMA.find((d) => d.key === 'ttsVoice')!;
    expect(def.type).toBe('select');
    expect(def.defaultValue).toBe(BUNDLED_VOICE_ID);
  });

  it('ttsVoice options match the voice catalog ids', () => {
    const def = SETTINGS_SCHEMA.find((d) => d.key === 'ttsVoice')!;
    const optionValues = (def.options ?? []).map((o) => o.value);
    for (const voice of VOICE_CATALOG) {
      expect(
        optionValues.includes(voice.id),
        `voice "${voice.id}" should appear in ttsVoice options`,
      ).toBe(true);
    }
  });

  it('ttsSpeed is a number defaulting to 1.0 with range 0.5–2.0', () => {
    const def = SETTINGS_SCHEMA.find((d) => d.key === 'ttsSpeed')!;
    expect(def.type).toBe('number');
    expect(def.defaultValue).toBe(1.0);
    expect(def.min).toBe(0.5);
    expect(def.max).toBe(2.0);
  });

  it('ttsAutoRead is a toggle defaulting to false', () => {
    const def = SETTINGS_SCHEMA.find((d) => d.key === 'ttsAutoRead')!;
    expect(def.type).toBe('toggle');
    expect(def.defaultValue).toBe(false);
  });

  it('ttsShortcut is a shortcut-display entry defaulting to Ctrl+Shift+R', () => {
    const def = SETTINGS_SCHEMA.find((d) => d.key === 'ttsShortcut')!;
    expect(def.type).toBe('shortcut-display');
    expect(def.defaultValue).toBe('Ctrl+Shift+R');
  });

  it('getSchemaDefaults() includes all TTS keys', () => {
    const defaults = getSchemaDefaults();
    for (const k of TTS_KEYS) {
      expect(k in defaults, `defaults should contain "${k}"`).toBe(true);
    }
  });
});
