/**
 * Task 7 — TTSService
 *
 * Covers:
 *   - speak() delegates to tts_speak Tauri command in Tauri mode
 *   - speak() throws a user-readable error in browser mode
 *   - stop() delegates to tts_stop in Tauri mode
 *   - stop() is a no-op in browser mode
 *   - isAvailable() delegates to tts_sidecar_available in Tauri mode
 *   - isAvailable() returns false in browser mode (no sidecar)
 *   - downloadVoice() delegates to tts_download_voice in Tauri mode
 *   - downloadVoice() throws in browser mode
 *   - listVoices() returns the voice catalog
 *   - TTSService._resetCache() clears the availability cache
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Tauri invoke + isTauri BEFORE importing the service.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));

import * as tauriCore from '@tauri-apps/api/core';
import { TTSService } from '@/modules/tts/TTSService';
import { VOICE_CATALOG } from '@/modules/tts/voiceCatalog';

const mockInvoke = vi.mocked(tauriCore.invoke);
const mockIsTauri = vi.mocked(tauriCore.isTauri);

describe('TTSService', () => {
  beforeEach(() => {
    TTSService._resetCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    TTSService._resetCache();
  });

  // ---------- isAvailable ----------

  describe('isAvailable()', () => {
    it('returns false in browser mode', async () => {
      mockIsTauri.mockReturnValue(false);
      const result = await TTSService.isAvailable();
      expect(result).toBe(false);
    });

    it('returns true when sidecar reports available', async () => {
      mockIsTauri.mockReturnValue(true);
      mockInvoke.mockResolvedValue(true);
      const result = await TTSService.isAvailable();
      expect(result).toBe(true);
      expect(mockInvoke).toHaveBeenCalledWith('tts_sidecar_available');
    });

    it('returns false when sidecar reports unavailable', async () => {
      mockIsTauri.mockReturnValue(true);
      mockInvoke.mockResolvedValue(false);
      const result = await TTSService.isAvailable();
      expect(result).toBe(false);
    });

    it('caches result after first call', async () => {
      mockIsTauri.mockReturnValue(true);
      mockInvoke.mockResolvedValue(true);
      await TTSService.isAvailable();
      await TTSService.isAvailable();
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    it('_resetCache() clears cached value', async () => {
      mockIsTauri.mockReturnValue(true);
      mockInvoke.mockResolvedValue(true);
      await TTSService.isAvailable();
      TTSService._resetCache();
      await TTSService.isAvailable();
      expect(mockInvoke).toHaveBeenCalledTimes(2);
    });
  });

  // ---------- speak ----------

  describe('speak()', () => {
    it('throws in browser mode with user-readable message', async () => {
      mockIsTauri.mockReturnValue(false);
      await expect(
        TTSService.speak('Hello world', 'en_US-amy-medium', 1.0),
      ).rejects.toThrow(/desktop app/i);
    });

    it('invokes tts_speak with correct args in Tauri mode', async () => {
      mockIsTauri.mockReturnValue(true);
      const fakeWav = new Uint8Array([82, 73, 70, 70]); // RIFF header bytes
      mockInvoke.mockResolvedValue(Array.from(fakeWav));
      const result = await TTSService.speak('Hello', 'en_US-amy-medium', 1.0);
      expect(mockInvoke).toHaveBeenCalledWith('tts_speak', {
        text: 'Hello',
        voiceId: 'en_US-amy-medium',
        speed: 1.0,
      });
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result[0]).toBe(82); // 'R'
    });

    it('passes custom speed to the command', async () => {
      mockIsTauri.mockReturnValue(true);
      mockInvoke.mockResolvedValue([0, 1, 2]);
      await TTSService.speak('Test', 'en_US-amy-medium', 1.5);
      expect(mockInvoke).toHaveBeenCalledWith('tts_speak', {
        text: 'Test',
        voiceId: 'en_US-amy-medium',
        speed: 1.5,
      });
    });

    it('propagates Tauri error to caller', async () => {
      mockIsTauri.mockReturnValue(true);
      mockInvoke.mockRejectedValue(new Error('Piper binary missing'));
      await expect(
        TTSService.speak('x', 'en_US-amy-medium', 1.0),
      ).rejects.toThrow('Piper binary missing');
    });
  });

  // ---------- stop ----------

  describe('stop()', () => {
    it('is a no-op in browser mode (does not throw)', async () => {
      mockIsTauri.mockReturnValue(false);
      await expect(TTSService.stop()).resolves.toBeUndefined();
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('invokes tts_stop in Tauri mode', async () => {
      mockIsTauri.mockReturnValue(true);
      mockInvoke.mockResolvedValue(undefined);
      await TTSService.stop();
      expect(mockInvoke).toHaveBeenCalledWith('tts_stop');
    });
  });

  // ---------- downloadVoice ----------

  describe('downloadVoice()', () => {
    it('throws in browser mode', async () => {
      mockIsTauri.mockReturnValue(false);
      await expect(
        TTSService.downloadVoice('es_ES-mls-medium'),
      ).rejects.toThrow(/desktop app/i);
    });

    it('invokes tts_download_voice with voice id', async () => {
      mockIsTauri.mockReturnValue(true);
      mockInvoke.mockResolvedValue('/data/voices/es_ES-mls-medium/es_ES-mls-medium.onnx');
      const path = await TTSService.downloadVoice('es_ES-mls-medium');
      expect(mockInvoke).toHaveBeenCalledWith('tts_download_voice', {
        voiceId: 'es_ES-mls-medium',
      });
      expect(typeof path).toBe('string');
    });
  });

  // ---------- listVoices ----------

  describe('listVoices()', () => {
    it('returns the full voice catalog', () => {
      const voices = TTSService.listVoices();
      expect(voices).toBe(VOICE_CATALOG);
    });

    it('catalog has at least 3 entries', () => {
      expect(TTSService.listVoices().length).toBeGreaterThanOrEqual(3);
    });
  });
});
