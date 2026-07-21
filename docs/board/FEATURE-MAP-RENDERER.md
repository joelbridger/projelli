# Feature-map renderer contract

`feature-map.html` only renders data that passes its four-label contract. The labels are exactly:

- Planned → `planned`
- Being built → `being-built`
- Built — checking it → `built-checking`
- Proven on Windows → `proven-windows`

The page stops with one clear error if the ordered label list, `input_hash`, visible features, Not in V1 list, stages, groups, foundation, ids, requirement ids, or counts are not usable. It does not guess a label. `input_hash` must be a 64-character SHA-256 hexadecimal value; its first 12 characters are shown with `...`, while the exact value is retained in `#updated[data-input-hash]`.

Today shows those exact labels. Future vision is deliberately marked as a future picture, not current proof. Not in V1 stays in a separate small panel and never changes V1 counts or filters. A Not in V1 item uses the general scope wording unless control data supplies a non-blank `outsideV1Reason`; it never repurposes `statusNote` as a scope decision.

The marker `feature-map-renderer-version=four-label-v1` lets a publisher reject an older renderer. There is no locally invented fingerprint: the renderer consumes only supplied control-generated data.

Run the renderer contract checks without network access:

```bash
node docs/board/feature-map-renderer.test.mjs
```
