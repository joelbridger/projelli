// E3 (Tier B trust guard) — compose the honest provenance line that travels
// with an AI-drafted CRM note. A colleague or compliance officer reading the
// note in the CRM should be able to see, from the note itself, that a machine
// drafted it, from what, and who approved it. Kept a small pure function so
// the wording logic (which template, date formatting, advisor fallback) is
// unit-testable; the localized strings come from i18next.
import type { TFunction } from 'i18next';
import { BRAND } from '@/config/brand';

export interface CrmProvenanceInput {
  /** Advisor display name; blank falls back to a localized generic. */
  advisor: string;
  /** Where the AI drafted the note from. */
  sourceKind: 'meeting' | 'document';
  /** The source date (e.g. the meeting date), ISO or already-display. */
  sourceDate?: string | undefined;
  /** When the advisor approved the write (ISO). */
  approvedIso: string;
}

function formatDate(value: string | undefined, locale?: string): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(locale);
}

export function composeCrmProvenance(t: TFunction, input: CrmProvenanceInput, locale?: string): string {
  const advisor = input.advisor.trim() || t('matter.crm-review.provenance-advisor-fallback');
  const approved = formatDate(input.approvedIso, locale);
  // AI_AUTHOR is a locked brand identifier — never rebrand it.
  const ai = BRAND.messaging.redlineAuthor;
  const sourceDate = formatDate(input.sourceDate, locale);
  if (input.sourceKind === 'meeting' && sourceDate) {
    return t('matter.crm-review.provenance-from-meeting', { ai, advisor, date: sourceDate, approved });
  }
  return t('matter.crm-review.provenance-drafted', { ai, advisor, approved });
}
