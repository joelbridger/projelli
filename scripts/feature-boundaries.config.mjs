/**
 * Frontend feature ownership policy.
 *
 * Every direct child of src/features is a separately owned product surface,
 * except the temporary CRM composite described below.
 * A surface may use platform/, ui/, lib/, and its own files. Another surface
 * is visible only through that surface's root index module. Put reusable
 * behaviour in platform instead of reaching through a feature boundary.
 */
export const featureBoundaryConfig = {
  sourceRoot: 'src',
  // The checker assigns each direct child of src/features a distinct tag, such
  // as feature:ask or feature:meetings. Keeping this here makes the ownership
  // model explicit instead of burying it in path-matching code.
  featureTag: (feature) => `feature:${feature}`,
  // Mirrors tests/unit/architecture-boundaries.test.ts: CRM's extracted folders
  // are one composite surface today. Per-folder crm boundaries activate as seam
  // lanes P0-D/E/F land — flip by removing this composite entry and regenerating
  // the baseline (shrink-only).
  compositeFeatureTag: (feature) => (feature.startsWith('crm-') ? 'crm' : feature),
  publicEntrypoints: ['index.ts', 'index.tsx'],
  baselineFile: '.feature-boundaries-baseline.json',
};
