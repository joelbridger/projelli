/**
 * Recording Notice Kit — the notice-evidence types + UI-state derivation.
 *
 * Notice events live in the SAME per-client ledger file as consent
 * (`<matter>/Meetings/.consent-ledger.json`), in a separate append-only
 * `notices` array (see consentLedger.ts). Every notice event is bound to a
 * meeting: the spoken notice verified from the transcript, the invite/chat
 * disclosures the advisor copied, and any human resolution of a missing
 * notice. Together they are the provable notice trail that answers a
 * compliance officer's "show me the meeting where the client wasn't told."
 *
 * This is evidence/guidance, never a legal judgment.
 */

/** How a human resolved a meeting whose spoken notice wasn't detected. */
export type NoticeResolution =
  | 'disclosed-in-advance' // told them via invite/chat before the meeting
  | 'transcription-missed' // notice was given; the transcript just missed it
  | 'acknowledged-gap'; // advisor acknowledges no notice was given

export type NoticeEntry =
  | {
      kind: 'verbal-notice-verified';
      meetingDir: string;
      at: string;
      /** Milliseconds into the recording where the notice was spoken. */
      audioMs: number;
      snippet: string;
      confidence: number;
    }
  | { kind: 'verbal-notice-not-detected'; meetingDir: string; at: string }
  | { kind: 'invite-disclosure-copied'; meetingDir: string; at: string; text: string }
  | { kind: 'chat-notice-copied'; meetingDir: string; at: string; text: string }
  | {
      kind: 'notice-review-resolved';
      meetingDir: string;
      at: string;
      resolution: NoticeResolution;
      /** Who resolved it (advisor name/id if known). */
      by?: string;
    };

/** Compact, UI-facing notice status derived from a meeting's ledger entries.
 *  The ledger is the single source of truth; this is a read-only projection. */
export type NoticeState =
  | { status: 'verified'; atMs: number; snippet: string; confidence: number }
  | { status: 'resolved'; resolution: NoticeResolution; at: string }
  | { status: 'unverified'; at: string }
  | { status: 'unchecked' };

/**
 * Fold a meeting's notice entries into one status.
 * Priority: a spoken notice we verified is the strongest evidence, so it wins;
 * otherwise a human resolution; otherwise a recorded "not detected" means the
 * meeting needs review; otherwise we simply haven't checked yet (no transcript,
 * or transcription hasn't finished).
 */
export function deriveNoticeState(entries: NoticeEntry[]): NoticeState {
  const verified = entries
    .filter((e): e is Extract<NoticeEntry, { kind: 'verbal-notice-verified' }> => e.kind === 'verbal-notice-verified')
    .sort((a, b) => b.confidence - a.confidence)[0];
  if (verified) {
    return { status: 'verified', atMs: verified.audioMs, snippet: verified.snippet, confidence: verified.confidence };
  }
  const resolutions = entries.filter(
    (e): e is Extract<NoticeEntry, { kind: 'notice-review-resolved' }> => e.kind === 'notice-review-resolved',
  );
  const lastResolution = resolutions[resolutions.length - 1];
  if (lastResolution) {
    return { status: 'resolved', resolution: lastResolution.resolution, at: lastResolution.at };
  }
  const notDetected = entries.find((e) => e.kind === 'verbal-notice-not-detected');
  if (notDetected) {
    return { status: 'unverified', at: notDetected.at };
  }
  return { status: 'unchecked' };
}
