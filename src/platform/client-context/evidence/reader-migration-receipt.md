# T1 selection reader migration receipt

## Identity and frame

- Branch: `feat/unification-sublane3-reader-migration`
- Required base, verified before work: `8118b12cca5f05892e1418c254818268795694e8`
- Tested implementation SHA: `36bed13195ab5af2f5bea067af89adf35cec5de1`
- Receipt-bearing final-tip proof: `git notes --ref=verification show HEAD`.
  The verification note is attached after this receipt is committed, so it can
  name the receipt-bearing commit without pretending that a commit can contain
  its own SHA.
- Rust touched: no.
- Activation: `selection-authority-boot-gate` remains default OFF; sub-lane 4
  still owns activation and the T2 stale-marker work.

This receipt applies Amendments 6 and 7 and the Reassessment Addendum. Runtime
authority is never persisted. Persisted values remain hints and every operation
re-derives its decision from the authoritative source plus live matter data.
The four arms are compiler-visible: `matter`, `matter-only`, `all-matters`, and
`refused` (including blocked, changed, missing, or follower disagreement).

## Reader disposition

`MO side` records the Amendment-6 predicate: matter-scoped operations may use
the exact matter; client-scoped operations refuse because no client identity is
proven.

| ID | Base location/purpose | Final location | Disposition | Operation class / MO side | Focused proof |
|---|---|---|---|---|---|
| R1 | `matterStore.ts:2121`, retrieval/consent/audit scope | `matterStore.ts:2269-2277` | central slice read plus exact follower agreement; refusal throws | matter-scoped / proceed | `matter-store`, `matter-chat-scope`, `audit-provenance-events` |
| R2 | `useAsk.ts:229`, Ask scope | `useAsk.ts:238-239,711` | reactive source read and action-time re-read; refusal uses existing Ask error state | matter-scoped / proceed | `useAsk.scope`, Ask compatibility tests |
| R3 | prior `useChatSending.ts:510`, chat send | `useChatSending.ts:464-474` | action-time expected-scope and agreement check before send | matter-scoped / proceed | `chat-path-guards`, `matter-chat-scope`, `audit-provenance-events` |
| R4 | file-tool isolation guard | `features/ask/hooks/fileAccessGuards.ts:29-61` | strengthen-only action-time agreement and expected-scope checks | matter-scoped / proceed | `chat-path-guards`, `list-files-guard` |
| R5 | `AIChatViewer` prior null-scope reader | `AIChatViewer.tsx:228-230` | reactive four-arm reader; explicit All preserved; refusal visible | matter-scoped / proceed | `matter-chat-scope`, `audit-provenance-events` |
| R6 | `useWorkflowRunner.ts:103`, retrieval scope | `useWorkflowRunner.ts:204-214` | initial operation decision; All is preserved | matter-scoped / proceed | `useWorkflowRunner-save-error` |
| R7 | `useWorkflowRunner.ts:535`, output destination | `useWorkflowRunner.ts:220-230` | action-time expected-matter re-read before destination write; refusal uses existing save error | matter-scoped / proceed | `useWorkflowRunner-save-error` |
| R8 | `useLiveCrmRecords.ts:27,86,126`, relay/routing | `useLiveCrmRecords.ts:38,138-161` | matter-owned saves accept MO; client-derived firm routing and relay require a full pair | mixed: matter save proceeds; client relay/routing refuses | `useLiveCrmRecords.selection` plus adapted live-record relay tests |
| R9 | privileged-mode hook/reactive read | `usePrivilegedMatterMode.ts:50-56`; `matterStore.ts:2178-2185` | uncertainty stays protected/armed | matter-scoped / proceed; refusal remains protected | `privileged-matter-mode` |
| R10 | `setMatterPrivileged` direct active read | `matterStore.ts:1895-1906` | non-reactive source read; only the proven target can alter active privileged mode | matter-scoped / proceed | `privileged-matter-mode` |
| R11 | Meetings foundation list/read/mutate/approve/artifact | `contract.ts:59-69,597-598,1157,2254-2313` | one foundation decision protects every path; existing error channel surfaces refusal | matter-scoped / proceed | `contract.live`, `contract.hook-isolation`, `contract.relay-chain` |
| R12 | `EmailWorkspace.tsx:310,540`, mail read and AI retrieval | `EmailWorkspace.tsx:298-299,335-342,600-607` | reactive and action-time checks; embedded matter works, explicit All remains global, refusal surfaces | matter-scoped / proceed | `email-per-matter-scope` plus adapted mail tests |
| R13a | `CrmAskProposalPanel` proposal destination | `CrmAskProposalPanel.tsx:20-36,70` | confirmed household required at action time | client-scoped / refuse | `CrmAskProposalPanel.selection` |
| R13b | `InterviewForm` workflow destination | `InterviewForm.tsx:37-69,233-237` | exact matter decision and re-check; existing alert surfaces refusal | matter-scoped / proceed | `InterviewForm.multiselect` |
| R13c | `DocxEditor` AI redline/apply | `DocxEditor.tsx:1900-1946` | decision before model work and expected-scope re-check before applying edits | matter-scoped / proceed | `DocxEditor` |
| A1 | App/Router Ask and email saved-document destinations | `routeSavedAskDocument.ts:39-45,99-134`; `AppSurfaceRouter.tsx:514-521,710-717` | destination derived from source, then re-checked immediately before the write | matter-scoped / proceed | `appSurfaceRouter.saveDocument` |
| A2 | non-reactive privileged helpers | `matterStore.ts:2178-2185`; `usePrivilegedMatterMode.ts:50-56` | refusal is protected, never unprotected | matter-scoped / proceed; refusal arms | `privileged-matter-mode` |

