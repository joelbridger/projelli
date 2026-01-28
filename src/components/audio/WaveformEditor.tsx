// Waveform Editor Component
// Audio editor with waveform visualization, scrubbing, splitting, and recording

import { useState, useCallback, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Play, Pause, Mic, Save, Scissors, StopCircle, Trash2, Crop } from 'lucide-react';
import { cn } from '@/lib/utils';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js';

interface WaveformEditorProps {
  audioSrc: string;
  filename: string;
  onSave?: (audioBlob: Blob, filename: string) => Promise<void>;
  className?: string;
}

export function WaveformEditor({
  audioSrc,
  filename,
  onSave,
  className,
}: WaveformEditorProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [hasSelection, setHasSelection] = useState(false);
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsPluginRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Initialize WaveSurfer
  useEffect(() => {
    if (!waveformRef.current) return;

    // Create regions plugin
    const regions = RegionsPlugin.create();
    regionsPluginRef.current = regions;

    const wavesurfer = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: '#4a5568',
      progressColor: '#3b82f6',
      cursorColor: '#ef4444',
      barWidth: 2,
      barRadius: 3,
      cursorWidth: 2,
      height: 128,
      barGap: 2,
      normalize: true,
      plugins: [regions],
    });

    wavesurfer.load(audioSrc);

    wavesurfer.on('ready', () => {
      setDuration(wavesurfer.getDuration());
    });

    wavesurfer.on('audioprocess', () => {
      setCurrentTime(wavesurfer.getCurrentTime());
    });

    wavesurfer.on('finish', () => {
      setIsPlaying(false);
    });

    // Track region changes
    regions.on('region-created', () => {
      setHasSelection(regions.getRegions().length > 0);
    });

    regions.on('region-removed', () => {
      setHasSelection(regions.getRegions().length > 0);
    });

    regions.on('region-updated', () => {
      setHasSelection(regions.getRegions().length > 0);
    });

    wavesurferRef.current = wavesurfer;

    return () => {
      wavesurfer.destroy();
    };
  }, [audioSrc]);

  const togglePlayPause = useCallback(() => {
    if (wavesurferRef.current) {
      if (isPlaying) {
        wavesurferRef.current.pause();
        setIsPlaying(false);
      } else {
        wavesurferRef.current.play();
        setIsPlaying(true);
      }
    }
  }, [isPlaying]);

  const handleSplitAtCursor = useCallback(async () => {
    if (!wavesurferRef.current) return;

    const currentTime = wavesurferRef.current.getCurrentTime();
    const audioBuffer = wavesurferRef.current.getDecodedData();

    if (!audioBuffer) return;

    try {
      const audioContext = new AudioContext();
      const sampleRate = audioBuffer.sampleRate;
      const splitPoint = Math.floor(currentTime * sampleRate);

      // Create first part (0 to cursor)
      const firstPartBuffer = audioContext.createBuffer(
        audioBuffer.numberOfChannels,
        splitPoint,
        sampleRate
      );

      // Create second part (cursor to end)
      const secondPartBuffer = audioContext.createBuffer(
        audioBuffer.numberOfChannels,
        audioBuffer.length - splitPoint,
        sampleRate
      );

      // Copy audio data
      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        const channelData = audioBuffer.getChannelData(channel);
        const firstPartData = firstPartBuffer.getChannelData(channel);
        const secondPartData = secondPartBuffer.getChannelData(channel);

        firstPartData.set(channelData.slice(0, splitPoint));
        secondPartData.set(channelData.slice(splitPoint));
      }

      // Convert buffers to WAV blobs
      const firstPartBlob = await audioBufferToWav(firstPartBuffer);
      const secondPartBlob = await audioBufferToWav(secondPartBuffer);

      // Save both parts
      const baseName = filename.replace(/\.\w+$/, '');
      const ext = filename.split('.').pop() || 'wav';

      if (onSave) {
        await onSave(firstPartBlob, `${baseName}_part1.${ext}`);
        await onSave(secondPartBlob, `${baseName}_part2.${ext}`);
      } else {
        // Fallback: download with save dialog
        await downloadFileWithDialog(firstPartBlob, `${baseName}_part1.${ext}`, 'audio/wav');
        await downloadFileWithDialog(secondPartBlob, `${baseName}_part2.${ext}`, 'audio/wav');
      }
    } catch (error) {
      console.error('Failed to split audio:', error);
    }
  }, [filename, onSave]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const baseName = filename.replace(/\.\w+$/, '');

        if (onSave) {
          await onSave(audioBlob, `${baseName}_recording.webm`);
        } else {
          await downloadFileWithDialog(audioBlob, `${baseName}_recording.webm`, 'audio/webm');
        }

        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Failed to start recording:', error);
    }
  }, [filename, onSave]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, [isRecording]);

  const handleSaveAs = useCallback(async () => {
    if (!wavesurferRef.current) return;

    try {
      const audioBuffer = wavesurferRef.current.getDecodedData();
      if (!audioBuffer) return;

      const blob = await audioBufferToWav(audioBuffer);
      await downloadFileWithDialog(blob, filename, 'audio/wav');
    } catch (error) {
      console.error('Failed to save audio:', error);
    }
  }, [filename]);

  const handleCreateRegion = useCallback(() => {
    if (!wavesurferRef.current || !regionsPluginRef.current) return;

    const duration = wavesurferRef.current.getDuration();
    const currentTime = wavesurferRef.current.getCurrentTime();

    // Clear existing regions (only one selection at a time for simplicity)
    regionsPluginRef.current.clearRegions();

    // Create a new region around the current time
    const start = Math.max(0, currentTime - 2);
    const end = Math.min(duration, currentTime + 2);

    regionsPluginRef.current.addRegion({
      start,
      end,
      color: 'rgba(59, 130, 246, 0.3)',
      drag: true,
      resize: true,
    });
  }, []);

  const handleTrimToSelection = useCallback(async () => {
    if (!wavesurferRef.current || !regionsPluginRef.current) return;

    const regions = regionsPluginRef.current.getRegions();
    if (regions.length === 0) return;

    const region = regions[0];
    const audioBuffer = wavesurferRef.current.getDecodedData();
    if (!audioBuffer) return;

    try {
      const audioContext = new AudioContext();
      const sampleRate = audioBuffer.sampleRate;
      const startSample = Math.floor(region.start * sampleRate);
      const endSample = Math.floor(region.end * sampleRate);
      const trimmedLength = endSample - startSample;

      // Create trimmed buffer
      const trimmedBuffer = audioContext.createBuffer(
        audioBuffer.numberOfChannels,
        trimmedLength,
        sampleRate
      );

      // Copy audio data for the selected region
      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        const channelData = audioBuffer.getChannelData(channel);
        const trimmedData = trimmedBuffer.getChannelData(channel);
        trimmedData.set(channelData.slice(startSample, endSample));
      }

      // Convert to WAV and save
      const blob = await audioBufferToWav(trimmedBuffer);
      const baseName = filename.replace(/\.\w+$/, '');
      const ext = filename.split('.').pop() || 'wav';

      if (onSave) {
        await onSave(blob, `${baseName}_trimmed.${ext}`);
      } else {
        await downloadFileWithDialog(blob, `${baseName}_trimmed.${ext}`, 'audio/wav');
      }
    } catch (error) {
      console.error('Failed to trim audio:', error);
    }
  }, [filename, onSave]);

  const handleDeleteSelection = useCallback(async () => {
    if (!wavesurferRef.current || !regionsPluginRef.current) return;

    const regions = regionsPluginRef.current.getRegions();
    if (regions.length === 0) return;

    const region = regions[0];
    const audioBuffer = wavesurferRef.current.getDecodedData();
    if (!audioBuffer) return;

    try {
      const audioContext = new AudioContext();
      const sampleRate = audioBuffer.sampleRate;
      const startSample = Math.floor(region.start * sampleRate);
      const endSample = Math.floor(region.end * sampleRate);

      // Calculate new buffer length (original - deleted region)
      const newLength = audioBuffer.length - (endSample - startSample);

      // Create new buffer without the selected region
      const newBuffer = audioContext.createBuffer(
        audioBuffer.numberOfChannels,
        newLength,
        sampleRate
      );

      // Copy audio data, skipping the deleted region
      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        const channelData = audioBuffer.getChannelData(channel);
        const newData = newBuffer.getChannelData(channel);

        // Copy before deleted region
        newData.set(channelData.slice(0, startSample), 0);
        // Copy after deleted region
        newData.set(channelData.slice(endSample), startSample);
      }

      // Convert to WAV and save
      const blob = await audioBufferToWav(newBuffer);
      const baseName = filename.replace(/\.\w+$/, '');
      const ext = filename.split('.').pop() || 'wav';

      if (onSave) {
        await onSave(blob, `${baseName}_edited.${ext}`);
      } else {
        await downloadFileWithDialog(blob, `${baseName}_edited.${ext}`, 'audio/wav');
      }
    } catch (error) {
      console.error('Failed to delete selection:', error);
    }
  }, [filename, onSave]);

  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className={cn('flex flex-col h-full p-8 gap-6', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">{filename}</h2>
          <p className="text-sm text-muted-foreground">Audio File</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSaveAs} variant="outline" size="sm" className="gap-2">
            <Save className="h-4 w-4" />
            Save As
          </Button>
        </div>
      </div>

      {/* Waveform */}
      <div className="flex-1 flex flex-col justify-center">
        <div ref={waveformRef} className="w-full bg-muted/30 rounded-lg" />

        {/* Time Display */}
        <div className="flex justify-between text-sm text-muted-foreground mt-4">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-4">
        {/* Playback Controls */}
        <div className="flex justify-center gap-4">
          <Button
            onClick={togglePlayPause}
            size="lg"
            className="h-14 w-14 rounded-full p-0"
            variant={isPlaying ? 'secondary' : 'default'}
          >
            {isPlaying ? (
              <Pause className="h-6 w-6" />
            ) : (
              <Play className="h-6 w-6 ml-1" />
            )}
          </Button>

          <Button
            onClick={handleSplitAtCursor}
            size="lg"
            variant="outline"
            className="gap-2"
          >
            <Scissors className="h-5 w-5" />
            Split at Cursor
          </Button>
        </div>

        {/* Region Selection Controls */}
        <div className="flex justify-center gap-4">
          <Button
            onClick={handleCreateRegion}
            variant="outline"
            className="gap-2"
          >
            <Crop className="h-4 w-4" />
            Select Region
          </Button>

          {hasSelection && (
            <>
              <Button
                onClick={handleTrimToSelection}
                variant="outline"
                className="gap-2"
              >
                <Crop className="h-4 w-4" />
                Trim to Selection
              </Button>

              <Button
                onClick={handleDeleteSelection}
                variant="destructive"
                className="gap-2"
              >
                <Trash2 className="h-4 w-4" />
                Delete Selection
              </Button>
            </>
          )}
        </div>

        {/* Recording Controls */}
        <div className="flex justify-center gap-4">
          {!isRecording ? (
            <Button
              onClick={startRecording}
              variant="outline"
              className="gap-2"
            >
              <Mic className="h-4 w-4" />
              Record at Cursor
            </Button>
          ) : (
            <Button
              onClick={stopRecording}
              variant="destructive"
              className="gap-2 animate-pulse"
            >
              <StopCircle className="h-4 w-4" />
              Stop Recording
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Convert AudioBuffer to WAV blob
 */
async function audioBufferToWav(audioBuffer: AudioBuffer): Promise<Blob> {
  const numberOfChannels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length * numberOfChannels * 2;
  const buffer = new ArrayBuffer(44 + length);
  const view = new DataView(buffer);

  // WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + length, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM
  view.setUint16(20, 1, true); // Format
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, audioBuffer.sampleRate, true);
  view.setUint32(28, audioBuffer.sampleRate * numberOfChannels * 2, true);
  view.setUint16(32, numberOfChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, length, true);

  // Write audio data
  const channels: Float32Array[] = [];
  for (let i = 0; i < numberOfChannels; i++) {
    channels.push(audioBuffer.getChannelData(i));
  }

  let offset = 44;
  for (let i = 0; i < audioBuffer.length; i++) {
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const sample = Math.max(-1, Math.min(1, channels[channel]![i]!));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Download file with save dialog
 */
async function downloadFileWithDialog(blob: Blob, filename: string, mimeType: string) {
  try {
    if ('showSaveFilePicker' in window) {
      const ext = filename.split('.').pop()?.toLowerCase() || 'wav';
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: 'Audio Files',
            accept: { [mimeType]: [`.${ext}`] },
          },
        ],
      });

      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
    } else {
      // Fallback
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
  } catch (error) {
    if (error instanceof Error && error.name !== 'AbortError') {
      console.error('Failed to download file:', error);
    }
  }
}

export default WaveformEditor;
