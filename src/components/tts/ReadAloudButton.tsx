/**
 * ReadAloudButton — triggers TTS playback for an AI message.
 *
 * Rendered on each AI response bubble in the chat panel. Two guards control
 * visibility:
 *   1. `ttsEnabled`   — user's "Text-to-speech output" toggle (Settings → Voice).
 *   2. `ttsAvailable` — Piper binary + bundled voice are present on disk.
 *
 * Both must be true for the button to appear.
 *
 * Clicking while idle  → calls onSpeak(text) to start synthesis.
 * Clicking while playing → calls onStop() to kill the sidecar immediately.
 *
 * The parent component owns the TTSService and TTSAudioPlayer; this component
 * is a pure controlled button that receives `playing` / `loading` state.
 */

import { Button } from '@/components/ui/button';
import { Volume2, Square, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ReadAloudButtonProps {
  /** The AI message text to synthesize. */
  text: string;
  /** User preference: Settings → Voice → ttsEnabled. */
  ttsEnabled: boolean;
  /** Whether the Piper binary and bundled voice are present on this machine. */
  ttsAvailable: boolean;
  /** True when this message is currently being played (drives icon swap). */
  playing: boolean;
  /** True while synthesis is in progress (disables button). */
  loading: boolean;
  /** Called when the user wants to start speaking the text. */
  onSpeak: (text: string) => void;
  /** Called when the user wants to stop ongoing playback. */
  onStop: () => void;
  className?: string;
}

export function ReadAloudButton({
  text,
  ttsEnabled,
  ttsAvailable,
  playing,
  loading,
  onSpeak,
  onStop,
  className,
}: ReadAloudButtonProps) {
  // Guard: both toggles must pass.
  if (!ttsEnabled || !ttsAvailable) return null;

  const handleClick = () => {
    if (playing) {
      onStop();
    } else {
      onSpeak(text);
    }
  };

  const label = playing ? 'Stop reading' : 'Read aloud';

  return (
    <Button
      data-testid="read-aloud-button"
      variant="ghost"
      size="icon"
      className={cn('h-7 w-7 text-muted-foreground hover:text-foreground', className)}
      onClick={handleClick}
      disabled={loading}
      aria-label={label}
      title={label}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : playing ? (
        <Square className="h-3.5 w-3.5 fill-current" />
      ) : (
        <Volume2 className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}
