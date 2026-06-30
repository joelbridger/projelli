import { describe, it, expect } from 'vitest';
import {
  VOICE_CATALOG,
  getVoiceById,
  buildVoiceCdnUrl,
  BUNDLED_VOICE_ID,
} from '@/features/dictation/engine/voiceCatalog';

describe('voiceCatalog', () => {
  it('has at least 3 voices', () => {
    expect(VOICE_CATALOG.length).toBeGreaterThanOrEqual(3);
  });

  it('each voice has id, name, language, bundled flag', () => {
    for (const v of VOICE_CATALOG) {
      expect(typeof v.id).toBe('string');
      expect(typeof v.name).toBe('string');
      expect(typeof v.language).toBe('string');
      expect(typeof v.bundled).toBe('boolean');
    }
  });

  it('BUNDLED_VOICE_ID is en_US-amy-medium', () => {
    expect(BUNDLED_VOICE_ID).toBe('en_US-amy-medium');
  });

  it('exactly one voice is bundled', () => {
    const bundled = VOICE_CATALOG.filter((v) => v.bundled);
    expect(bundled).toHaveLength(1);
    expect(bundled[0].id).toBe('en_US-amy-medium');
  });

  it('getVoiceById returns correct voice', () => {
    const v = getVoiceById('es_ES-mls-medium');
    expect(v).toBeDefined();
    expect(v!.language).toBe('es');
  });

  it('getVoiceById returns undefined for unknown id', () => {
    expect(getVoiceById('xx_XX-fake-medium')).toBeUndefined();
  });

  it('buildVoiceCdnUrl produces correct URL', () => {
    const url = buildVoiceCdnUrl('es_ES-mls-medium');
    expect(url).toBe('https://advisorprephero.com/voices/es_ES-mls-medium.tar.gz');
  });
});