The shared reader lives at `selectionReader.ts:1-186`. Its exhaustive switches
cover the four source arms, expected-scope changes, missing/archived live data,
client requirements, and follower agreement. The `matter-only` arm never
manufactures a client and the follower can only refuse, never grant authority.

## T2 and non-authority remainders

The whole-tree inventory still finds the deliberately untouched T2 presentation
readers: `TrustBar`, `StatusBar`, `MatterHub`, `MattersHome`,
`MatterScopeSelector`, `Spine`, navigation/UI-memory stores, and
`mcpSessionScope`. They remain owned by sub-lane 4. Meetings surface files
remain presentation consumers of the protected foundation; no Meetings screen,
layout, control, or navigation was changed. Other matches are source/store
internals, tests, docs, demo probes, type names, or data cursors; they do not use
the follower to authorize a protected operation.

## Whole-tree inventory

Base command:

```text
git grep -n -E '(activeMatterId|activeMatter\b|useActiveMatter|resolveActiveMatter|getActiveScope|isActiveMatterPrivileged|getPrivilegedMatterModeActive|setMatterPrivileged)' 8118b12cca5f05892e1418c254818268795694e8 -- .
963 matches in 224 files
```

Final command at `36bed13195ab5af2f5bea067af89adf35cec5de1`:

```text
rg -n --hidden --glob '!.git/**' --glob '!node_modules/**' --glob '!dist/**' --glob '!target/**' --glob '!coverage/**' '(activeMatterId|activeMatter\b|useActiveMatter|resolveActiveMatter|getActiveScope|isActiveMatterPrivileged|getPrivilegedMatterModeActive|setMatterPrivileged)' .
956 matches in 223 files
```

The exclusions are explicit generated/dependency/build trees: `.git`,
`node_modules`, `dist`, `target`, and `coverage`. All authored source, tests,
scripts, docs, coordination records, prep records, marketing demo files, and
Rust source remained in scope. Match counts changed because T1 production
reads were replaced while explicit test fixtures and refusal proofs were added.

## Battery evidence

Exact final focused command ran 18 files covering the client-context reader,
all T1 operation groups, legacy retrieval/audit callers, and Meetings:

