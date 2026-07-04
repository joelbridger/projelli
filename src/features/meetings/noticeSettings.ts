/**
 * Recording Notice Kit — pure settings readers for the firm notice policy and
 * the custom spoken-notice script. Kept free of the store so they're plainly
 * testable and reusable from both UI and the store wiring.
 */

import { useSettingsStore } from '@/platform/settings/settingsStore';

export type NoticePolicy = 'standard' | 'strict';

type Getter = (key: string) => unknown;

/**
 * Reactive notice settings for React components. Subscribes to the specific
 * setting VALUES (not the stable getSetting function), so a Standard/Strict
 * toggle or a script edit re-renders every consumer immediately (codex-review
 * R3). `rawScript` is the untrimmed stored value for the settings textarea;
 * `customScript` is the trimmed value the matcher/consumers use.
 */
export function useNoticeSettings(): { policy: NoticePolicy; customScript: string; rawScript: string } {
  const policyRaw = useSettingsStore((s) => s.getSetting('meetings.noticePolicy'));
  const scriptRaw = useSettingsStore((s) => s.getSetting('meetings.noticeScript'));
  const rawScript = typeof scriptRaw === 'string' ? scriptRaw : '';
  return {
    policy: policyRaw === 'strict' ? 'strict' : 'standard',
    customScript: rawScript.trim(),
    rawScript,
  };
}

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
