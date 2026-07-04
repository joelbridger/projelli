/**
 * Recording Notice Kit — post-transcription verification (Piece 1, the seal).
 *
 * When a meeting's transcript lands, scan its first few minutes for the spoken
 * recording notice and stamp the result into the notice ledger. Idempotent and
 * best-effort: it runs after transcription in the store's stop pipeline AND
 * when a meeting page opens (so a batch-transcribed or pre-existing meeting
 * still gets verified). Fully local — it only reads the on-device transcript.
 */
import type { TranscriptFile } from '@/platform/types/meeting';
import { detectRecordingNotice, type NoticeLocale, type NoticeSegmentInput } from './noticeMatcher';
import type { NoticeEntry } from './noticeLedger';

/** Default scan window: the first 5 minutes of the recording. */
export const NOTICE_SCAN_WINDOW_MS = 5 * 60_000;

export interface NoticeVerificationDeps {
  /** Reads the meeting's transcript.json, or null if it isn't there yet /
   *  can't be read (transcription still queued). */
  readTranscript(): Promise<TranscriptFile | null>;
  ledger: {
    hasVerbalNoticeCheck(meetingDir: string): Promise<boolean>;
    recordNotice(entry: NoticeEntry): Promise<void>;
  };
  /** The firm's custom notice script, fed to the matcher as expected phrases. */
  customPhrases?: string[];
  locale?: NoticeLocale;
  /** Injectable clock for deterministic tests. */
  now?: () => string;
}

/**
 * Verify (once) whether the recording notice was spoken in this meeting, and
 * record the outcome to the ledger. Returns nothing — callers just fire it.
 * Never throws to its caller path (the store wraps it best-effort too).
 */
export async function ensureNoticeVerified(meetingDir: string, deps: NoticeVerificationDeps): Promise<void> {
  // Idempotency: if we've already recorded a verbal-notice check for this
  // meeting, do nothing — the ledger is append-only and this must not
  // double-append on a re-open or a retry.
  if (await deps.ledger.hasVerbalNoticeCheck(meetingDir)) return;

  const transcript = await deps.readTranscript();
  if (!transcript) return; // not transcribed yet — try again later.

  // A dictated note has no meeting audio and therefore no spoken notice to
  // verify — never flag it as "notice missing".
  if (transcript.meta.dictation) return;

  // The notice must be the ADVISOR's spoken words, not a participant's. The
  // advisor speaks on the 'mic' channel; 'sys' is remote/system audio. Verify
  // only the mic side, so a client saying "I'm recording on my end" can never
  // stamp the advisor's notice as given (codex-review R1).
  const micSegments = transcript.segments.filter((s) => s.channel === 'mic');

  // Imported/mono audio has no mic/sys separation — every segment is attributed
  // to 'sys' (transcribe.rs). With zero mic segments we can't isolate the
  // advisor's voice, so we can neither verify nor honestly flag "no notice" —
  // skip entirely (leaves the meeting 'unchecked', never a false quarantine).
  // codex-review R2. A genuinely empty transcript (no segments at all) still
  // falls through to a recorded not-detected below.
  if (micSegments.length === 0 && transcript.segments.length > 0) return;

  const segments: NoticeSegmentInput[] = micSegments.map((s) => ({ startMs: s.startMs, text: s.text }));

  const now = deps.now ?? (() => new Date().toISOString());
  const match = detectRecordingNotice(segments, {
    ...(deps.locale ? { locale: deps.locale } : {}),
    ...(deps.customPhrases && deps.customPhrases.length > 0 ? { customPhrases: deps.customPhrases } : {}),
    windowMs: NOTICE_SCAN_WINDOW_MS,
  });

  if (match) {
    await deps.ledger.recordNotice({
      kind: 'verbal-notice-verified',
      meetingDir,
      at: now(),
      audioMs: match.atMs,
      snippet: match.snippet,
      confidence: match.confidence,
    });
  } else {
    await deps.ledger.recordNotice({
      kind: 'verbal-notice-not-detected',
      meetingDir,
      at: now(),
    });
  }
}
