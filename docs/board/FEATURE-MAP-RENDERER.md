# Feature-map renderer contract

`feature-map.html` only renders data that passes its four-label contract. The labels are exactly:

- Planned → `planned`
- Being built → `being-built`
- Built — checking it → `built-checking`
- Proven on Windows → `proven-windows`

The page stops with one clear error if the ordered label list, visible features, Not in V1 list, stages, groups, foundation, ids, requirement ids, or counts are not usable. It does not guess a label.

Today shows those exact labels. Future vision is deliberately marked as a future picture, not current proof. Not in V1 stays in a separate small panel and never changes V1 counts or filters.

The marker `feature-map-renderer-version=four-label-v1` lets a publisher reject an older renderer. The small input value is the supplied input-hash prefix when available, otherwise a deterministic data fingerprint.

Run the renderer contract checks without network access:

```bash
node docs/board/feature-map-renderer.test.mjs
```
