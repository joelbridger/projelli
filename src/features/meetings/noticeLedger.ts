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
import type { NoticeLocale } from './noticeMatcher';
import type { NoticeCardPlatform, NoticeCardFailureReason } from './noticeCard/noticeCardTypes';

/**
 * A stable key for a meeting folder, robust to absolute-vs-relative path forms.
 * The store writes notice entries with the canonical `meetingDir` Rust returns,
 * while the meetings tab lists rows via the FS backend, which can yield a
 * differently-prefixed path for the same folder. Matching on the trailing
 * folder name (unique within a client's `Meetings/`, which is the scope of one
 * ledger file) makes lookups agree regardless of prefix (codex-review R2).
 */
export function meetingDirKey(dir: string): string {
  const parts = dir.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? dir;
}

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
  // Captured at recording start: the firm's custom spoken-notice script ('' =
  // built-in wording) and the app locale THEN, so post-transcription
  // verification checks against what was actually shown for this recording —
  // not a script/locale the firm may have changed afterward (codex-review R6).
  | { kind: 'notice-context'; meetingDir: string; at: string; customScript: string; locale: NoticeLocale }
  | {
      kind: 'notice-review-resolved';
      meetingDir: string;
      at: string;
      resolution: NoticeResolution;
      /** Who resolved it (advisor name/id if known). */
      by?: string;
    }
  // ── Notice Card events (the local notice participant) ──────────────────────
  // The card joined the meeting and is showing the recording notice to every
  // participant. Records nothing, sends nothing — this is a notice signal, not
  // a capture.
  | {
      kind: 'notice-card-joined';
      meetingDir: string;
      at: string;
      platform: NoticeCardPlatform;
      meetingTitle?: string | undefined;
    }
  // The card left the meeting (recording stopped, or a clean teardown). Its
  // departure is itself the honest "recording has ended" signal.
  | { kind: 'notice-card-left'; meetingDir: string; at: string }
  // The card could not join (or was dropped and couldn't rejoin). Failure is
  // informative, never disruptive: the verified-verbal-notice path carries the
  // compliance load, and the reason is filed honestly.
  | { kind: 'notice-card-failed'; meetingDir: string; at: string; reason: NoticeCardFailureReason }
  // Derived at clean stop: the card was present in the meeting for the entire
  // recording (joined at/before start, stayed through stop, any gap covered by
  // the one permitted rejoin). This is the fact the policy engine consumes as
  // full-duration card-presence evidence.
  | {
      kind: 'notice-card-present-for-entire-recording';
      meetingDir: string;
      at: string;
      platform: NoticeCardPlatform;
    }
  // The advisor attested they will ALSO use Zoom's native Record (so every
  // participant gets Zoom's own official recording notice). A self-attestation,
  // filed as part of the notice trail.
  | { kind: 'zoom-native-record-attested'; meetingDir: string; at: string };

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
