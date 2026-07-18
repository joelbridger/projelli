# WB-053 + WB-054 workflow dependency and sequence guard result

- Branch: `v1/workflow-dependent-due`
- Approved fire base: `f6973732479cac37df3722c7411a701f768ec1d5`
- Verified implementation SHA: `1c1f7ad5912797687d88d49c58f93725b1a12c4b`
- Receipt-bearing final tip and clean-status proof: `git notes --ref=verification show HEAD`
- Pushed/merged: no/no
- Rust/native work: **NO**

## Result

PASS for the builder-owned outcome.

The dark-by-default extension stores one optional immediate predecessor per
step, an explicit before/after offset in days/weeks/months, and one instance
sequence setting. Open-step due times derive from the saved workflow start or
the predecessor's canonical saved completion time. Every canonical completion
entry point runs the same registered validator and receives a typed refusal
before persistence when an earlier step is unfinished.

The result commit and moved machine receipt are evidence only. Independent
different-model review is not self-arranged in this lane; the coordinator
explicitly owns that review under the re-fire delta.

## Ancestry and completion-seam preflight

The first command ran before any edits:

```text
$ git log --oneline -1 && git rev-parse HEAD && git status --porcelain=v1 --branch
f69737324 merge: real-wiring sweep evidence (34 LIVE proofs, 0 dead, classification resolved all 15 unreachable; evidence-only)
f6973732479cac37df3722c7411a701f768ec1d5
## v1/workflow-dependent-due
```

Whole-tree scan scope: every file below this repository root, including tests;
only `.git/**` was excluded because it is Git's object database, not source.
The production completion entry points found were:

1. `Workflows.tsx:933`, the visible workflow step button.
2. `LiveCrmHome.tsx:567`, the Today/shared-work-item completion action.
3. `LiveCrmHome.tsx:658`, migration workflow recreation.

All three call `applyWorkflowStepCompletion(...)`. The sole direct
`completeWorkflowStep(...)` definition remains private in `workflowLive.ts`.
The validator doorway is `registerWorkflowCompletionValidator(...)` in that
same file. The relevant scan output at implementation SHA was:

```text
./src/features/crm-workflows/Workflows.tsx:933:                            applyWorkflowStepCompletion(
./src/features/crm-workflows/workflowStepPersistence.ts:433:registerWorkflowCompletionValidator(validateWorkflowDependentDueCompletion);
./src/features/crm-home/workflowLive.ts:61:export function registerWorkflowCompletionValidator(validator: WorkflowCompletionValidator): void {
./src/features/crm-home/workflowLive.ts:202:function completeWorkflowStep(instance: LiveWorkflowInstance, stepId: string, outcomeId?: string): LiveWorkflowInstance {
./src/features/crm-home/workflowLive.ts:220:export function applyWorkflowStepCompletion(
./src/features/crm-home/workflowLive.ts:238:  return completeWorkflowStep(instance, stepId, outcomeId);
./src/features/crm-home/shared/LiveCrmHome.tsx:567:    await live.save(applyWorkflowStepCompletion(instance, item.stepId));
./src/features/crm-home/shared/LiveCrmHome.tsx:658:          instance = applyWorkflowStepCompletion(instance, step.id);
exit=0
```

No completion caller or fenced CRM Home file was edited.

## Product and contract decisions implemented

- Metadata is versioned under the workflow instance's
  `workflowDependentDue` extension bag. No shared CRM contract or alternate
  store was added.
- A step has zero predecessors when based on workflow start, or exactly one
  predecessor when based on completion. That ID must be the immediately prior
  stable step in saved order. The first step cannot have a predecessor.
- Runtime validation rejects unknown, self, forward/non-immediate, multiple,
  malformed, cyclic, invalid-direction, invalid-unit, and non-whole/negative
  offset inputs before the save callback runs.
- Days and weeks preserve the canonical base time. Month arithmetic is UTC and
  clips safely at month-end, so January 31 plus one month becomes February 28
  in 2026.
- Open dependents read the most recent append-only predecessor completion
  operation, so a corrected completion recalculates the open due time.
  Completed dependents read the original completion operation, preserving the
  historical due time. A metadata patch cannot replace a completed
  dependent's rule or inject due/completion history fields.
- With sequence mode enabled, any unfinished earlier saved step blocks a later
  completion. The typed refusal codes are
  `workflow_dependency_incomplete` and `workflow_dependency_invalid`.
- The flag check occurs before the enabled child reads workflow metadata or
  creates save state. Flag OFF returns `null`, creates no controls or spacing,
  and makes no workflow save call. The non-React validator checks the same flag
  before inspecting its defensive workflow snapshot.
- The extension contributes exactly one typed append-only descriptor,
  `workflow-step.dependent-due`, after existing registry entries. Its public
  package contract delegates persistence only to the mounted
  `saveStepMetadata` callback.

## Canonical save and fresh-reload evidence

