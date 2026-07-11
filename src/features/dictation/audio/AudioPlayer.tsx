// Audio Player Component
// Plays audio files with controls and waveform visualization

import { useState, useCallback, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Button } from '@/ui/button';
import { Play, Pause, Mic } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AudioPlayerProps {
  audioSrc: string;
  filename: string;
  onRecordMore?: () => void;
  className?: string;
  /** Slim one-row scrubber (small play button · waveform strip · time) for
   *  surfaces where the audio is an accessory, not the page — e.g. the
   *  meeting page, whose stars are the notes + transcript. The default
   *  full-page layout stays for the dictation surface. */
  compact?: boolean;
}

/** Imperative seek handle — TranscriptViewer (Wave 3c) calls `.seek(ms)` when a
 *  transcript segment or `[t:ms]` citation chip is clicked, to jump the audio
 *  to that moment (and start playback) without threading a re-triggerable
 *  prop through this component. */
export interface AudioPlayerHandle {
  seek: (ms: number) => void;
}

export const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(function AudioPlayer({
  audioSrc,
  filename,
  onRecordMore,
  className,
  compact = false,
}, ref) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [waveformData, setWaveformData] = useState<number[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const audio = new Audio(audioSrc);
    audioRef.current = audio;

    audio.addEventListener('loadedmetadata', () => {
      setDuration(audio.duration);
    });

    audio.addEventListener('timeupdate', () => {
      setCurrentTime(audio.currentTime);
    });

    audio.addEventListener('ended', () => {
      setIsPlaying(false);
      setCurrentTime(0);
    });

    return () => {
      audio.pause();
      audio.removeEventListener('loadedmetadata', () => {});
      audio.removeEventListener('timeupdate', () => {});
      audio.removeEventListener('ended', () => {});
      audioRef.current = null;
    };
  }, [audioSrc]);

  // Generate waveform data using Web Audio API
  useEffect(() => {
    const generateWaveform = async () => {
      try {
        // eslint-disable-next-line lantern-egress/no-raw-network-call -- audioSrc is a local blob: URL (URL.createObjectURL); reading it back is not network activity.
        const response = await fetch(audioSrc);
        const arrayBuffer = await response.arrayBuffer();
        const audioContext = new AudioContext();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        // Get audio samples from first channel
        const rawData = audioBuffer.getChannelData(0);
        const samples = 100; // Number of bars in waveform
        const blockSize = Math.floor(rawData.length / samples);
        const filteredData: number[] = [];

        // Calculate average amplitude for each block
        for (let i = 0; i < samples; i++) {
          let sum = 0;
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(rawData[i * blockSize + j] || 0);
          }
          filteredData.push(sum / blockSize);
        }

        // Normalize to 0-1 range
        const max = Math.max(...filteredData);
        const normalized = filteredData.map(val => val / max);
        setWaveformData(normalized);

        void audioContext.close();
      } catch (error) {
        console.error('Failed to generate waveform:', error);
        // Fallback to empty waveform
        setWaveformData(new Array(100).fill(0.5));
      }
    };

    void generateWaveform();
  }, [audioSrc]);

  // Draw waveform on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || waveformData.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const barWidth = width / waveformData.length;
    const playedWidth = (currentTime / duration) * width;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw waveform bars
    waveformData.forEach((amplitude, i) => {
      const x = i * barWidth;
      const barHeight = amplitude * height * 0.8;
      const y = (height - barHeight) / 2;

      // Color: played portion vs unplayed portion
      ctx.fillStyle = x < playedWidth
        ? 'hsl(var(--primary))'
        : 'hsl(var(--muted-foreground) / 0.3)';

      ctx.fillRect(x, y, barWidth - 1, barHeight);
    });

    // Draw playhead indicator
    if (duration > 0) {
      ctx.strokeStyle = 'hsl(var(--primary))';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playedWidth, 0);
      ctx.lineTo(playedWidth, height);
      ctx.stroke();
    }
  }, [waveformData, currentTime, duration]);

  useImperativeHandle(ref, () => ({
    seek: (ms: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      const seconds = ms / 1000;
      audio.currentTime = seconds;
      setCurrentTime(seconds);
      void audio.play();
      setIsPlaying(true);
    },
  }), []);

  const togglePlayPause = useCallback(() => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        void audioRef.current.play();
        setIsPlaying(true);
      }
    }
  }, [isPlaying]);

  const handleWaveformClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !audioRef.current || duration === 0) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const clickRatio = x / rect.width;
    const newTime = clickRatio * duration;

    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  }, [duration]);

  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (compact) {
    return (
      <div className={cn('flex items-center gap-3 w-full', className)} data-testid="audio-player-compact">
        <Button
          onClick={togglePlayPause}
          size="sm"
          className="h-9 w-9 rounded-full p-0 shrink-0"
          variant={isPlaying ? 'secondary' : 'default'}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
        </Button>
        <div className="flex-1 min-w-0">
          <canvas
            ref={canvasRef}
            onClick={handleWaveformClick}
            className="w-full h-10 rounded-md border bg-muted/20 cursor-pointer hover:bg-muted/30 transition-colors"
            style={{ display: 'block' }}
          />
        </div>
        <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap shrink-0">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full justify-center items-center p-8 gap-6', className)}>
      {/* Filename */}
      <div className="text-center">
        <h2 className="text-2xl font-semibold mb-2">{filename}</h2>
        <p className="text-sm text-muted-foreground">Audio File</p>
      </div>

      {/* Waveform Visualization */}
      <div className="w-full max-w-2xl">
        <canvas
          ref={canvasRef}
          onClick={handleWaveformClick}
          className="w-full h-32 rounded-md border bg-muted/20 cursor-pointer hover:bg-muted/30 transition-colors"
          style={{ display: 'block' }}
        />
        <div className="flex justify-between text-xs text-muted-foreground mt-2">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Play/Pause Button */}
      <Button
        onClick={togglePlayPause}
        size="lg"
        className="h-16 w-16 rounded-full p-0"
        variant={isPlaying ? 'secondary' : 'default'}
      >
        {isPlaying ? (
          <Pause className="h-8 w-8" />
        ) : (
          <Play className="h-8 w-8 ml-1" />
        )}
      </Button>

      {/* Record More Button */}
      {onRecordMore && (
        <Button onClick={onRecordMore} variant="outline" className="gap-2">
          <Mic className="h-4 w-4" />
          Record More
        </Button>
      )}
    </div>
  );
});

export default AudioPlayer;
