// E3 (Tier B trust guard) — the outbound gate for meeting notes.
//
// The scariest E3 path: an AI meeting note that is confidently wrong (or is
// literally the model apologizing it had no transcript) gets carried outward —
// into a follow-up email or, worse, the CRM a colleague trusts. The advisor is
// the only safety net, so a meeting note that hasn't cleared review must be
// STRUCTURALLY unsendable: its "Send to Wealthbox" and "Draft follow-up"
// affordances are disabled with an honest explanation until it's resolved.
//
// This module is the pure decision + the path recognizer; the async gathering
// of a note's state (meeting.json + notice ledger) lives in the hook that uses
// it, and the disabling lives in the DocxEditor toolbar.
import type { NoticeState } from './noticeLedger';
import type { NoticePolicy } from './noticeSettings';

/** The reason a meeting note is blocked from leaving, or null when it's clear.
 *  Reason keys map to `documents.outbound-gate.*` copy. */
export type OutboundGateReason = 'errored' | 'notice-quarantined' | 'needs-review';

export interface MeetingNoteGateInput {
  /** meeting.json `reviewedAt` — set once the advisor marks the note reviewed. */
  reviewedAt?: string | null | undefined;
  /** meeting.json `notesError` — present when generation errored or was flagged
   *  (the "AI apology as note" case). Truthy => never queueable. */
  notesError?: unknown;
  /** Folded notice status for the meeting (see deriveNoticeState). */
  noticeStatus: NoticeState['status'];
  /** The firm's notice policy — quarantine is a Strict-only hard block. */
  policy: NoticePolicy;
}

/**
 * Decide whether a meeting note may leave the app. Order matters: an errored
 * note is the most dangerous (it may be the model's confused apology) and can
 * never be queued; a Strict-policy notice quarantine is a hard compliance
 * block; otherwise an unreviewed note is held until the advisor checks it.
 */
export function meetingNoteOutboundGate(input: MeetingNoteGateInput): OutboundGateReason | null {
  if (input.notesError) return 'errored';
  if (input.policy === 'strict' && input.noticeStatus === 'unverified') return 'notice-quarantined';
  if (!input.reviewedAt) return 'needs-review';
  return null;
}

/**
 * Recognize a meeting's AI-generated notes doc from a workspace path and return
 * the meeting DIRECTORY (the path without the trailing `/notes.docx`), or null
 * for any other document. Only meeting notes are gated by this — ordinary
 * documents keep their normal outbound actions.
 */
export function meetingNotesDirForPath(tabPath: string): string | null {
  const m = /^(.*\/Meetings\/[^/]+)\/notes\.docx$/i.exec(tabPath);
  return m ? (m[1] ?? null) : null;
}
