/**
 * TTS module barrel — Stream B public surface.
 *
 * Re-exports every public symbol from the TTS module so callers can import
 * from `@/features/dictation/engine` without coupling to internal file structure.
 */

// Voice catalog — voice metadata, CDN helpers
export {
  VOICE_CATALOG,
  BUNDLED_VOICE_ID,
  TTS_CDN_BASE,
  getVoiceById,
  buildVoiceCdnUrl,
  type VoiceEntry,
} from './voiceCatalog';

// TTSService — high-level Tauri command wrapper
export { TTSService } from './TTSService';

// TTSAudioPlayer — Web Audio API buffered playback
export { TTSAudioPlayer, type PlayerStatus, type TTSAudioPlayerOptions } from './TTSAudioPlayer';
