/**
 * AudioControlBar — inline playback controls for TTS audio.
 *
 * Appears below the AI message bubble that is currently being read aloud.
 * Controlled by the parent (TTSController / AIChatViewer) — no internal
 * playback state. The parent owns TTSAudioPlayer and passes down currentTime,
 * duration, and playing state.
 *
 * Layout:
 *   [Pause|Resume] [Stop] [0:03 ─────────────────── 0:10]
 *
 * Visibility:
 *   - `visible=false` → renders nothing (avoids layout shift).
 *   - `visible=true`  → shows the bar.
 */

import { Button } from '@/components/ui/button';
import { Pause, Play, Square } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AudioControlBarProps {
  /** Whether the bar is shown (false = completely unmounted). */
  visible: boolean;
  /** True while audio is playing; false when paused or not started. */
  playing: boolean;
  /** Elapsed playback time in seconds. */
  currentTime: number;
  /** Total audio duration in seconds. */
  duration: number;
  /** Called when user clicks Pause. */
  onPause: () => void;
  /** Called when user clicks Resume/Play. */
  onResume: () => void;
  /** Called when user clicks Stop. */
  onStop: () => void;
  /** Called when user scrubs; receives new time in seconds. */
  onSeek: (time: number) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AudioControlBar({
  visible,
  playing,
  currentTime,
  duration,
  onPause,
  onResume,
  onStop,
  onSeek,
  className,
}: AudioControlBarProps) {
  if (!visible) return null;

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSeek(Number(e.target.value));
  };

  return (
    <div
      data-testid="audio-control-bar"
      className={cn(
        'flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-1.5 text-xs',
        className,
      )}
    >
      {/* Pause / Resume */}
      {playing ? (
        <Button
          data-testid="audio-control-pause"
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={onPause}
          aria-label="Pause"
          title="Pause"
        >
          <Pause className="h-3.5 w-3.5 fill-current" />
        </Button>
      ) : (
        <Button
          data-testid="audio-control-resume"
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={onResume}
          aria-label="Resume"
          title="Resume"
        >
          <Play className="h-3.5 w-3.5 fill-current" />
        </Button>
      )}

      {/* Stop */}
      <Button
        data-testid="audio-control-stop"
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        onClick={onStop}
        aria-label="Stop"
        title="Stop"
      >
        <Square className="h-3.5 w-3.5 fill-current" />
      </Button>

      {/* Elapsed time */}
      <span className="tabular-nums text-muted-foreground w-8 text-right shrink-0">
        {formatTime(currentTime)}
      </span>

      {/* Scrub slider */}
      <input
        data-testid="audio-control-scrub"
        type="range"
        min={0}
        max={duration}
        step={0.1}
        value={currentTime}
        onChange={handleScrub}
        className="flex-1 h-1 cursor-pointer accent-primary"
        aria-label="Seek"
      />

      {/* Duration */}
      <span className="tabular-nums text-muted-foreground w-8 shrink-0">
        {formatTime(duration)}
      </span>
    </div>
  );
}
