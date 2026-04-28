/**
 * TTSService — high-level TypeScript wrapper for Piper TTS sidecar commands.
 *
 * All Tauri commands are gated behind `isTauri()` so the service is safe to
 * import in browser/test environments. In those environments:
 *   - speak() and downloadVoice() throw with user-readable messages.
 *   - stop() and isAvailable() degrade gracefully.
 *   - listVoices() always works (pure catalog lookup).
 *
 * Data flow:
 *   speak()        → invoke('tts_speak')        → Uint8Array (WAV bytes)
 *   stop()         → invoke('tts_stop')          → void
 *   isAvailable()  → invoke('tts_sidecar_available') → boolean (cached)
 *   downloadVoice() → invoke('tts_download_voice')  → string (local path)
 */

import { invoke, isTauri } from '@tauri-apps/api/core';
import { VOICE_CATALOG, type VoiceEntry } from '@/modules/tts/voiceCatalog';

// ---------------------------------------------------------------------------
// Availability cache
// ---------------------------------------------------------------------------

let _cachedAvailable: boolean | null = null;

// ---------------------------------------------------------------------------
// TTSService namespace
// ---------------------------------------------------------------------------

export const TTSService = {
  /**
   * Check whether the Piper binary and bundled English voice are present.
   * Result is cached after first resolution (cleared by _resetCache()).
   */
  async isAvailable(): Promise<boolean> {
    if (_cachedAvailable !== null) return _cachedAvailable;
    if (!isTauri()) {
      _cachedAvailable = false;
      return false;
    }
    try {
      const result = await invoke<boolean>('tts_sidecar_available');
      _cachedAvailable = !!result;
      return _cachedAvailable;
    } catch {
      _cachedAvailable = false;
      return false;
    }
  },

  /**
   * Synthesize `text` using the given voice and return raw WAV bytes.
   *
   * @param text     Text to synthesize.
   * @param voiceId  Piper voice ID (e.g. 'en_US-amy-medium').
   * @param speed    Playback speed multiplier (0.5–2.0; 1.0 = normal).
   * @returns        WAV bytes as Uint8Array.
   * @throws         User-readable error if not in Tauri mode or synthesis fails.
   */
  async speak(text: string, voiceId: string, speed: number): Promise<Uint8Array> {
    if (!isTauri()) {
      throw new Error(
        'Text-to-speech is only available in the desktop app.',
      );
    }
    const bytes = await invoke<number[]>('tts_speak', { text, voiceId, speed });
    return new Uint8Array(bytes);
  },

  /**
   * Kill the resident Piper process immediately.
   * No-op in browser mode (does not throw).
   */
  async stop(): Promise<void> {
    if (!isTauri()) return;
    await invoke<void>('tts_stop');
  },

  /**
   * Download a lazy-loaded voice from Projelli CDN.
   * Used for Spanish and German voices on first selection.
   *
   * @param voiceId  Piper voice ID to download.
   * @returns        Local path to the downloaded .onnx file.
   * @throws         User-readable error if not in Tauri mode or download fails.
   */
  async downloadVoice(voiceId: string): Promise<string> {
    if (!isTauri()) {
      throw new Error(
        'Voice download is only available in the desktop app.',
      );
    }
    return invoke<string>('tts_download_voice', { voiceId });
  },

  /**
   * Return the full voice catalog.
   * Safe to call in all environments (pure catalog lookup).
   */
  listVoices(): VoiceEntry[] {
    return VOICE_CATALOG;
  },

  // ---------------------------------------------------------------------------
  // Test helpers
  // ---------------------------------------------------------------------------

  /** Clear the availability cache. For use in tests only. */
  _resetCache(): void {
    _cachedAvailable = null;
  },
} as const;
