/**
 * Notice Card — pure settings readers, mirroring `../noticeSettings.ts`.
 * Store-free so they're plainly testable and reusable from UI + store wiring.
 */
import type { NoticeEvidenceRule } from './noticeCardEvidence';
import { DEFAULT_EVIDENCE_RULE } from './noticeCardEvidence';

type Getter = (key: string) => unknown;

const DEFAULT_NAME_TEMPLATE = '⏺ Recording · {product}';

/** Firm default for offering the card (pre-check). Defaults to enabled. */
export function resolveNoticeCardEnabled(getSetting: Getter): boolean {
  const raw = getSetting('meetings.noticeCardEnabled');
  return raw === false ? false : true; // default true when unset/undefined
}

/** The guest display-name template (with `{advisor}`), blank falls to default. */
export function resolveNoticeCardNameTemplate(getSetting: Getter): string {
  const raw = getSetting('meetings.noticeCardNameTemplate');
  const s = typeof raw === 'string' ? raw.trim() : '';
  return s || DEFAULT_NAME_TEMPLATE;
}

/** What satisfies Strict: 'either' (default) or 'both'. Never fails into 'both'. */
export function resolveNoticeEvidenceRule(getSetting: Getter): NoticeEvidenceRule {
  return getSetting('meetings.noticeEvidenceRule') === 'both' ? 'both' : DEFAULT_EVIDENCE_RULE;
}
