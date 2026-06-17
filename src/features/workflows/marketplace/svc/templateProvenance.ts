// TemplateProvenance: where an installed template came from. Used to render
// the badge in WorkflowPanel and to disambiguate id collisions between
// built-in and community templates.

export type TemplateProvenance = 'community' | 'custom' | 'built-in';

export const TEMPLATE_PROVENANCE_LABELS: Record<TemplateProvenance, string> = {
  community: 'Community',
  custom: 'Custom',
  'built-in': 'Built-in',
};

export function isTemplateProvenance(v: unknown): v is TemplateProvenance {
  return v === 'community' || v === 'custom' || v === 'built-in';
}
