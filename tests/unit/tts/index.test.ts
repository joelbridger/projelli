/**
 * Task 9 — TTS barrel exports + TypeScript typecheck
 *
 * Verifies that @/modules/tts re-exports every public symbol from the
 * Stream B TTS module set. This is a compile-time + shape test:
 * if anything is missing from index.ts the import line fails at build time.
 */

import { describe, it, expect } from 'vitest';
import {
  // voiceCatalog
  VOICE_CATALOG,
  BUNDLED_VOICE_ID,
  TTS_CDN_BASE,
  getVoiceById,
  buildVoiceCdnUrl,
  // TTSService
  TTSService,
  // TTSAudioPlayer
  TTSAudioPlayer,
} from '@/features/dictation/engine';

describe('TTS barrel exports', () => {
  it('exports VOICE_CATALOG as a non-empty array', () => {
    expect(Array.isArray(VOICE_CATALOG)).toBe(true);
    expect(VOICE_CATALOG.length).toBeGreaterThan(0);
  });

  it('exports BUNDLED_VOICE_ID string', () => {
    expect(typeof BUNDLED_VOICE_ID).toBe('string');
    expect(BUNDLED_VOICE_ID).toBe('en_US-amy-medium');
  });

  it('exports TTS_CDN_BASE string', () => {
    expect(typeof TTS_CDN_BASE).toBe('string');
    expect(TTS_CDN_BASE).toContain('keepance.com');
  });

  it('exports getVoiceById function', () => {
    expect(typeof getVoiceById).toBe('function');
    expect(getVoiceById('en_US-amy-medium')).toBeDefined();
  });

  it('exports buildVoiceCdnUrl function', () => {
    expect(typeof buildVoiceCdnUrl).toBe('function');
    expect(buildVoiceCdnUrl('test-id')).toContain('test-id');
  });

  it('exports TTSService object with expected methods', () => {
    expect(typeof TTSService).toBe('object');
    expect(typeof TTSService.isAvailable).toBe('function');
    expect(typeof TTSService.speak).toBe('function');
    expect(typeof TTSService.stop).toBe('function');
    expect(typeof TTSService.downloadVoice).toBe('function');
    expect(typeof TTSService.listVoices).toBe('function');
  });

  it('exports TTSAudioPlayer class', () => {
    expect(typeof TTSAudioPlayer).toBe('function');
    // Should be constructable (class constructor).
    // We don't actually instantiate it here (would need AudioContext mock);
    // existence check is enough for the barrel test.
    expect(TTSAudioPlayer.prototype).toBeDefined();
  });
});
