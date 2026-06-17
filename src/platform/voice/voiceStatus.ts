/**
 * Voice sidecar availability probe (M6, v1.5).
 *
 * Asks the Tauri backend whether the bundled Parakeet/whisper.cpp binary
 * is present at runtime. In browser mode, voice input isn't available
 * because we need a native sidecar for transcription, so the probe
 * resolves to `false`.
 */

import { invoke, isTauri } from '@tauri-apps/api/core';

let cached: boolean | null = null;

/**
 * Returns true when the speech-recognition sidecar is bundled and
 * runnable on the current platform. Cached after first resolution.
 */
export async function isVoiceSidecarAvailable(): Promise<boolean> {
  if (cached !== null) return cached;
  if (!isTauri()) {
    cached = false;
    return false;
  }
  try {
    const result = await invoke<boolean>('voice_sidecar_available');
    cached = !!result;
    return cached;
  } catch {
    cached = false;
    return false;
  }
}

/** Test hook — clears the cached probe result. */
export function _resetVoiceSidecarCache(): void {
  cached = null;
}
