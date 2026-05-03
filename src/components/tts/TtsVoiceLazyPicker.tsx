/**
 * TtsVoiceLazyPicker — Voice selector with lazy-download for non-English voices.
 *
 * When the user picks Spanish or German for the first time, this component
 * checks whether the voice is already downloaded. If not, it kicks off a
 * download via TTSService.downloadVoice() and shows progress feedback.
 *
 * On success, `onVoiceChange` is called with the new voice ID.
 * On failure, an error message is shown and the selection reverts to the
 * bundled English voice (en_US-amy-medium).
 *
 * Used inside VoiceOutputSettingsSection (Settings → Voice → output section).
 * Stream B, v2.0.
 */

import { useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { VOICE_CATALOG, BUNDLED_VOICE_ID, getVoiceById } from '@/modules/tts/voiceCatalog';
import { TTSService } from '@/modules/tts/TTSService';

export interface TtsVoiceLazyPickerProps {
  /** Currently selected Piper voice ID. */
  currentVoiceId: string;
  /** Called with the new voice ID after a successful selection (or revert). */
  onVoiceChange: (voiceId: string) => void;
  /** When true, the select is disabled (TTS unavailable or already downloading). */
  disabled: boolean;
}

export function TtsVoiceLazyPicker({
  currentVoiceId,
  onVoiceChange,
  disabled,
}: TtsVoiceLazyPickerProps): React.ReactElement {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const handleChange = useCallback(
    async (voiceId: string) => {
      setDownloadError(null);

      // If already downloaded or bundled, switch immediately.
      if (TTSService.isVoiceDownloaded(voiceId)) {
        onVoiceChange(voiceId);
        return;
      }

      const voice = getVoiceById(voiceId);
      if (!voice) {
        onVoiceChange(voiceId);
        return;
      }

      // Bundled voice: always available, no download needed.
      if (voice.bundled) {
        onVoiceChange(voiceId);
        return;
      }

      // Non-bundled, not yet downloaded: initiate download.
      setDownloading(voiceId);
      try {
        await TTSService.downloadVoice(voiceId);
        onVoiceChange(voiceId);
      } catch {
        setDownloadError(
          `Could not download ${voice.name}. Check your connection and try again.`,
        );
        // Revert to bundled English on failure.
        onVoiceChange(BUNDLED_VOICE_ID);
      } finally {
        setDownloading(null);
      }
    },
    [onVoiceChange],
  );

  const isDisabled = disabled || downloading !== null;

  return (
    <div className="space-y-1">
      <select
        data-testid="tts-voice-picker"
        value={currentVoiceId}
        onChange={(e) => void handleChange(e.target.value)}
        disabled={isDisabled}
        className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
        aria-label="Voice"
      >
        {VOICE_CATALOG.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
            {!v.bundled ? ' (download on first use)' : ''}
          </option>
        ))}
      </select>

      {downloading !== null && (
        <div
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
          data-testid="tts-voice-downloading"
        >
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>
            Downloading{' '}
            {getVoiceById(downloading)?.name ?? downloading}…
          </span>
        </div>
      )}

      {downloadError !== null && (
        <p
          className="text-xs text-destructive"
          data-testid="tts-download-error"
        >
          {downloadError}
        </p>
      )}
    </div>
  );
}

export default TtsVoiceLazyPicker;
