// Waveform Editor Component
// Audacity-lite audio editor with waveform visualization, scrubbing, splitting,
// recording, effects, cut/copy/paste, undo/redo, and keyboard shortcuts.

import { useState, useCallback, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Play,
  Pause,
  Mic,
  Save,
  Scissors,
  StopCircle,
  Trash2,
  Crop,
  Copy,
  ClipboardPaste,
  Undo,
  Redo,
  Wand2,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { saveFile } from '@/utils/saveFile';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import {
  applyGain,
  applyFadeIn,
  applyFadeOut,
  applyNormalize,
  applyReverse,
  sliceBuffer,
  spliceBuffer,
  insertBuffer,
} from '@/modules/audio/audioEffects';

interface WaveformEditorProps {
  audioSrc: string;
  filename: string;
  onSave?: (audioBlob: Blob, filename: string) => Promise<void>;
  className?: string;
}

// Cap history at ~50MB of Float32 samples across all buffers.
const MAX_HISTORY_BYTES = 50 * 1024 * 1024;

/**
 * Compute the raw sample-memory footprint of an AudioBuffer
 * (Float32 = 4 bytes/sample).
 */
function bufferBytes(buffer: AudioBuffer): number {
  return buffer.length * buffer.numberOfChannels * 4;
}

/**
 * Module-level session cache for edited audio buffers, keyed by filename.
 * Persists across tab switches so a user can click away from a file and
 * come back to find their edits intact. Cleared on app reload.
 *
 * Each entry stores the full history stack so undo/redo survives too.
 */
interface SessionAudioState {
  history: AudioBuffer[];
  historyIndex: number;
  clipboard: AudioBuffer | null;
}
const sessionCache = new Map<string, SessionAudioState>();

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
  const [clipboard, setClipboard] = useState<AudioBuffer | null>(null);
  const [history, setHistory] = useState<AudioBuffer[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [toast, setToast] = useState<string | null>(null);

  const waveformRef = useRef<HTMLDivElement | null>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsPluginRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  // Long-lived AudioContext used for buffer manipulation.
  const audioContextRef = useRef<AudioContext | null>(null);
  // Blob URL managed by this component; revoked when replaced.
  const currentUrlRef = useRef<string | null>(null);
  // Flag: when loading a buffer-derived URL, skip history auto-seed.
  const isReloadingFromBufferRef = useRef<boolean>(false);
  // Toast auto-hide timer.
  const toastTimeoutRef = useRef<number | null>(null);
  // Mirror of historyIndex for synchronous reads inside event handlers
  // that fire multiple pushes in the same React batch.
  const historyIndexRef = useRef<number>(-1);

  // Get or lazily create the shared AudioContext.
  const getAudioContext = useCallback((): AudioContext => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    return audioContextRef.current;
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimeoutRef.current !== null) {
      window.clearTimeout(toastTimeoutRef.current);
    }
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
    }, 2000);
  }, []);

  // Initialize WaveSurfer
  useEffect(() => {
    if (!waveformRef.current) return;

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
      console.log('[WaveformEditor] ready fired. filename:', filename, 'isReloadingFromBuffer:', isReloadingFromBufferRef.current);
      // Seed history with the initial buffer, unless we just triggered
      // a reload from an in-memory buffer (which manages history itself).
      if (!isReloadingFromBufferRef.current) {
        const buf = wavesurfer.getDecodedData();
        if (buf) {
          // Check session cache: if the user previously edited this file
          // and switched tabs, restore their work.
          const cached = sessionCache.get(filename);
          console.log('[WaveformEditor] cache lookup for', filename, '→', cached ? `${cached.history.length} history entries` : 'MISS');
          if (cached && cached.history.length > 0) {
            setHistory(cached.history);
            setHistoryIndex(cached.historyIndex);
            historyIndexRef.current = cached.historyIndex;
            setClipboard(cached.clipboard);
            // Replay the cached current buffer into the waveform
            const currentBuf = cached.history[cached.historyIndex];
            if (currentBuf && currentBuf !== buf) {
              console.log('[WaveformEditor] restoring cached buffer for', filename);
              // Reload from cache — fire-and-forget, flag prevents re-seed
              void reloadWaveformFromBuffer(currentBuf);
            }
          } else {
            setHistory([buf]);
            setHistoryIndex(0);
            historyIndexRef.current = 0;
          }
        }
      }
      isReloadingFromBufferRef.current = false;
    });

    wavesurfer.on('audioprocess', () => {
      setCurrentTime(wavesurfer.getCurrentTime());
    });

    wavesurfer.on('seeking', () => {
      setCurrentTime(wavesurfer.getCurrentTime());
    });

    wavesurfer.on('finish', () => {
      setIsPlaying(false);
    });

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
      // Always destroy the CURRENT wavesurfer (which may have been
      // replaced by reloadWaveformFromBuffer).
      if (wavesurferRef.current) {
        try {
          wavesurferRef.current.destroy();
        } catch {
          // ignore
        }
        wavesurferRef.current = null;
      }
      if (currentUrlRef.current) {
        URL.revokeObjectURL(currentUrlRef.current);
        currentUrlRef.current = null;
      }
      if (toastTimeoutRef.current !== null) {
        window.clearTimeout(toastTimeoutRef.current);
        toastTimeoutRef.current = null;
      }
    };
  }, [audioSrc]);

  /**
   * Read the first region's [start, end] in seconds, or null if no selection.
   */
  const getSelectionRange = useCallback((): { start: number; end: number } | null => {
    if (!regionsPluginRef.current) return null;
    const regions = regionsPluginRef.current.getRegions();
    if (regions.length === 0) return null;
    const region = regions[0];
    return { start: region.start, end: region.end };
  }, []);

  /**
   * Convert an AudioBuffer to a WAV blob, create an object URL, and feed it
   * back into wavesurfer. Frees any prior blob URL.
   *
   * We fully destroy and recreate the wavesurfer instance each time rather
   * than calling .load() on the existing one. Calling .load() repeatedly in
   * wavesurfer v7 causes a progressive audio quality degradation (muffled,
   * distant sound) — likely because the internal MediaElement pipeline gets
   * into a bad state after repeated source swaps. Recreating the instance
   * fully resets the pipeline.
   */
  const reloadWaveformFromBuffer = useCallback(async (newBuffer: AudioBuffer): Promise<void> => {
    if (!waveformRef.current) return;

    const blob = await audioBufferToWav(newBuffer);
    const url = URL.createObjectURL(blob);
    // Free previous buffer-derived URL, if any.
    if (currentUrlRef.current) {
      URL.revokeObjectURL(currentUrlRef.current);
    }
    currentUrlRef.current = url;

    // Destroy the old wavesurfer instance entirely.
    if (wavesurferRef.current) {
      try {
        wavesurferRef.current.destroy();
      } catch {
        // ignore destroy errors
      }
      wavesurferRef.current = null;
    }

    // Create a fresh wavesurfer instance with the new audio.
    const regions = RegionsPlugin.create();
    regionsPluginRef.current = regions;

    const ws = WaveSurfer.create({
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

    ws.on('ready', () => {
      setDuration(ws.getDuration());
      isReloadingFromBufferRef.current = false;
    });
    ws.on('audioprocess', () => {
      setCurrentTime(ws.getCurrentTime());
    });
    ws.on('seeking', () => {
      setCurrentTime(ws.getCurrentTime());
    });
    ws.on('finish', () => {
      setIsPlaying(false);
    });

    regions.on('region-created', () => {
      setHasSelection(regions.getRegions().length > 0);
    });
    regions.on('region-removed', () => {
      setHasSelection(regions.getRegions().length > 0);
    });
    regions.on('region-updated', () => {
      setHasSelection(regions.getRegions().length > 0);
    });

    isReloadingFromBufferRef.current = true;
    await ws.load(url);
    wavesurferRef.current = ws;
    setDuration(newBuffer.length / newBuffer.sampleRate);
  }, []);

  // Keep the historyIndex ref mirroring the state value, in addition to the
  // synchronous updates inside pushHistory/undo/redo.
  useEffect(() => {
    historyIndexRef.current = historyIndex;
  }, [historyIndex]);

  /**
   * Append newBuffer to history (dropping any redo tail), then enforce the
   * 50MB size cap by evicting oldest entries.
   */
  const pushHistory = useCallback((newBuffer: AudioBuffer) => {
    setHistory((prev) => {
      const idx = historyIndexRef.current;
      // Truncate redo tail at current index.
      const base = prev.slice(0, idx + 1);
      let next = [...base, newBuffer];

      // Evict oldest until total <= cap.
      let total = next.reduce((sum, b) => sum + bufferBytes(b), 0);
      while (total > MAX_HISTORY_BYTES && next.length > 1) {
        const dropped = next.shift();
        if (dropped) total -= bufferBytes(dropped);
      }

      const newIdx = next.length - 1;
      historyIndexRef.current = newIdx;
      setHistoryIndex(newIdx);
      return next;
    });
  }, []);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex >= 0 && historyIndex < history.length - 1;

  // Persist state to session cache so edits survive tab switches within
  // the same app session. If the only entry is the original buffer (nothing
  // has been edited), clear the cache so we don't hold the memory forever.
  useEffect(() => {
    if (history.length === 0) return;
    if (history.length === 1 && historyIndex === 0 && !clipboard) {
      // Nothing edited — don't populate cache
      sessionCache.delete(filename);
      console.log('[WaveformEditor] cache cleared for', filename, '(no edits yet)');
      return;
    }
    sessionCache.set(filename, {
      history,
      historyIndex,
      clipboard,
    });
    console.log('[WaveformEditor] cache saved for', filename, '- history length:', history.length, 'index:', historyIndex);
  }, [filename, history, historyIndex, clipboard]);

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

    const cursor = wavesurferRef.current.getCurrentTime();
    const audioBuffer = wavesurferRef.current.getDecodedData();

    if (!audioBuffer) return;

    try {
      const ctx = getAudioContext();
      const total = audioBuffer.length / audioBuffer.sampleRate;
      const firstPartBuffer = sliceBuffer(audioBuffer, ctx, 0, cursor);
      const secondPartBuffer = sliceBuffer(audioBuffer, ctx, cursor, total);

      const firstPartBlob = await audioBufferToWav(firstPartBuffer);
      const secondPartBlob = await audioBufferToWav(secondPartBuffer);

      const baseName = filename.replace(/\.\w+$/, '');
      const ext = filename.split('.').pop() || 'wav';

      if (onSave) {
        await onSave(firstPartBlob, `${baseName}_part1.${ext}`);
        await onSave(secondPartBlob, `${baseName}_part2.${ext}`);
      } else {
        await downloadFileWithDialog(firstPartBlob, `${baseName}_part1.${ext}`, 'audio/wav');
        await downloadFileWithDialog(secondPartBlob, `${baseName}_part2.${ext}`, 'audio/wav');
      }
      showToast('Audio split at cursor');
    } catch (error) {
      console.error('Failed to split audio:', error);
    }
  }, [filename, onSave, getAudioContext, showToast]);

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

    const totalDuration = wavesurferRef.current.getDuration();
    const cursor = wavesurferRef.current.getCurrentTime();

    regionsPluginRef.current.clearRegions();

    const start = Math.max(0, cursor - 2);
    const end = Math.min(totalDuration, cursor + 2);

    regionsPluginRef.current.addRegion({
      start,
      end,
      color: 'rgba(59, 130, 246, 0.3)',
      drag: true,
      resize: true,
    });
  }, []);

  /**
   * Select the entire buffer (for Ctrl+A).
   */
  const handleSelectAll = useCallback(() => {
    if (!wavesurferRef.current || !regionsPluginRef.current) return;
    const totalDuration = wavesurferRef.current.getDuration();
    regionsPluginRef.current.clearRegions();
    regionsPluginRef.current.addRegion({
      start: 0,
      end: totalDuration,
      color: 'rgba(59, 130, 246, 0.3)',
      drag: true,
      resize: true,
    });
  }, []);

  const handleTrimToSelection = useCallback(async () => {
    if (!wavesurferRef.current) return;
    const range = getSelectionRange();
    if (!range) return;
    const audioBuffer = wavesurferRef.current.getDecodedData();
    if (!audioBuffer) return;

    try {
      const ctx = getAudioContext();
      const trimmed = sliceBuffer(audioBuffer, ctx, range.start, range.end);
      // Push BEFORE applying, per project spec.
      pushHistory(trimmed);
      await reloadWaveformFromBuffer(trimmed);
      showToast(`Trimmed to ${formatDuration(range.end - range.start)}`);
    } catch (error) {
      console.error('Failed to trim audio:', error);
    }
  }, [getSelectionRange, getAudioContext, pushHistory, reloadWaveformFromBuffer, showToast]);

  const handleDeleteSelection = useCallback(async () => {
    if (!wavesurferRef.current) return;
    const range = getSelectionRange();
    if (!range) return;
    const audioBuffer = wavesurferRef.current.getDecodedData();
    if (!audioBuffer) return;

    try {
      const ctx = getAudioContext();
      const total = audioBuffer.length / audioBuffer.sampleRate;
      const before = range.start > 0 ? sliceBuffer(audioBuffer, ctx, 0, range.start) : null;
      const after = range.end < total ? sliceBuffer(audioBuffer, ctx, range.end, total) : null;

      let newBuffer: AudioBuffer;
      if (before && after) {
        const newLength = before.length + after.length;
        newBuffer = ctx.createBuffer(audioBuffer.numberOfChannels, Math.max(1, newLength), audioBuffer.sampleRate);
        for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
          const dst = newBuffer.getChannelData(ch);
          const b = before.getChannelData(ch);
          const a = after.getChannelData(ch);
          dst.set(b, 0);
          dst.set(a, b.length);
        }
      } else if (before) {
        newBuffer = before;
      } else if (after) {
        newBuffer = after;
      } else {
        // Deleting everything - leave a 1-sample silence buffer.
        newBuffer = ctx.createBuffer(audioBuffer.numberOfChannels, 1, audioBuffer.sampleRate);
      }

      pushHistory(newBuffer);
      await reloadWaveformFromBuffer(newBuffer);
      showToast(`Deleted ${formatDuration(range.end - range.start)}`);
    } catch (error) {
      console.error('Failed to delete selection:', error);
    }
  }, [getSelectionRange, getAudioContext, pushHistory, reloadWaveformFromBuffer, showToast]);

  // -------- Effects (applied to selection or full buffer) --------

  const applyEffect = useCallback(
    async (
      effect: (buf: AudioBuffer, ctx: AudioContext, startTime?: number, endTime?: number) => AudioBuffer,
      label: string
    ) => {
      if (!wavesurferRef.current) return;
      const audioBuffer = wavesurferRef.current.getDecodedData();
      if (!audioBuffer) return;
      try {
        const ctx = getAudioContext();
        const range = getSelectionRange();
        const next = range
          ? effect(audioBuffer, ctx, range.start, range.end)
          : effect(audioBuffer, ctx);
        pushHistory(next);
        await reloadWaveformFromBuffer(next);
        showToast(`${label} applied to ${range ? 'selection' : 'full track'}`);
      } catch (error) {
        console.error(`Failed to apply ${label}:`, error);
      }
    },
    [getAudioContext, getSelectionRange, pushHistory, reloadWaveformFromBuffer, showToast]
  );

  const handleGainPlus6 = useCallback(() => {
    void applyEffect((buf, ctx, s, e) => applyGain(buf, ctx, 6, s, e), 'Gain +6 dB');
  }, [applyEffect]);

  const handleGainMinus6 = useCallback(() => {
    void applyEffect((buf, ctx, s, e) => applyGain(buf, ctx, -6, s, e), 'Gain -6 dB');
  }, [applyEffect]);

  const handleFadeIn = useCallback(() => {
    void applyEffect((buf, ctx, s, e) => applyFadeIn(buf, ctx, s, e), 'Fade In');
  }, [applyEffect]);

  const handleFadeOut = useCallback(() => {
    void applyEffect((buf, ctx, s, e) => applyFadeOut(buf, ctx, s, e), 'Fade Out');
  }, [applyEffect]);

  const handleNormalize = useCallback(() => {
    void applyEffect((buf, ctx, s, e) => applyNormalize(buf, ctx, 0.99, s, e), 'Normalize');
  }, [applyEffect]);

  const handleReverse = useCallback(() => {
    void applyEffect((buf, ctx, s, e) => applyReverse(buf, ctx, s, e), 'Reverse');
  }, [applyEffect]);

  // -------- Clipboard: copy / cut / paste --------

  const handleCopy = useCallback(() => {
    if (!wavesurferRef.current) return;
    const range = getSelectionRange();
    if (!range) return;
    const audioBuffer = wavesurferRef.current.getDecodedData();
    if (!audioBuffer) return;
    try {
      const ctx = getAudioContext();
      const slice = sliceBuffer(audioBuffer, ctx, range.start, range.end);
      setClipboard(slice);
      showToast(`Copied ${formatDuration(range.end - range.start)}`);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  }, [getSelectionRange, getAudioContext, showToast]);

  const handleCut = useCallback(async () => {
    if (!wavesurferRef.current) return;
    const range = getSelectionRange();
    if (!range) return;
    const audioBuffer = wavesurferRef.current.getDecodedData();
    if (!audioBuffer) return;
    try {
      const ctx = getAudioContext();
      // Copy to clipboard.
      const slice = sliceBuffer(audioBuffer, ctx, range.start, range.end);
      setClipboard(slice);
      // Then remove the region from the buffer.
      const total = audioBuffer.length / audioBuffer.sampleRate;
      const before = range.start > 0 ? sliceBuffer(audioBuffer, ctx, 0, range.start) : null;
      const after = range.end < total ? sliceBuffer(audioBuffer, ctx, range.end, total) : null;

      let newBuffer: AudioBuffer;
      if (before && after) {
        const newLength = before.length + after.length;
        newBuffer = ctx.createBuffer(audioBuffer.numberOfChannels, Math.max(1, newLength), audioBuffer.sampleRate);
        for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
          const dst = newBuffer.getChannelData(ch);
          const b = before.getChannelData(ch);
          const a = after.getChannelData(ch);
          dst.set(b, 0);
          dst.set(a, b.length);
        }
      } else if (before) {
        newBuffer = before;
      } else if (after) {
        newBuffer = after;
      } else {
        newBuffer = ctx.createBuffer(audioBuffer.numberOfChannels, 1, audioBuffer.sampleRate);
      }

      pushHistory(newBuffer);
      await reloadWaveformFromBuffer(newBuffer);
      showToast(`Cut ${formatDuration(range.end - range.start)}`);
    } catch (error) {
      console.error('Failed to cut:', error);
    }
  }, [getSelectionRange, getAudioContext, pushHistory, reloadWaveformFromBuffer, showToast]);

  const handlePaste = useCallback(async () => {
    if (!wavesurferRef.current || !clipboard) return;
    const audioBuffer = wavesurferRef.current.getDecodedData();
    if (!audioBuffer) return;
    try {
      const ctx = getAudioContext();
      const range = getSelectionRange();

      let next: AudioBuffer;
      if (range) {
        next = spliceBuffer(audioBuffer, ctx, range.start, range.end, clipboard);
      } else {
        const cursor = wavesurferRef.current.getCurrentTime();
        next = insertBuffer(audioBuffer, ctx, cursor, clipboard);
      }

      pushHistory(next);
      await reloadWaveformFromBuffer(next);
      showToast(`Pasted ${formatDuration(clipboard.length / clipboard.sampleRate)}`);
    } catch (error) {
      console.error('Failed to paste:', error);
    }
  }, [clipboard, getSelectionRange, getAudioContext, pushHistory, reloadWaveformFromBuffer, showToast]);

  // -------- Undo / Redo --------

  const handleUndo = useCallback(async () => {
    if (!canUndo) return;
    const newIndex = historyIndex - 1;
    const target = history[newIndex];
    if (!target) return;
    historyIndexRef.current = newIndex;
    setHistoryIndex(newIndex);
    await reloadWaveformFromBuffer(target);
    showToast('Undo');
  }, [canUndo, history, historyIndex, reloadWaveformFromBuffer, showToast]);

  const handleRedo = useCallback(async () => {
    if (!canRedo) return;
    const newIndex = historyIndex + 1;
    const target = history[newIndex];
    if (!target) return;
    historyIndexRef.current = newIndex;
    setHistoryIndex(newIndex);
    await reloadWaveformFromBuffer(target);
    showToast('Redo');
  }, [canRedo, history, historyIndex, reloadWaveformFromBuffer, showToast]);

  // -------- Keyboard shortcuts --------

  useEffect(() => {
    const isTypingTarget = (el: Element | null): boolean => {
      if (!el) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (el instanceof HTMLElement && el.isContentEditable) return true;
      return false;
    };

    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(document.activeElement)) return;

      const ctrlOrMeta = e.ctrlKey || e.metaKey;

      // Space — play/pause
      if (e.key === ' ' && !ctrlOrMeta && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        togglePlayPause();
        return;
      }

      // Delete / Backspace — delete selection
      if ((e.key === 'Delete' || e.key === 'Backspace') && !ctrlOrMeta) {
        if (hasSelection) {
          e.preventDefault();
          void handleDeleteSelection();
        }
        return;
      }

      if (!ctrlOrMeta) return;

      const k = e.key.toLowerCase();

      // Ctrl+A — select all
      if (k === 'a' && !e.shiftKey) {
        e.preventDefault();
        handleSelectAll();
        return;
      }

      // Ctrl+C — copy
      if (k === 'c' && !e.shiftKey) {
        if (hasSelection) {
          e.preventDefault();
          handleCopy();
        }
        return;
      }

      // Ctrl+X — cut
      if (k === 'x' && !e.shiftKey) {
        if (hasSelection) {
          e.preventDefault();
          void handleCut();
        }
        return;
      }

      // Ctrl+V — paste
      if (k === 'v' && !e.shiftKey) {
        if (clipboard) {
          e.preventDefault();
          void handlePaste();
        }
        return;
      }

      // Ctrl+Z — undo (or Shift+Ctrl+Z — redo)
      if (k === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          void handleRedo();
        } else {
          void handleUndo();
        }
        return;
      }

      // Ctrl+Y — redo
      if (k === 'y' && !e.shiftKey) {
        e.preventDefault();
        void handleRedo();
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    togglePlayPause,
    hasSelection,
    handleDeleteSelection,
    handleSelectAll,
    handleCopy,
    handleCut,
    handlePaste,
    handleUndo,
    handleRedo,
    clipboard,
  ]);

  const clipboardSeconds = clipboard ? clipboard.length / clipboard.sampleRate : 0;

  return (
    <div className={cn('relative flex flex-col h-full p-8 gap-6', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">{filename}</h2>
          <p className="text-sm text-muted-foreground">Audio File</p>
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

      {/* Unified toolbar: Transport | Edit | Effects | File */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-3">
          {/* Transport group */}
          <ToolbarGroup>
            <Button
              onClick={togglePlayPause}
              size="lg"
              className="h-14 w-14 rounded-full p-0"
              variant={isPlaying ? 'secondary' : 'default'}
              title="Play / Pause (Space)"
            >
              {isPlaying ? (
                <Pause className="h-6 w-6" />
              ) : (
                <Play className="h-6 w-6 ml-1" />
              )}
            </Button>
            {!isRecording ? (
              <Button
                onClick={startRecording}
                variant="outline"
                size="sm"
                className="gap-2"
                title="Record at Cursor"
              >
                <Mic className="h-4 w-4" />
                Record
              </Button>
            ) : (
              <Button
                onClick={stopRecording}
                variant="destructive"
                size="sm"
                className="gap-2 animate-pulse"
                title="Stop Recording"
              >
                <StopCircle className="h-4 w-4" />
                Stop
              </Button>
            )}
          </ToolbarGroup>

          <ToolbarDivider />

          {/* Edit group */}
          <ToolbarGroup>
            <Button
              onClick={handleCreateRegion}
              variant="outline"
              size="sm"
              className="gap-2"
              title="Select Region at Cursor"
            >
              <Crop className="h-4 w-4" />
              Select
            </Button>
            <Button
              onClick={handleSplitAtCursor}
              variant="outline"
              size="sm"
              className="gap-2"
              title="Split at Cursor"
            >
              <Scissors className="h-4 w-4" />
              Split
            </Button>
            <Button
              onClick={handleTrimToSelection}
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={!hasSelection}
              title="Trim to Selection"
            >
              <Crop className="h-4 w-4" />
              Trim
            </Button>
            <Button
              onClick={handleDeleteSelection}
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={!hasSelection}
              title="Delete Selection (Delete)"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </ToolbarGroup>

          <ToolbarDivider />

          {/* Clipboard group */}
          <ToolbarGroup>
            <Button
              onClick={handleCut}
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={!hasSelection}
              title="Cut (Ctrl+X)"
            >
              <Scissors className="h-4 w-4" />
              Cut
            </Button>
            <Button
              onClick={handleCopy}
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={!hasSelection}
              title="Copy (Ctrl+C)"
            >
              <Copy className="h-4 w-4" />
              Copy
            </Button>
            <div className="flex items-center gap-2">
              <Button
                onClick={handlePaste}
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={!clipboard}
                title="Paste (Ctrl+V)"
              >
                <ClipboardPaste className="h-4 w-4" />
                Paste
              </Button>
              {clipboard && (
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  Clipboard: {formatDuration(clipboardSeconds)}
                </span>
              )}
            </div>
          </ToolbarGroup>

          <ToolbarDivider />

          {/* History group */}
          <ToolbarGroup>
            <Button
              onClick={handleUndo}
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={!canUndo}
              title="Undo (Ctrl+Z)"
            >
              <Undo className="h-4 w-4" />
              Undo
            </Button>
            <Button
              onClick={handleRedo}
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={!canRedo}
              title="Redo (Ctrl+Y)"
            >
              <Redo className="h-4 w-4" />
              Redo
            </Button>
          </ToolbarGroup>

          <ToolbarDivider />

          {/* Effects group */}
          <ToolbarGroup>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2" title="Effects">
                  <Wand2 className="h-4 w-4" />
                  Effects
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>
                  Apply to {hasSelection ? 'selection' : 'full track'}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleGainPlus6}>Gain +6 dB</DropdownMenuItem>
                <DropdownMenuItem onClick={handleGainMinus6}>Gain -6 dB</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleFadeIn}>Fade In</DropdownMenuItem>
                <DropdownMenuItem onClick={handleFadeOut}>Fade Out</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleNormalize}>Normalize</DropdownMenuItem>
                <DropdownMenuItem onClick={handleReverse}>Reverse</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </ToolbarGroup>

          <ToolbarDivider />

          {/* File group */}
          <ToolbarGroup>
            <Button onClick={handleSaveAs} variant="outline" size="sm" className="gap-2" title="Save As">
              <Save className="h-4 w-4" />
              Save As
            </Button>
          </ToolbarGroup>
        </div>
      </div>

      {/* Toast notification */}
      {toast && (
        <div
          role="status"
          className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 rounded-md bg-foreground/90 px-4 py-2 text-sm text-background shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

/**
 * Groups related toolbar buttons with consistent spacing.
 */
function ToolbarGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2">{children}</div>;
}

/**
 * Thin vertical divider between toolbar sections.
 */
function ToolbarDivider() {
  return <div className="h-8 w-px bg-border" aria-hidden="true" />;
}

function formatTime(seconds: number): string {
  if (isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format a duration in seconds as "1.5s" or "12.3s" for status text.
 */
function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '0s';
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds)}s`;
}

/**
 * Convert AudioBuffer to WAV blob
 */
async function audioBufferToWav(audioBuffer: AudioBuffer): Promise<Blob> {
  // Write as 32-bit float WAV (format code 3, "IEEE float") — LOSSLESS
  // roundtrip of Float32 AudioBuffer samples. Using 16-bit PCM here
  // quantizes every edit, and after N edits the accumulated loss makes
  // the audio sound "filtered" and distant.
  const numberOfChannels = audioBuffer.numberOfChannels;
  const bytesPerSample = 4; // 32-bit float
  const dataLength = audioBuffer.length * numberOfChannels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);              // fmt chunk size
  view.setUint16(20, 3, true);               // format code 3 = IEEE float
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, audioBuffer.sampleRate, true);
  view.setUint32(28, audioBuffer.sampleRate * numberOfChannels * bytesPerSample, true); // byte rate
  view.setUint16(32, numberOfChannels * bytesPerSample, true); // block align
  view.setUint16(34, 32, true);              // 32 bits per sample
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  const channels: Float32Array[] = [];
  for (let i = 0; i < numberOfChannels; i++) {
    channels.push(audioBuffer.getChannelData(i));
  }

  let offset = 44;
  for (let i = 0; i < audioBuffer.length; i++) {
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const sample = channels[channel]![i]!;
      view.setFloat32(offset, sample, true);
      offset += 4;
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
 * Download file with save dialog (cross-platform: browser & Tauri)
 */
async function downloadFileWithDialog(blob: Blob, filename: string, mimeType: string) {
  try {
    const ext = filename.split('.').pop()?.toLowerCase() || 'wav';
    const arrayBuffer = await blob.arrayBuffer();
    await saveFile(arrayBuffer, {
      suggestedName: filename,
      types: [
        {
          description: 'Audio Files',
          accept: { [mimeType]: [`.${ext}`] },
        },
      ],
    });
  } catch (error) {
    if (error instanceof Error && error.name !== 'AbortError') {
      console.error('Failed to download file:', error);
    }
  }
}

export default WaveformEditor;
