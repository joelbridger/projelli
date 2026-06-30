/**
 * Voice catalog for Advisor Prep Hero TTS (Stream B).
 *
 * Bundled voice: en_US-amy-medium (ships with the installer).
 * Lazy-download voices: es_ES-mls-medium, de_DE-thorsten-medium.
 * Additional voices are downloaded on first use from Advisor Prep Hero's CDN.
 *
 * CDN pattern: https://keepance.com/voices/<voice-id>.tar.gz
 * Each archive unpacks to <voice-id>.onnx + <voice-id>.onnx.json
 * (the two files Piper requires).
 */

export const TTS_CDN_BASE = 'https://keepance.com/voices';

export interface VoiceEntry {
  /** Piper voice ID, e.g. en_US-amy-medium */
  id: string;
  /** Display name shown in the UI */
  name: string;
  /** BCP-47 language code: en, es, de */
  language: string;
  /** True when the voice ships inside the installer. */
  bundled: boolean;
}

export const BUNDLED_VOICE_ID = 'en_US-amy-medium';

export const VOICE_CATALOG: VoiceEntry[] = [
  {
    id: 'en_US-amy-medium',
    name: 'English (Amy, medium)',
    language: 'en',
    bundled: true,
  },
  {
    id: 'es_ES-mls-medium',
    name: 'Spanish (MLS, medium)',
    language: 'es',
    bundled: false,
  },
  {
    id: 'de_DE-thorsten-medium',
    name: 'German (Thorsten, medium)',
    language: 'de',
    bundled: false,
  },
];

/** Return voice metadata by ID, or undefined if unknown. */
export function getVoiceById(id: string): VoiceEntry | undefined {
  return VOICE_CATALOG.find((v) => v.id === id);
}

/**
 * Build the CDN URL for downloading a voice archive.
 * Archive unpacks to <voice-id>.onnx + <voice-id>.onnx.json.
 */
export function buildVoiceCdnUrl(voiceId: string): string {
  return `${TTS_CDN_BASE}/${voiceId}.tar.gz`;
}
