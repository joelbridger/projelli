# Workflow authoring extension 2 handoff

## Bound code and receipt

- Final code commit: `74544f0cd7502d998ea3b9255da2f829db5730be`
- Approved additive base: `c734322bd229500888d35e826becfccd00871e21`
- Machine receipt: `evidence/self-check-receipt-74544f0cd750.txt`
- Receipt result: `overall: GREEN`
- Push, merge, Cargo, native, and Rust work: **not run**

## The two public doorways

1. `WorkflowRecordStartSlot` is publicly exported from
   `@/features/crm-workflows`. The landed Workflows host supplies only its
   existing `addRequest`, `onAddRequestConsumed`, household choices, and current
   template identity. The slot owns enabled-descriptor selection, request
   narrowing, household/matter normalization, one-shot consumption, and child
   mounting outside `Workflows.tsx`.
2. `openWorkflowTemplateLibrary(context)` is publicly exported from the same
   doorway. The slot supplies its action, consumes the request once, and renders
   the existing `WorkflowAuthoringRuleMount`. A direct composition that did not
   use the sanctioned slot fails loudly instead of presenting a dead button.

The shared-host addition is exactly one `WorkflowRecordStartSlot` child with
the four already-owned inputs above. No dependent-specific descriptor scan,
household lookup, cast, context construction, store read, or quick-add child is
inside `Workflows.tsx`.

## Open-world and dark behavior

- An outside-consumer test imports the slot and descriptor composition only
  from `@/features/crm-workflows`, appends a fixture contribution, and receives
  the exact household ID, label, matter ID, and public library action.
- Slot tests inject open-world compositions without mutating the production
  registry and reject malformed contributions through the landed validator.
- With every contribution dark, the slot returns no DOM, never mounts a child,
  and a throwing household proxy proves it does not read household data.
- An unrelated task request also mounts no workflow child.
- The real library proof enables the landed authoring flag, invokes the public
  navigation action, clears the one-shot request once, and observes the real
  `workflow-authoring-library` handle from `WorkflowAuthoringRuleMount`.

## Checks and honest rerun note

The final machine receipt binds these results to the code commit above:

- Changed-code gate: PASS — 45 files, 188 tests.
- Typecheck: PASS.
- Test typecheck: PASS.
- Handle guard: PASS.
- Architecture boundary guard: PASS.
- English language snapshot: PASS — 5 tests.
- Focused workflow foundation suite: PASS — 6 files, 18 tests.

The first receipt attempt was RED because its changed-test step reported one
failure while 13 Vitest/ESLint processes were active on the shared machine.
The exact changed-test command immediately reran PASS (45 files, 188 tests),
and the full official receipt rerun then passed every required step under nine
concurrent test/lint processes. The red draft was overwritten by the tool's
fresh receipt for the same unchanged code SHA; no receipt was hand-edited.

## Attestations

1. **Fresh checks:** every final result above ran after the last code edit and
   is bound by the receipt to
   `74544f0cd7502d998ea3b9255da2f829db5730be`.
   `[attest: yes + 74544f0cd7502d998ea3b9255da2f829db5730be]`
2. **Scope:** every product touch is the authorized public workflow-authoring
   doorway, its one generic host mount, paved-path documentation, public
   exports, or seam-owned tests; this file and the receipt are evidence only.
   `[attest: yes]`
3. **Guard integrity:** no test, guard, assertion, timeout, snapshot, baseline,
   or manifest was weakened, and no suppression was added. `[attest: yes]`
4. **Contracts:** all exports are additive; existing record-start and library
   descriptors keep their shapes and behavior, the optional library action
   preserves direct consumers, the sanctioned slot supplies the real action,
   and the dark/default registry produces no child or visual gap.
   `[attest: yes]`
