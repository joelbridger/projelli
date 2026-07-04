/**
 * TranscriptViewer — renders transcript segments (speaker + text + mm:ss
 * timestamp); clicking a segment seeks the paired AudioPlayer. Also renders
 * `[t:ms]` citation chips inside AI-generated notes text the same way (see
 * `renderNoteWithCitations`), mirroring Ask's CitationText split-and-render
 * approach but as its own self-contained renderer (notes.docx viewing isn't
 * part of the Ask chat pipeline, so it doesn't go through useCitationHandlers).
 */
import { Fragment } from 'react';
import type { TranscriptFile, TranscriptSegment } from '@/platform/types/meeting';
import { mmss } from './meetingSources';

export interface TranscriptViewerProps {
  transcript: TranscriptFile;
  onSeek: (ms: number) => void;
  /** Highlights the segment covering this timestamp (e.g. current playhead). */
  activeMs?: number;
}

function segmentIsActive(seg: TranscriptSegment, activeMs: number | undefined): boolean {
  if (activeMs === undefined) return false;
  return activeMs >= seg.startMs && activeMs < seg.endMs;
}

export function TranscriptViewer({ transcript, onSeek, activeMs }: TranscriptViewerProps) {
  return (
    <div data-testid="transcript-viewer" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {transcript.segments.map((seg, i) => (
        <button
          key={i}
          type="button"
          data-testid="transcript-turn"
          onClick={() => { onSeek(seg.startMs); }}
          style={{
            display: 'flex',
            gap: 10,
            textAlign: 'left',
            border: 'none',
            background: segmentIsActive(seg, activeMs) ? 'var(--kp-accent-soft)' : 'transparent',
            borderRadius: 'var(--radius-md)',
            padding: '6px 8px',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <span style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)', minWidth: 42 }}>
            {mmss(seg.startMs)}
          </span>
          <span style={{ fontSize: 'var(--kp-font-sm)', fontWeight: 'var(--kp-weight-semibold)', color: 'var(--kp-navy)', minWidth: 56 }}>
            {seg.speaker}
          </span>
          <span style={{ fontSize: 'var(--kp-font-sm)', color: 'var(--kp-navy)' }}>{seg.text}</span>
        </button>
      ))}
    </div>
  );
}

const CITATION_RE = /(\[t:\d+\])/g;

/** Renders a notes.docx-derived bullet's text, turning every `[t:<ms>]`
 *  citation token into a small clickable chip that calls `onSeek(ms)`. */
export function renderNoteWithCitations(text: string, onSeek: (ms: number) => void): React.ReactNode {
  const parts = text.split(CITATION_RE);
  return parts.map((part, i) => {
    const m = part.match(/^\[t:(\d+)\]$/);
    if (!m) return <Fragment key={i}>{part}</Fragment>;
    const ms = Number(m[1]);
    return (
      <button
        key={i}
        type="button"
        data-testid="note-citation-chip"
        onClick={() => { onSeek(ms); }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          border: 'none',
          background: 'var(--kp-accent-soft)',
          color: 'var(--kp-navy)',
          borderRadius: 'var(--radius-sm)',
          padding: '0 6px',
          marginLeft: 4,
          fontSize: 'var(--kp-font-2xs)',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
        title={`Jump to ${mmss(ms)}`}
      >
        {mmss(ms)}
      </button>
    );
  });
}

export default TranscriptViewer;
