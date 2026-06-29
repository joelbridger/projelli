// PIVOT-16 — Surface the onboarding profession's pack first.
//
// The profession packs (legal/tax/consulting/advisors) ship built-in and already
// appear in the workflow picker alongside the general templates. A first-run
// user who told us they're an attorney should see the legal pack at the top of
// the picker, not buried in a flat grid of everything. This pure helper does
// that reordering; the picker calls it with the stored onboarding profession.
//
// PIVOT-A5: When profession is 'advisor', legal-pack templates (category
// 'legal') are EXCLUDED entirely (not just deprioritized), and the Advisor
// Practice Pack (category 'advisors') is featured first. Other professions
// are unchanged.

import type { WorkflowTemplate } from '@/platform/types/workflow';

export type Profession = 'legal' | 'tax' | 'consulting' | 'advisor' | 'other';

const ADVISOR_LEAD_TEMPLATE_NAMES = [
  'Annual Review Packet',
  'Meeting Prep & Suitability Notes',
  'Reg S-P Safeguards and Incident Response Outline',
] as const;

const ADVISOR_TEMPLATE_RANK = new Map<string, number>(
  ADVISOR_LEAD_TEMPLATE_NAMES.map((name, index) => [name, index]),
);

/**
 * Stable-sort `templates` so the ones whose `category` matches `profession`
 * come first, preserving the original relative order within each group.
 * `'other'` (or any non-matching profession) returns the list unchanged.
 *
 * Note: the advisor pack uses category `'advisors'` (plural) on templates;
 * the onboarding profession key is `'advisor'` (singular).
 *
 * Special rule for `'advisor'`: templates with category `'legal'` are
 * completely excluded from the result. The Advisor Practice Pack
 * (category `'advisors'`) is featured first among the remaining templates.
 */
export function prioritizeByProfession(
  templates: WorkflowTemplate[],
  profession: Profession,
): WorkflowTemplate[] {
  if (profession === 'other') return templates;

  // PIVOT-A5: advisors get a filtered + reordered view.
  if (profession === 'advisor') {
    // Exclude the legal pack entirely — no deposition/contradiction pipeline,
    // no legal-specific templates. Then float the advisor pack to the top.
    const withoutLegal = templates.filter((t) => t.category !== 'legal');
    const advisorMatch: WorkflowTemplate[] = [];
    const advisorRest: WorkflowTemplate[] = [];
    for (const t of withoutLegal) {
      if (t.category === 'advisors') {
        advisorMatch.push(t);
      } else {
        advisorRest.push(t);
      }
    }
    advisorMatch.sort((a, b) => {
      const aRank = ADVISOR_TEMPLATE_RANK.get(a.name) ?? ADVISOR_TEMPLATE_RANK.size;
      const bRank = ADVISOR_TEMPLATE_RANK.get(b.name) ?? ADVISOR_TEMPLATE_RANK.size;
      return aRank - bRank;
    });
    return advisorMatch.length === 0 ? withoutLegal : [...advisorMatch, ...advisorRest];
  }

  // Map the profession key to the category value stored on templates.
  const categoryToMatch: WorkflowTemplate['category'] = profession;

  const match: WorkflowTemplate[] = [];
  const rest: WorkflowTemplate[] = [];
  for (const t of templates) {
    if (t.category === categoryToMatch) {
      match.push(t);
    } else {
      rest.push(t);
    }
  }
  // No matches → nothing to reorder; return the original array reference.
  return match.length === 0 ? templates : [...match, ...rest];
}
