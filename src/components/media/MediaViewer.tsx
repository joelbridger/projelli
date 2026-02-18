// Media Viewer Components
// Displays images and videos with basic controls

import { useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  ZoomIn,
  ZoomOut,
  RotateCw,
  Maximize2,
  Play,
  Pause,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ImageViewerProps {
  src: string;
  alt?: string;
  className?: string;
}

export function ImageViewer({ src, alt = 'Image', className }: ImageViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleZoomIn = useCallback(() => {
    setZoom((prev) => Math.min(prev + 0.25, 4));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => Math.max(prev - 0.25, 0.25));
  }, []);

  const handleRotate = useCallback(() => {
    setRotation((prev) => (prev + 90) % 360);
  }, []);

  const handleFitToScreen = useCallback(() => {
    setZoom(1);
    setRotation(0);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom((prev) => Math.max(0.25, Math.min(4, prev + delta)));
    }
  }, []);

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b bg-muted/30">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleZoomOut}
          title="Zoom out"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <span className="text-xs text-muted-foreground w-12 text-center">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleZoomIn}
          title="Zoom in"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <div className="w-px h-4 bg-border mx-1" />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleRotate}
          title="Rotate 90°"
        >
          <RotateCw className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleFitToScreen}
          title="Fit to screen"
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Image container with scroll wheel zoom */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-muted/20 p-4"
        onWheel={handleWheel}
        style={{ cursor: zoom > 1 ? 'grab' : 'default' }}
      >
        <div className="min-h-full min-w-full flex items-center justify-center">
          <img
            src={src}
            alt={alt}
            style={{
              width: zoom === 1 ? '100%' : `${zoom * 100}%`,
              height: 'auto',
              transform: `rotate(${rotation}deg)`,
              transition: 'transform 0.2s ease-out',
              display: 'block',
            }}
            className="object-contain"
            draggable={false}
          />
        </div>
      </div>
    </div>
  );
}

interface VideoViewerProps {
  src: string;
  className?: string;
}

export function VideoViewer({ src, className }: VideoViewerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  const handlePlayPause = useCallback(() => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  const handleMuteToggle = useCallback(() => {
    if (!videoRef.current) return;
    videoRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  }, [isMuted]);

  const handleVideoEnded = useCallback(() => {
    setIsPlaying(false);
  }, []);

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b bg-muted/30">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handlePlayPause}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleMuteToggle}
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? (
            <VolumeX className="h-4 w-4" />
          ) : (
            <Volume2 className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Video container */}
      <div className="flex-1 overflow-hidden flex items-center justify-center bg-black">
        <video
          ref={videoRef}
          src={src}
          className="max-w-full max-h-full"
          onEnded={handleVideoEnded}
          controls
        />
      </div>
    </div>
  );
}

/**
 * Check if a file extension is an image type
 */
export function isImageFile(extension: string | undefined): boolean {
  if (!extension) return false;
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'];
  return imageExtensions.includes(extension.toLowerCase());
}

/**
 * Check if a file extension is a video type
 */
export function isVideoFile(extension: string | undefined): boolean {
  if (!extension) return false;
  const videoExtensions = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'ogg'];
  return videoExtensions.includes(extension.toLowerCase());
}

export default { ImageViewer, VideoViewer, isImageFile, isVideoFile };
