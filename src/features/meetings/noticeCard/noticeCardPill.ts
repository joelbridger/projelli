/**
 * Notice Card — record-pill status mapping (pure).
 *
 * Maps the supervisor's status to an honest one-line pill message + tone, so
 * the advisor always knows whether the card made it into the meeting. Failure
 * is stated plainly with the fallback ("say the notice aloud").
 */
import type { NoticeCardStatus } from './supervisor';

export type NoticeCardPillTone = 'pending' | 'ok' | 'warn';

/** A discriminator (not an i18n key) so the pill renders with LITERAL t() keys
 *  the i18n extractor can see — the codebase avoids dynamic t() keys. */
export type NoticeCardPillKind = 'joining' | 'lobby' | 'present' | 'failed' | 'window-open-failed';

export interface NoticeCardPillView {
  kind: NoticeCardPillKind;
  tone: NoticeCardPillTone;
}

/** null when there is nothing to show (idle / left). */
export function noticeCardPillView(status: NoticeCardStatus | null): NoticeCardPillView | null {
  if (!status) return null;
  switch (status.phase) {
    case 'joining':
      return { kind: 'joining', tone: 'pending' };
    case 'lobby':
      return { kind: 'lobby', tone: 'pending' };
    case 'present':
    case 'present-unknown':
      // 'present-unknown' = admitted, DOM momentarily unreadable (QA-91d latch): the
      // card IS in the meeting, so it reads as present — NEVER "couldn't join". Reuses
      // the 'present' pill (no new i18n key) since to the advisor the card is just there.
      return { kind: 'present', tone: 'ok' };
    case 'failed':
      if (status.reason === 'window-open-failed') return { kind: 'window-open-failed', tone: 'warn' };
      return { kind: 'failed', tone: 'warn' };
    case 'left':
    case 'idle':
      return null;
    default:
      return null;
  }
}
