/**
 * Frontend feature ownership policy.
 *
 * Every direct child of src/features is a separately owned product surface.
 * A surface may use platform/, ui/, lib/, and its own files. Another surface
 * is visible only through that surface's root index module. Put reusable
 * behaviour in platform instead of reaching through a feature boundary.
 */
export const featureBoundaryConfig = {
  sourceRoot: 'src',
  featureRoot: 'src/features',
  // The checker assigns each direct child of featureRoot a distinct tag, such
  // as feature:ask or feature:meetings. Keeping this here makes the ownership
  // model explicit instead of burying it in path-matching code.
  featureTag: (feature) => `feature:${feature}`,
  allowedFeatureDependencyTags: ['self', 'platform', 'ui', 'lib'],
  publicEntrypoints: ['index.ts', 'index.tsx'],
  baselineFile: '.feature-boundaries-baseline.json',
};
