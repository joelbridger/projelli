import type { WorkflowTemplate } from '@/platform/types/workflow';

const SHORT_TEMPLATE_DESCRIPTIONS: Record<string, string> = {
  'advisors-meeting-prep-suitability-notes':
    'Build a pre-meeting brief with client snapshot, recap, suitability prompts, and talking points.',
  'advisors-annual-review-packet':
    'Draft an annual review packet: cover letter, checklist, and plan-change summary.',
  'legal-deposition-contradiction-finder':
    'Find cited candidate contradictions in a deposition and client record for attorney review.',
};

const LONG_TEMPLATE_DESCRIPTIONS: Record<string, string> = {
  'advisors-meeting-prep-suitability-notes':
    'Generates a complete pre-meeting briefing package: a client snapshot, last-meeting recap, current concerns summary, suitability checklist stub, and suggested talking points, all in one advisor working document.',
  'advisors-annual-review-packet':
    'Generates a complete annual review document set: a personalized cover letter recapping the year\'s events and plan changes, a comprehensive review checklist of items to cover, and a narrative plan changes summary for the client file.',
  'legal-deposition-contradiction-finder':
    'Flag candidate contradictions between a witness\'s deposition testimony and the rest of the client record (other documents, emails, prior statements). Grounded in client-scoped retrieval; every finding carries a citation you verify. Produces a structured Word deliverable.',
};

export function getWorkflowShortDescription(template: WorkflowTemplate): string {
  return SHORT_TEMPLATE_DESCRIPTIONS[template.id] ?? template.description;
}

export function getWorkflowLongDescription(template: WorkflowTemplate): string | null {
  return LONG_TEMPLATE_DESCRIPTIONS[template.id] ?? null;
}
