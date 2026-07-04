/**
 * Wave 3 meeting-capture shared schema. Owned by lane w3b (Task 8) — this
 * file mirrors the exact shape documented in
 * docs/plans/lantern-plus/2026-07-02-wave-3-meeting-capture.md (Task 8), so
 * lane w3c (this branch) can build against it before their commit lands.
 * Reconcile with w3b's landed version when it merges; expected to be
 * identical since both lanes follow the same plan text.
 */

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  channel: 'mic' | 'sys';
  speaker: string; // "You" | "Them" in v1
  text: string;
}

export interface TranscriptConsent {
  mode: 'one-party' | 'two-party';
  confirmedBy: string;
  confirmedAt: string;
  note?: string;
}

export interface TranscriptFile {
  segments: TranscriptSegment[];
  meta: {
    startedAt: string;
    durationMs: number;
    matterId: string;
    consent: TranscriptConsent;
    dictation?: boolean;
  };
}

export interface CaptureStatus {
  recording: boolean;
  meetingDir: string | null;
  elapsedMs: number;
}
