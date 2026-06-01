// PIVOT-16 — Surface the onboarding profession's pack first.
//
// The profession packs (legal/tax/consulting) ship built-in and already
// appear in the workflow picker alongside the general templates. A first-run
// user who told us they're an attorney should see the legal pack at the top of
// the picker, not buried in a flat grid of everything. This pure helper does
// that reordering; the picker calls it with the stored onboarding profession.

import type { WorkflowTemplate } from '@/types/workflow';

export type Profession = 'legal' | 'tax' | 'consulting' | 'other';

/**
 * Stable-sort `templates` so the ones whose `category` matches `profession`
 * come first, preserving the original relative order within each group.
 * `'other'` (or any non-matching profession) returns the list unchanged.
 */
export function prioritizeByProfession(
  templates: WorkflowTemplate[],
  profession: Profession,
): WorkflowTemplate[] {
  if (profession === 'other') return templates;

  const match: WorkflowTemplate[] = [];
  const rest: WorkflowTemplate[] = [];
  for (const t of templates) {
    if (t.category === profession) {
      match.push(t);
    } else {
      rest.push(t);
    }
  }
  // No matches → nothing to reorder; return the original array reference.
  return match.length === 0 ? templates : [...match, ...rest];
}
