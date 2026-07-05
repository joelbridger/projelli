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
export type NoticeCardPillKind = 'joining' | 'lobby' | 'present' | 'failed';

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
      return { kind: 'present', tone: 'ok' };
    case 'failed':
      return { kind: 'failed', tone: 'warn' };
    case 'left':
    case 'idle':
      return null;
    default:
      return null;
  }
}