`dependentDue.live.test.ts` replaces only the Tauri command boundary. It saves
through `saveWorkflowStepMetadata(...)` into `saveLiveCrmRecord(...)`, observes
`crm_live_upsert`, discards the writer value, and reloads through a later
`crm_live_list` before each assertion.

The fresh-reader proof covers:

- predecessor ID, due rule, and `sequential: true` surviving reload;
- an out-of-order completion throwing `WorkflowCompletionRefusedError` before
  any upsert, followed by a fresh read showing both steps still open;
- predecessor completion changing the open dependent due time to
  `2026-07-12T10:00:00.000Z`;
- a later saved completion correction changing an open dependent due time to
  `2026-07-28T11:00:00.000Z`;
- a completed dependent retaining `2026-07-12T10:00:00.000Z`; and
- an invalid predecessor never invoking the save callback, followed by a fresh
  read showing the original immediate predecessor unchanged.

The full focused command ran at implementation SHA
`1c1f7ad5912797687d88d49c58f93725b1a12c4b`:

```text
$ npx vitest run src/features/crm-workflows/extensions/dependent-due/dependentDue.test.tsx src/features/crm-workflows/extensions/dependent-due/dependentDue.live.test.ts src/features/crm-workflows/workflowExtensionRegistry.test.tsx src/features/crm-workflows/workflowStepPersistence.test.ts src/features/crm-workflows/Workflows.stepMetadata.test.ts src/features/crm-home/workflowCompletionSeam.test.ts src/features/crm-home/workflowCompletionEntryPoints.test.tsx
 RUN  v4.1.3 /home/jameson/lantern/app/integration/.worktrees/v1/workflow-dependent-due

 Test Files  7 passed (7)
      Tests  28 passed (28)
   Start at  14:09:16
   Duration  4.92s (transform 7.93s, setup 2.22s, import 12.18s, tests 381ms, environment 2.37s)
exit=0
```

## Machine receipt and required checks

Receipt:
`src/features/crm-workflows/extensions/dependent-due/evidence/self-check-receipt-1c1f7ad59127.txt`

Receipt SHA-256 after moving it unchanged into the lane-owned package:

```text
9c9ad67cb5a2ccf5cde97343c7bb00573cc46ace5aa722ec1f7ae2c89e74bb52  src/features/crm-workflows/extensions/dependent-due/evidence/self-check-receipt-1c1f7ad59127.txt
```

Every receipt step below ran at implementation SHA
`1c1f7ad5912797687d88d49c58f93725b1a12c4b`:

```text
SELF-CHECK RECEIPT (machine-generated; DO NOT EDIT — a hand-edit is fabrication)
format_version: 3
repo: /home/jameson/lantern/app/integration/.worktrees/v1/workflow-dependent-due
sha: 1c1f7ad5912797687d88d49c58f93725b1a12c4b
tree: 085406aedfc2603f1a1e952cc26345c817beae59
gate_base: f6973732479cac37df3722c7411a701f768ec1d5
tool_blob: 2cdbd4254c388970d44b9a674dc793caf823040d
utc: 2026-07-18T14:01:14Z
step_timeout_seconds: 600
loadavg: 7.06 8.03 7.58
running_vitest_eslint_procs: 1
step: gate:changed | status=PASS | exit=0 | 14:01:14Z..14:07:19Z | bytes=2782683 | sha256=35b18ceca04fdc2e722a6532a3a558a6c8b9845051f7ddf1a462f68ea32f5835 | tail: s [22m [1m[32m3129 passed[39m[22m[90m (3129)[39m [2m Start at [22m 14:04:13 [2m Duration [22m 186.07s[2m (transform 16.83s, setup 72.35s, import 297.03s, tests 162.04s, environment 161.07s)[22m CHANGED GATE GREEN
step: typecheck | status=PASS | exit=0 | 14:07:19Z..14:07:42Z | bytes=53 | sha256=0cb20470af3131a9339183a7ea4a056e66c088f0df43e068a5ea40a2a2a8c9fc | tail:  > advisor-prep-hero@3.3.5 typecheck > tsc --noEmit
step: typecheck:tests | status=PASS | exit=0 | 14:07:42Z..14:08:12Z | bytes=81 | sha256=4232b1e44d685ea74bf07a84d18a642e1c57ed0f9318cd4993d8a16d03448fc4 | tail:  > advisor-prep-hero@3.3.5 typecheck:tests > tsc -p tsconfig.test.json --noEmit
step: handle-guard | status=PASS | exit=0 | 14:08:12Z..14:08:12Z | bytes=1364 | sha256=57b4db42d03ec695ce76ecf1a0ced3d6d63d94a3d0e0580ad6cce34fadd4e8e1 | tail:  + booking-page-hosted-link-rail + booking-page-preview-button + booking-page-settings +479 more Handle guard passed no permanent handle vanished, and no new ambiguous (duplicate) handles (64 frozen).
step: arch-dag-guard | status=PASS | exit=0 | 14:08:12Z..14:08:13Z | bytes=519 | sha256=985c3795617555cb3d667204d9ac9c28cd8ae04a824e818dd0b55a1a30063443 | tail: assed[39m[22m[90m (1)[39m [2m Tests [22m [1m[32m1 passed[39m[22m[90m (1)[39m [2m Start at [22m 14:08:12 [2m Duration [22m 995ms[2m (transform 239ms, setup 374ms, import 244ms, tests 3ms, environment 284ms)[22m
step: i18n-snapshot | status=PASS | exit=0 | 14:08:13Z..14:08:14Z | bytes=520 | sha256=601d5158646d730f586ebe8a8c37f0491d2001b8ac1caf55bd396193db63c8c1 | tail: ssed[39m[22m[90m (1)[39m [2m Tests [22m [1m[32m5 passed[39m[22m[90m (5)[39m [2m Start at [22m 14:08:13 [2m Duration [22m 1.05s[2m (transform 270ms, setup 394ms, import 240ms, tests 19ms, environment 295ms)[22m
step: boundaries:check | status=PASS | exit=0 | 14:08:14Z..14:08:17Z | bytes=151 | sha256=28937977f27fc438a6e9ae1a771d2ae8ca85765df3e4cac8a3f0e4e4aaffa5bc | tail:  > advisor-prep-hero@3.3.5 boundaries:check > node scripts/check-boundaries.mjs No feature-boundary regression (599 current baseline finding(s)).
step: focused | status=PASS | exit=0 | 14:08:17Z..14:08:18Z | bytes=706 | sha256=6ae110720e130805b2460a28aa0fd910ae1d0ff5583bea0c7c6ac357e096ce23 | tail: ssed[39m[22m[90m (2)[39m [2m Tests [22m [1m[32m5 passed[39m[22m[90m (5)[39m [2m Start at [22m 14:08:17 [2m Duration [22m 1.29s[2m (transform 598ms, setup 669ms, import 807ms, tests 97ms, environment 584ms)[22m
overall: GREEN
```

