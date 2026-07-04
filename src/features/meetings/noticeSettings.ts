/**
 * Recording Notice Kit — pure settings readers for the firm notice policy and
 * the custom spoken-notice script. Kept free of the store so they're plainly
 * testable and reusable from both UI and the store wiring.
 */

export type NoticePolicy = 'standard' | 'strict';

type Getter = (key: string) => unknown;

/** Standard (default) vs Strict. Anything unrecognized falls back to Standard —
 *  the policy dial never fails open into an unexpected mode. */
export function resolveNoticePolicy(getSetting: Getter): NoticePolicy {
  return getSetting('meetings.noticePolicy') === 'strict' ? 'strict' : 'standard';
}

/** The firm's custom spoken-notice script, trimmed. Empty string means "use the
 *  built-in localized default" — callers show the localized default text and
 *  feed the matcher no custom phrase (its semantic core already covers the
 *  default wording). */
export function customNoticeScript(getSetting: Getter): string {
  const raw = getSetting('meetings.noticeScript');
  return typeof raw === 'string' ? raw.trim() : '';
}
