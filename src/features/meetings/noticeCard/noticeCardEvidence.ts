/**
 * Notice Card — evidence derivation + the firm's evidence rule.
 *
 * The consent ledger is the single source of truth. This module is a read-only
 * projection: it folds a meeting's card events into a compact evidence object,
 * and evaluates whether a meeting's notice is satisfied given the firm's
 * evidence rule (verbal notice OR full-duration card presence by default; both
 * required if the firm dials it up).
 *
 * This is evidence/guidance, never a legal judgment.
 */
import type { NoticeEntry, NoticeState } from '../noticeLedger';
import type { NoticeCardPlatform, NoticeCardFailureReason } from './noticeCardTypes';

/**
 * What satisfies a meeting's recording notice for the Strict policy:
 * - `'either'` (default): a verified verbal notice OR full-duration card
 *   presence is enough. This is the feature's whole point — the card in every
 *   participant's face for the whole meeting is strong, provable notice.
 * - `'both'`: the firm requires a verified verbal notice AND full-duration card
 *   presence. The most cautious posture.
 * Verbal notice stays recommended everywhere: it is the strongest single piece
 * of evidence and works on phone calls where no card can join.
 */
export type NoticeEvidenceRule = 'either' | 'both';

export const DEFAULT_EVIDENCE_RULE: NoticeEvidenceRule = 'either';

/** Compact, read-only projection of a meeting's Notice Card events. */
export interface NoticeCardEvidence {
  /** The card was present for the entire recording (the derived ledger fact). */
  presentForEntireRecording: boolean;
  /** Platform of the last card activity, when known. */
  platform?: NoticeCardPlatform;
  /** The most recent failure reason, when the card failed to join / stay. */
  failedReason?: NoticeCardFailureReason;
}

/**
 * Fold a meeting's notice entries into Notice Card evidence. Full-duration
 * presence is claimed ONLY from the derived `notice-card-present-for-entire-
 * recording` fact — never inferred from a bare join, because a join that later
 * dropped is not full-duration evidence.
 */
export function deriveNoticeCardEvidence(entries: NoticeEntry[]): NoticeCardEvidence {
  const present = entries.find(
    (e): e is Extract<NoticeEntry, { kind: 'notice-card-present-for-entire-recording' }> =>
      e.kind === 'notice-card-present-for-entire-recording',
  );
  if (present) {
    return { presentForEntireRecording: true, platform: present.platform };
  }
  // No full-duration fact. Surface the latest platform/failure for the UI.
  let platform: NoticeCardPlatform | undefined;
  let failedReason: NoticeCardFailureReason | undefined;
  for (const e of entries) {
    if (e.kind === 'notice-card-joined') platform = e.platform;
    if (e.kind === 'notice-card-failed') failedReason = e.reason;
  }
  const out: NoticeCardEvidence = { presentForEntireRecording: false };
  if (platform !== undefined) out.platform = platform;
  if (failedReason !== undefined) out.failedReason = failedReason;
  return out;
}

/**
 * Does this meeting's notice satisfy the firm's evidence rule? A verified
 * verbal notice or a human resolution both count as "verbal evidence present".
 * `'unchecked'` (no transcript yet) is never falsely treated as satisfied.
 */
export function noticeEvidenceSatisfied(
  state: NoticeState,
  card: NoticeCardEvidence,
  rule: NoticeEvidenceRule,
): boolean {
  const verbalOk = state.status === 'verified' || state.status === 'resolved';
  const cardOk = card.presentForEntireRecording;
  return rule === 'both' ? verbalOk && cardOk : verbalOk || cardOk;
}
