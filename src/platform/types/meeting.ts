// Meeting transcript wire schema. This is the ONE place this schema is
// declared on the TS side — Rust mirrors it in
// src-tauri/src/commands/capture/transcribe.rs and session.rs with
// #[serde(rename_all = "camelCase")], so field names here must match those
// serde structs exactly.

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
  };
}

export interface CaptureStatus {
  recording: boolean;
  meetingDir: string | null;
  elapsedMs: number;
  writeError: string | null;
}