The explicit touched-file ESLint run at the same SHA produced no stdout or
stderr and exited zero:

```text
$ npx eslint src/features/crm-workflows/extensions/dependent-due/contract.ts src/features/crm-workflows/extensions/dependent-due/WorkflowDependentDue.tsx src/features/crm-workflows/extensions/dependent-due/index.ts src/features/crm-workflows/extensions/dependent-due/dependentDue.test.tsx src/features/crm-workflows/extensions/dependent-due/dependentDue.live.test.ts src/features/crm-workflows/Workflows.stepMetadata.test.ts src/features/crm-workflows/workflowExtensionRegistry.test.tsx src/features/crm-workflows/workflowExtensionRegistry.tsx src/features/crm-workflows/workflowStepPersistence.test.ts src/features/crm-workflows/workflowStepPersistence.ts src/platform/flags/registry.ts
<no output>
exit=0
```

The required diff whitespace check at the same SHA also produced no output and
exited zero:

```text
$ git diff --check f6973732479cac37df3722c7411a701f768ec1d5..HEAD
<no output>
exit=0
```

No full gate and no Cargo/Rust command were run, as required by the brief.

## Scope and manifest mapping

1. `src/features/crm-workflows/extensions/dependent-due/`: descriptor, minimal
   contract, flag-gated controls, three locale shards, focused/live tests, and
   the machine receipt.
2. `workflowExtensionRegistry.tsx`: one import and one final typed descriptor
   entry; registry tests prove order, real registered mount, and no-data/no-gap
   OFF behavior.
3. `workflowStepPersistence.ts`: validated immutable extension metadata,
   derived due-time helper, and the registered canonical completion validator;
   no storage implementation.
4. Named focused tests: invalid-shape/cycle/history protection, mounted callback,
   real upsert/fresh-list reload, recalculation, typed refusal, and unchanged
   rejected state.
5. `src/platform/flags/registry.ts`: one physical append-only
   `workflow-dependent-due` line, owner lane matching, created 2026-07-18,
   expires 2026-09-16, default OFF by registry contract.
6. This result artifact.

## Review and attestations

- Self-review: clean. The whole diff, completion scan, fence, async failure
  handling, runtime validation, locale shards, and touched-file lint were
  checked manually after the first green focused run. No self-arranged AI
  review was run because the re-fire delta reserves independent review for the
  coordinator.
- Independent Sol review: **PENDING COORDINATOR**, by explicit coordinator
  delta; not falsely claimed here.
- Fresh checks: `[attest: yes + 1c1f7ad5912797687d88d49c58f93725b1a12c4b]`
- Scope: `[attest: yes | 14 implementation/test/locale paths listed by git diff are all in the written grant; result + package receipt are the required evidence artifacts]`
- Guard integrity: `[attest: yes | no suppression, skip/only, weakened assertion/type, timeout, snapshot, baseline, or manifest edit]`
- Contracts: `[attest: yes | one minimal package contract; cross-feature completion registration uses the already-authorized workflowLive doorway from the granted persistence adapter; no new deep feature consumer]`

The launcher alone owns the final completion marker.
