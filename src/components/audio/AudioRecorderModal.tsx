// Audio Recorder Modal Component
// Records audio using Web Audio API and saves to workspace

import { useState, useCallback, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Mic, Square, Play, Pause, Save, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AudioRecorderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (audioBlob: Blob, filename: string) => Promise<void>;
}

export function AudioRecorderModal({
  isOpen,
  onClose,
  onSave,
}: AudioRecorderModalProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [filename, setFilename] = useState('recording');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (audioElementRef.current) {
        audioElementRef.current.pause();
        audioElementRef.current = null;
      }
    };
  }, []);

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

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setRecordedBlob(blob);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setDuration(0);

      // Start timer
      timerRef.current = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    } catch (error) {
      console.error('Failed to start recording:', error);
      alert('Failed to access microphone. Please check permissions.');
    }
  }, []);

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, [isRecording]);

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current && isPaused) {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      timerRef.current = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    }
  }, [isPaused]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [isRecording]);

  const playRecording = useCallback(() => {
    if (recordedBlob) {
      const url = URL.createObjectURL(recordedBlob);
      const audio = new Audio(url);
      audioElementRef.current = audio;

      audio.onended = () => {
        setIsPlaying(false);
        URL.revokeObjectURL(url);
      };

      audio.play();
      setIsPlaying(true);
    }
  }, [recordedBlob]);

  const pausePlayback = useCallback(() => {
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      setIsPlaying(false);
    }
  }, []);

  const handleClose = useCallback(() => {
    if (isRecording) {
      stopRecording();
    }
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current = null;
    }
    setRecordedBlob(null);
    setIsPlaying(false);
    setDuration(0);
    setFilename('recording');
    onClose();
  }, [isRecording, stopRecording, onClose]);

  const handleSave = useCallback(async () => {
    if (recordedBlob) {
      const finalFilename = filename.trim() || 'recording';
      await onSave(recordedBlob, `${finalFilename}.webm`);
      handleClose();
    }
  }, [recordedBlob, filename, onSave, handleClose]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Audio Recorder</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Duration Display */}
          <div className="text-center">
            <div className="text-4xl font-mono font-bold">
              {formatDuration(duration)}
            </div>
            {isRecording && (
              <div className="flex items-center justify-center gap-2 mt-2">
                <div className={cn('w-3 h-3 rounded-full bg-red-500', isPaused && 'opacity-50')} />
                <span className="text-sm text-muted-foreground">
                  {isPaused ? 'Paused' : 'Recording...'}
                </span>
              </div>
            )}
          </div>

          {/* Recording Controls */}
          <div className="flex items-center justify-center gap-2">
            {!isRecording && !recordedBlob && (
              <Button onClick={startRecording} size="lg" className="gap-2">
                <Mic className="h-5 w-5" />
                Start Recording
              </Button>
            )}

            {isRecording && !isPaused && (
              <>
                <Button onClick={pauseRecording} variant="outline" size="lg">
                  <Pause className="h-5 w-5" />
                </Button>
                <Button onClick={stopRecording} variant="destructive" size="lg" className="gap-2">
                  <Square className="h-5 w-5" />
                  Stop
                </Button>
              </>
            )}

            {isRecording && isPaused && (
              <>
                <Button onClick={resumeRecording} size="lg" className="gap-2">
                  <Mic className="h-5 w-5" />
                  Resume
                </Button>
                <Button onClick={stopRecording} variant="destructive" size="lg" className="gap-2">
                  <Square className="h-5 w-5" />
                  Stop
                </Button>
              </>
            )}
          </div>

          {/* Playback Controls (after recording) */}
          {recordedBlob && !isRecording && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-center gap-2">
                {!isPlaying ? (
                  <Button onClick={playRecording} variant="outline" size="lg" className="gap-2">
                    <Play className="h-5 w-5" />
                    Play
                  </Button>
                ) : (
                  <Button onClick={pausePlayback} variant="outline" size="lg" className="gap-2">
                    <Pause className="h-5 w-5" />
                    Pause
                  </Button>
                )}
              </div>

              {/* Filename Input */}
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Filename</label>
                <input
                  type="text"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  className="px-3 py-2 border rounded-md"
                  placeholder="recording"
                />
                <span className="text-xs text-muted-foreground">.webm extension will be added</span>
              </div>

              {/* Save & Discard Buttons */}
              <div className="flex gap-2">
                <Button onClick={handleSave} className="flex-1 gap-2">
                  <Save className="h-4 w-4" />
                  Save Recording
                </Button>
                <Button
                  onClick={() => {
                    setRecordedBlob(null);
                    setDuration(0);
                  }}
                  variant="outline"
                  className="gap-2"
                >
                  <X className="h-4 w-4" />
                  Discard
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default AudioRecorderModal;
