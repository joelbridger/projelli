# WB-053 + WB-054 workflow dependency fix-round result

- Branch: `v1/workflow-dependent-due`
- Original approved base: `f6973732479cac37df3722c7411a701f768ec1d5`
- Fix-round launch base: `6351fc044b0f4258f9feeeaea741f99c251b95cd`
- Last code tip (the exact tree checked): `5433f09fda8d674d4a0942e674e9530ff69ad4e6`
- Final commits after the code tip: evidence only
- Pushed/merged: no/no
- Rust/native work: **NO**

## Result

The CHANGES-4 product findings are fixed.

1. Completing a dependent step now saves its exact base timestamp and displayed
   due timestamp in version-2 `workflowDependentDue.completed` history. A
   predecessor correction made before completion becomes the saved historical
   base. Later corrections cannot rewrite that completed step after reload.
2. The dependency validator is registered beside the canonical completion
   seam through the public `@/features/crm-workflows` doorway. It no longer
   depends on `LiveWorkflows` loading first, and the isolated `LiveCrmHome`
   (Today owner) test receives the typed refusal without importing or mounting
   `LiveWorkflows`.
3. The registration shim is always present, but its validator's first action is
   the flag check. With the flag off it immediately returns `ok`, uses the
   pre-feature completion behavior, and never imports the completion-logic
   module. With the flag on, the heavy logic is lazy-loaded and completion
   fails closed while it loads or if loading fails.
4. This result is bound to the last code tip above. Only the two paths named in
   the evidence-binding section occur after that code tip.

## History-freeze proof

The live-route test uses the real `crm_live_upsert` and later
`crm_live_list` reader boundary. Its sequence is:

- first predecessor completion: `2026-07-10T10:00:00.000Z`;
- correction while the dependent is still open:
  `2026-07-20T10:00:00.000Z`;
- open dependent due recalculates to `2026-07-22T10:00:00.000Z`;
- dependent completes and reloads with this durable saved value:

```text
workflowDependentDue.version: 2
completed[dependent].baseAt: 2026-07-20T10:00:00.000Z
completed[dependent].dueAt:  2026-07-22T10:00:00.000Z
```

- a later predecessor correction to `2026-07-30T10:00:00.000Z` leaves the
  reloaded dependent due at `2026-07-22T10:00:00.000Z`.

An open third step still recalculates from its predecessor's latest correction,
so the freeze applies only to completed dependents and does not weaken live
open-step behavior.

## Registration and flag proof

The only `workflowLive.ts` change is the public shim import, registration
invoke, and returned wrapper invoke around its existing private completion
helper. `npm run boundaries:check` remains clean with no allowlist edit.

Focused proofs added:

- `workflowDependentDueTodayPath.test.tsx` imports `LiveCrmHome` without
  `LiveWorkflows`, attempts the real Today-owner completion action, receives
  `workflow_dependency_incomplete`, and observes zero saves.
- `workflowDependentDueCompletionRegistration.test.ts` replaces only the lazy
  completion-logic module, leaves the flag off, proves the validator returns
  `ok`, proves legacy completion behavior still runs, and proves the heavy
  module factory was never called.
- The canonical completion seam's byte-for-byte flag-off compatibility test
  remains unchanged and green.

## Exact final-code checks

All required checks below ran against code tip
`5433f09fda8d674d4a0942e674e9530ff69ad4e6`. No code changed afterward.

```text
$ npm run typecheck
> tsc --noEmit
exit=0

$ npm run typecheck:tests
> tsc -p tsconfig.test.json --noEmit
exit=0

$ npm run boundaries:check
> node scripts/check-boundaries.mjs
No feature-boundary regression (599 current baseline finding(s)).
exit=0

$ npx vitest run <9 focused workflow/dependent-due files>
Test Files  9 passed (9)
Tests       30 passed (30)
Duration    7.38s
exit=0
```

Touched-file ESLint and `git diff --check` also exited zero with no output.
The architecture DAG test, handle guard, and English locale snapshot passed.

## Machine receipt

Receipt:
`src/features/crm-workflows/extensions/dependent-due/evidence/self-check-receipt-5433f09fda8d.txt`

Receipt SHA-256:

```text
5694e505c0cf53d241646926aebb9dc05889c8f69e131f68e23267a9ffa41883  src/features/crm-workflows/extensions/dependent-due/evidence/self-check-receipt-5433f09fda8d.txt
```

The receipt truthfully reports `overall: INCONCLUSIVE` only because its broad
`gate:changed` step was still actively running at the ten-minute per-step limit
under shared machine load (`exit=124`). It does not report that broad sweep as
green. Every separately named required step in the same receipt is `PASS`,
including both typechecks, boundaries, architecture DAG, handle guard, locale
snapshot, and the 30-test focused suite.

## Evidence binding

Checkable evidence-only paths after the last code tip:

```text
src/features/crm-workflows/extensions/dependent-due/evidence/self-check-receipt-5433f09fda8d.txt
prep/wave2-results/workflow-dependent-due.md
```

Pasted output of `git diff 5433f09fda8d674d4a0942e674e9530ff69ad4e6..HEAD --name-only`
for the final evidence-only tip:

```text
prep/wave2-results/workflow-dependent-due.md
src/features/crm-workflows/extensions/dependent-due/evidence/self-check-receipt-5433f09fda8d.txt
```

## Review and attestations

- CHANGES-4 findings 1-3: fixed with regression proof.
- Self-review: complete; no remaining correctness issue found in the fix diff.
- Independent different-model re-review: pending coordinator, as required by
  the lane process.
- Fresh checks:
  `[attest: yes + 5433f09fda8d674d4a0942e674e9530ff69ad4e6]`
- Scope:
  `[attest: yes | dependent-due package/persistence/tests, one public-index export line, isolated Today test, and the narrowly amended workflowLive import/invokes]`
- Guard integrity:
  `[attest: yes | no suppression, skip/only, weakened assertion/type, timeout, snapshot, baseline, manifest, or architecture-allowlist edit]`
- Contracts:
  `[attest: yes | cross-feature production use is only through @/features/crm-workflows; boundaries clean]`

The launcher alone owns the final completion marker.