```text
$ git rev-parse HEAD
36bed13195ab5af2f5bea067af89adf35cec5de1

$ npx vitest run src/platform/client-context/clientContextStore.test.ts src/platform/client-context/selectionReader.test.ts src/features/ask/useAsk.scope.test.ts tests/unit/ask/chat-path-guards.test.tsx tests/unit/ask/list-files-guard.test.ts tests/unit/workflow/useWorkflowRunner-save-error.test.tsx src/platform/crm/useLiveCrmRecords.selection.test.tsx src/features/crm-ask/CrmAskProposalPanel.selection.test.tsx tests/unit/InterviewForm.multiselect.test.tsx tests/unit/mail/email-per-matter-scope.test.tsx tests/unit/DocxEditor.test.tsx tests/unit/appSurfaceRouter.saveDocument.test.ts tests/unit/privacy/privileged-matter-mode.test.tsx src/features/meetings/foundation/contract.live.test.tsx src/features/meetings/foundation/contract.hook-isolation.test.tsx tests/unit/matter-store.test.ts tests/unit/matter-chat-scope.test.tsx tests/unit/audit-provenance-events.test.tsx --reporter=dot
Test Files  18 passed (18)
Tests       238 passed (238)
Duration    39.46s
```

This includes real protected-operation proofs for `matter`, `matter-only`,
explicit `all-matters`, blocked-unresolved, changed selection, missing/archived
matter, and forced source/follower disagreement. The A→B blocked-follower
classes are represented across read, mutation, workflow/artifact destination,
CRM relay, AI scope, privileged arming, and Meetings
list/read/mutate/approve/artifact paths.

The full frontend suite in the final canonical gate also passed:

```text
Test Files  1139 passed | 3 skipped (1142)
Tests       9079 passed | 29 skipped (9108)
```

## Required final checks

All output below is from `36bed13195ab5af2f5bea067af89adf35cec5de1`.

```text
$ npm run selection:writers:test
1..14
# tests 14
# pass 14
# fail 0

$ npm run selection:writers:check
PASS: one follower projection writer; zero direct client writers; zero unreviewed SK_MATTERS (lantern:matters) references.

$ npm run boundaries:check
✅ No feature-boundary regression (599 current baseline finding(s)).

$ npm run typecheck:tests
> tsc -p tsconfig.test.json --noEmit
# exit 0

$ node scripts/ui-system/handle-guard.mjs
✅ Handle guard passed — no permanent handle vanished, and no new ambiguous (duplicate) handles (64 frozen).

$ npx vitest run tests/unit/architecture-boundaries.test.ts --reporter=dot
Test Files  1 passed (1)
Tests       1 passed (1)

$ git diff --check
# exit 0
```

The final `$ npm run gate` passed boundaries, writer retirement, application and
test type checking, the full frontend suite, ESLint, permanent handles, and the
design-token guard. Its overall result is honestly RED only at the two native
steps because the worktree lacks the base-required Linux voice sidecar:

```text
✅ No ESLint regression vs baseline. (63 fingerprint(s) cleaned up vs baseline)
resource path `binaries/piper-x86_64-unknown-linux-gnu` doesn't exist
❌ FAILED: bash -c cd src-tauri && CI=1 cargo test --workspace --locked
resource path `binaries/piper-x86_64-unknown-linux-gnu` doesn't exist
❌ FAILED: bash -c cd src-tauri && cargo build --locked && ... golden-loop.sh
❌ GATE RED — see failures above
```

No Rust file or sidecar was changed or fabricated.

## Review and integrity attestation

Two final `codex-review --commit 36bed13195ab5af2f5bea067af89adf35cec5de1`
rounds were clean. Both concluded that the tests drive the authoritative source
and that deleted/archived selections fail closed. An earlier full-series review
found the Meetings keyword-card refusal was hidden; commit `14d36c340` routed it
through the existing catalogue error channel, and the next review was clean.

- Every reported final check was rerun after the final implementation edit.
- Every touched production file is inside the ownership grant. Test-only fixture
  updates preserve existing assertions while explicitly supplying source
  authority; they do not infer authority from the follower.
- No test, guard, assertion, type, timeout, snapshot, baseline, lint rule, or
  architecture rule was weakened, skipped, or suppressed to manufacture green.
- The source/follower disagreement check is strengthen-only. It can refuse and
  surface; it cannot grant.
- The commit groups and security pointers are enumerated in the lane report.
