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
    /** Cheap fast-path so we can skip re-running the matcher when a check
     *  already exists. Not the authoritative guard — that is the atomic
     *  recordVerbalNoticeIfAbsent below. */
    hasVerbalNoticeCheck(meetingDir: string): Promise<boolean>;
    /** Atomically append the verbal-notice check only if none exists yet, so
     *  two racing verification callers can't both append (codex-review R5). */
    recordVerbalNoticeIfAbsent(
      entry: Extract<NoticeEntry, { kind: 'verbal-notice-verified' | 'verbal-notice-not-detected' }>,
    ): Promise<boolean>;
  };
  /** The firm's custom notice script, fed to the matcher as expected phrases. */
  customPhrases?: string[];
  locale?: NoticeLocale;
  /** Injectable clock for deterministic tests. */
  now?: () => string;
}

/**
 * Verify (once) whether the recording notice was spoken in this meeting, and
 * record the outcome to the ledger. Returns true only when this call appended
 * the durable verification entry. Never throws to its caller path (the store
 * wraps it best-effort too).
 */
export async function ensureNoticeVerified(meetingDir: string, deps: NoticeVerificationDeps): Promise<boolean> {
  // Idempotency: if we've already recorded a verbal-notice check for this
  // meeting, do nothing — the ledger is append-only and this must not
  // double-append on a re-open or a retry.
  if (await deps.ledger.hasVerbalNoticeCheck(meetingDir)) return false;

  const transcript = await deps.readTranscript();
  if (!transcript) return false; // not transcribed yet — try again later.

  // A dictated note has no meeting audio and therefore no spoken notice to
  // verify — never flag it as "notice missing".
  if (transcript.meta.dictation) return false;

  // The notice must be the ADVISOR's spoken words, not a participant's. The
  // advisor speaks on the 'mic' channel; 'sys' is remote/system audio. We scan
  // ONLY the mic side, so a client saying "I'm recording on my end" can never
  // stamp the advisor's notice as given (codex-review R1). We deliberately do
  // NOT fall back to scanning 'sys' when mic is empty: that would reintroduce
  // exactly that false-verify from a remote participant.
  //
  // Consequence (codex-review R2/R4): a transcript with no mic segments —
  // whether an imported/mono file (all 'sys' by design) or a captured meeting
  // whose advisor mic was silent — yields no scannable advisor speech, so no
  // notice is detected and we record 'not-detected'. This is the compliance-safe
  // default: it never false-VERIFIES, and it never silently lets a Strict-policy
  // meeting pass unreviewed. The honest outcome for these meetings is
  // needs-review, which the advisor clears in one click ("Notice was given —
  // transcription missed it" / "Disclosed in advance"). Dictated notes are the
  // one no-audio case that is genuinely notice-irrelevant, and they return
  // above. (A future explicit 'imported' marker from the transcription pipeline
  // could suppress the flag for true imports — noted in the handoff.)
  const segments: NoticeSegmentInput[] = transcript.segments
    .filter((s) => s.channel === 'mic')
    .map((s) => ({ startMs: s.startMs, text: s.text }));

  const now = deps.now ?? (() => new Date().toISOString());
  const match = detectRecordingNotice(segments, {
    ...(deps.locale ? { locale: deps.locale } : {}),
    ...(deps.customPhrases && deps.customPhrases.length > 0 ? { customPhrases: deps.customPhrases } : {}),
    windowMs: NOTICE_SCAN_WINDOW_MS,
  });

  // Atomic append-if-absent: even if another caller (post-stop vs. meeting
  // open) passed the fast-path check above at the same time, only one entry is
  // ever written (codex-review R5).
  if (match) {
    return deps.ledger.recordVerbalNoticeIfAbsent({
      kind: 'verbal-notice-verified',
      meetingDir,
      at: now(),
      audioMs: match.atMs,
      snippet: match.snippet,
      confidence: match.confidence,
    });
  } else {
    return deps.ledger.recordVerbalNoticeIfAbsent({
      kind: 'verbal-notice-not-detected',
      meetingDir,
      at: now(),
    });
  }
}
