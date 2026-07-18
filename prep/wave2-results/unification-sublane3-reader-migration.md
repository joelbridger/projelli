# Unification sub-lane 3 — T1 reader migration

## Final identity

- Branch: `feat/unification-sublane3-reader-migration`
- Verified sub-lane-2 base: `8118b12cca5f05892e1418c254818268795694e8`
- Banked production/security tip: `f6a48b5e58ec589b877e4737f30c2da6e52a392f`
- Final test implementation and verification input: `4b4fb3a877f6fc5ee868d79f5786296844c72a74`
- Receipt: `src/platform/client-context/evidence/reader-migration-receipt.md`
- Rust touched: no
- Production touched by the CHANGES-2 fix: no
- Activation flag: still OFF; sub-lane 4 owns activation and T2 stale/blocked presentation

The coordinator-run Opus SECURITY review is PASSED and banked for the complete
production diff at `f6a48b5e5`. This fix changes only ten tests and the two
evidence records, so it does not invalidate or claim to repeat that review.

## Outcome

Every protected T1 operation uses the authoritative four-arm decision. The
legacy follower can only cause refusal. It cannot grant authority. The
CHANGES-2 cure makes this testable per reader: every formerly mocked reader now
records the request the real consumer sends and asserts
`requireFollowerAgreement: true`, while preserving its existing refusal and
surfacing assertions.

## Logical commit manifest

| Group | Production commits | Test/compatibility commits |
|---|---|---|
| AI / Ask | `b79dbccd2` | `d1a56f872`, `90fb1a2f7`, `4b4fb3a87` |
| Isolation / privilege / central scope | `df29910ea` | `36bed1319`, `4b4fb3a87` |
| Workflow / CRM | `1c1629cbf` | `6a30abec1`, `4b4fb3a87` |
| Email / Docx / App-Router artifacts | `9906d1074` | `316df9a49`, `4b4fb3a87` |
| Meetings foundation | `923c3bb9e`, `14d36c340` | `88c410a13`, `4b4fb3a87` |
| Evidence only | none | receipt/result commit following `4b4fb3a87` |

## Complete operation dispositions

`MS` = matter-scoped, so matter-only may proceed. `CS` = client-scoped, so
matter-only must refuse. Every result below is PASS in the 18-file final run.

| ID / operation | Base → final / disposition and reason | A6 | Exact test/result | Review route/result |
|---|---|---|---|---|
| R1 retrieval/consent/audit | `matterStore:2121` → `2269-2277`; central authoritative read, disagreement/live-loss refuses | MS | `matter-store`, `matter-chat-scope`, `audit-provenance-events` — PASS | Opus PASSED `f6a48b5e5`; strict |
| R2 Ask retrieval | `useAsk:229` → `238-239,711`; reactive plus action reread | MS | `useAsk.scope` matter/All/blocked/genuine mismatch — PASS | Opus PASSED; strict |
| R3 chat send | `useChatSending:510` → `464-474`; expected-scope action check | MS | `chat-path-guards`; request agreement asserted, refusal surfaced — PASS | Opus PASSED; strict |
| R4 file tools | `fileAccessGuards:32` → `29-61`; strengthen-only action check | MS | `list-files-guard`; pinned request/agreement and no-FS refusal — PASS | Opus PASSED; strict |
| R5 AI chat scope | old null reader → `AIChatViewer:228-230`; four-arm reactive read | MS | `chat-path-guards`, `matter-chat-scope`; hook request/agreement — PASS | Opus PASSED; strict |
| R6 workflow retrieval | `useWorkflowRunner:103` → `204-214`; initial decision | MS | `useWorkflowRunner-save-error`; request/agreement, no disk on refusal — PASS | Opus PASSED; strict |
| R7 workflow destination | `useWorkflowRunner:535` → `220-230`; action reread | MS | same test; destination remains unwritten — PASS | Opus PASSED; strict |
| R8 matter-owned CRM save | `useLiveCrmRecords:27,86,126` → `138-143`; matter decision | MS | `useLiveCrmRecords.selection`; local matter-only save, blocked/mismatch zero writes — PASS | Opus PASSED; strict |
| R8 firm route | same → `147-161`; full client pair required | CS | same test; matter-only refuses, full pair routes — PASS | Opus PASSED; strict |
| R8 relay | same → `29-41`; client-scoped hook | CS | same test; no relay on matter-only/mismatch, request flag asserted — PASS | Opus PASSED; strict |
| R9 privileged reactive | old hook/read → `usePrivilegedMatterMode:66-73`; uncertainty protected | MS; uncertainty arms | `privileged-matter-mode` case 6 and disagreement — PASS | Opus PASSED; strict |
| R10 privileged mutation | `matterStore:1801` → `1895-1906`; proven target only | MS; uncertainty arms | same test; valid target arms, blocked/mismatch stays armed — PASS | Opus PASSED; strict |
| R11 Meetings list/read/mutate/approve/artifact | eight base reads → `contract:52-69,597-598,1157,2254-2313`; one live boundary | MS | `contract.hook-isolation`; five paths refuse/surface and all requests carry agreement — PASS | Opus PASSED; strict |
| R12 mail read | `EmailWorkspace:310` → `298-299,335-342`; reactive/action check | MS | `email-per-matter-scope`; scoped read, blocked/mismatch no read, requests asserted — PASS | Opus PASSED; strict |
| R12 mail AI | `EmailWorkspace:540` → `600-607`; expected-scope action check | MS | same test; exact matter retrieval/no fallback — PASS | Opus PASSED; strict |
| R13a CRM proposal | base surface → `CrmAskProposalPanel:12-36,70`; confirmed client required | CS | `CrmAskProposalPanel.selection`; full pair save, matter-only/blocked/mismatch refusal, request asserted — PASS | strict different-model |
| R13b Interview | base surface → `InterviewForm:17-69,233-237`; action check | MS | `InterviewForm.multiselect`; matter-only works, refusal alert and requests asserted — PASS | strict different-model |
| R13c Docx | base surface → `DocxEditor:1900-1946`; pre-model plus pre-apply check | MS | `DocxEditor`; matter-only works, blocked/mismatch no model/engine, request asserted — PASS | strict different-model |
| A1 saved artifacts | App/Router handoff → `routeSavedAskDocument:39-45,99-134`; derive/recheck target | MS | `appSurfaceRouter.saveDocument`; matter/All/blocked/changed/mismatch, request asserted — PASS | strict different-model |
| A2 privilege helpers | old nonreactive reads → `matterStore:2178-2185`, hook `50-73`; fail protected | MS; uncertainty arms | `privileged-matter-mode`; reactive/nonreactive valid, matter-only, blocked, mismatch — PASS | strict plus banked Opus helper review |

## Complete base re-grep disposition

The base production scan found 49 authored non-test `.ts/.tsx` files. This
table disposes every one, including all T2 rows and non-authority matches.

| Base file | Final disposition |
|---|---|
| `src/App.tsx` | A1 handoff protected by route helper; T2 snapshots/UI memory untouched for sub-lane 4. |
| `src/app/shell/AppSurfaceRouter.tsx` | A1 protected consumer; migrated. |
| `src/app/shell/layout/Spine.tsx` | T2 navigation highlight; untouched, sub-lane 4. |
| `src/app/shell/layout/StatusBar.tsx` | T2 presentation; untouched, sub-lane 4. |
| `src/app/shell/layout/TrustBar.tsx` | T2 presentation; untouched, sub-lane 4. |
| `src/app/shell/routeSavedAskDocument.ts` | A1 protected destination; migrated. |
| `src/app/shell/runtime/AppSurfaceRuntime.tsx` | T2 shell/navigation handoff; untouched. |
| `src/app/workflow/useWorkflowRunner.ts` | R6/R7 protected operations; migrated. |
| `src/dev/marketing-capture-bridge.ts` | Demo probe only; no authorization. |
| `src/features/ask/AIChatViewer.tsx` | R5 protected operation; migrated. |
| `src/features/ask/Ask.tsx` | Downstream R2 presentation/prop consumer; no independent authority. |
| `src/features/ask/askScope.ts` | Pure type/value transformation; no store read. |
| `src/features/ask/hooks/useChatSending.ts` | R3 protected send; migrated. |
| `src/features/ask/hooks/verifyCitationsInResponse.ts` | Receives decided scope as data; no authority read. |
| `src/features/ask/pipeline/AskSendPipeline.ts` | Pipeline input field; R2/R3 protect operation. |
| `src/features/ask/registry/compatibility.ts` | Registry data only. |
| `src/features/ask/registry/types.ts` | Type field only. |
| `src/features/ask/useAsk.ts` | R2 protected operation; migrated. |
| `src/features/crm-ask/CrmAskProposalPanel.tsx` | R13a client operation; migrated/refuses matter-only. |
| `src/features/crm-clients/BookDirectoryView.tsx` | T2 presentation/selection echo; untouched. |
| `src/features/crm-clients/ClientsSurface.tsx` | T2 composition/navigation; untouched. |
| `src/features/documents/media/DocxEditor.tsx` | R13c protected operation; migrated. |
| `src/features/email/EmailWorkspace.tsx` | R12 protected reads; migrated. |
| `src/features/email/useScrollPersistence.ts` | T2 scroll-memory key; no authorization. |
| `src/features/home/HomeOrientationSurface.tsx` | T2 home presentation; untouched. |
| `src/features/home/types.ts` | Presentation prop type only. |
| `src/features/matters/MatterHub.tsx` | T2 badge/hub presentation; untouched. |
| `src/features/matters/MatterManagerDialog.tsx` | T2 UI and writer consumer already owned by sub-lane 2. |
| `src/features/matters/MatterScopeSelector.tsx` | T2 selector presentation; untouched. |
| `src/features/matters/MattersHome.tsx` | T2 presentation; untouched. |
| `src/features/matters/NewClientGroupDialog.tsx` | UI/writer flow owned by sub-lane 2; no T1 reader. |
| `src/features/meetings/AutoJoinMeetingsPanel.tsx` | Meetings surface consumer of R11; untouched by fence. |
| `src/features/meetings/ClientMeetingsTab.tsx` | Meetings surface consumer of R11; untouched. |
| `src/features/meetings/MeetingAutoJoinScheduler.tsx` | Meetings surface consumer of R11; untouched. |
| `src/features/meetings/TodaysMeetingsStrip.tsx` | Meetings presentation consumer; untouched. |
| `src/features/meetings/foundation/contract.ts` | R11 foundation boundary; migrated. |
| `src/features/meetings/meetingStore.ts` | Record/store fields; protected operations route through R11. |
| `src/features/privacy/PrivacyCenterHome.tsx` | T2 privacy presentation; no authorization operation. |
| `src/features/workflows/InterviewForm.tsx` | R13b operation; migrated. |
| `src/platform/client-context/clientContextStore.ts` | Source/follower internals from sub-lanes 1/2; not legacy reader. |
| `src/platform/client-context/selectionTypes.ts` | Authority types; not operation reader. |
| `src/platform/crm/useLiveCrmRecords.ts` | R8 operations; migrated. |
| `src/platform/hooks/usePrivilegedMatterMode.ts` | R9/A2 resolver; migrated fail-protected. |
| `src/platform/matter/matterScopeGuard.ts` | Pure containment helper; R4 owns action decision. |
| `src/platform/matter/matterStore.ts` | R1/R9/R10/A2 plus source/store internals; protected reads migrated. |
| `src/platform/matter/matterWorkspaceFile.ts` | Persistence schema/data field; no authority decision. |
| `src/platform/mcp/mcpSessionScope.ts` | T2 context copy only; untouched, sub-lane 4. |
| `src/platform/privacy/privilegedMatterMode.ts` | Pure effective-input resolver; R9/A2 own authority. |
| `src/platform/state/appNavigationStore.ts` | T2 UI memory; untouched, sub-lane 4. |

Base whole-tree scan: 963 matching lines in 224 files. Final scan at the test
evidence tree: 963 matching lines in 225 files. The final command excluded only
`.git`, `node_modules`, `dist`, `target`, and `coverage`. In the production-file
subset, base = 49 files and final = 47; removed legacy-match files are
`routeSavedAskDocument.ts` and `DocxEditor.tsx`, and the new source file is
`selectionReader.ts`.

## Battery items 1, 2, and 8 plus Amendment 6

Every row is PASS. The resolution producer tests are
`clientContextStore.test.ts` (exactly-one, blank/missing, 2+ ambiguous,
archived, link removal, clear) and `selectionReader.test.ts` (all four arms,
live-data loss, expected-scope change, disagreement). The operation test in
each row proves the decision is enforced and surfaced.

| Operation | Item 1 class | Item 2 exact proof | Item 8 / A6 mapping |
|---|---|---|---|
| R1 | read: `matter-store` | genuine mismatch throws | matter/All/deleted/archived; case 5 MS, clear case 11 MS |
| R2 | AI scope/read: `useAsk.scope` | genuine mismatch refuses/surfaces | matter/All/blocked; cases 5/11 MS |
| R3 | AI send: `chat-path-guards` | actual send request carries agreement | blocked controls; cases 5/11 MS |
| R4 | file read/mutation: `list-files-guard` | exact pinned request carries agreement, no FS | live-loss reader arms; cases 5/11 MS |
| R5 | AI read: `chat-path-guards`, `matter-chat-scope` | hook request carries agreement | matter/All/blocked; cases 5/11 MS |
| R6 | workflow retrieval | initial request carries agreement, no disk | blocked reader; cases 5/11 MS |
| R7 | workflow artifact destination | action request carries agreement, no write | changed/blocked; cases 5/11 MS |
| R8 matter save | CRM mutation | matter request carries agreement, zero writes | matter/All/blocked; case 5 MS |
| R8 firm/relay | CRM relay | client hook/read requests carry agreement, no relay | matter-only refuses; cases 3/11 CS |
| R9 | privileged arming | genuine mismatch stays armed | blocked/live loss; cases 5/6/11 MS |
| R10 | privileged mutation | blocked/mismatch stays armed | privileged/nonprivileged matter-only; cases 5/6 MS |
| R11 | Meetings list/read/mutate/approve/artifact | every hook/read request carries agreement and all paths refuse | A→B live path; case 5 MS |
| R12 | mail read/AI scope | hook/read requests carry agreement, no backend read | matter/All/blocked; cases 5/11 MS |
| R13a | CRM client destination | hook request carries agreement, proposal disabled | full pair succeeds/matter-only refuses; cases 3/11 CS |
| R13b | workflow destination | hook/submit requests carry agreement, alert | matter-only/blocked; cases 5/11 MS |
| R13c | Docx artifact mutation | request carries agreement, no model/engine | matter-only/blocked; cases 5/11 MS |
| A1 | artifact destination | expected-scope request carries agreement, refusal | matter/All/blocked/changed; cases 5/11 MS |
| A2 | privileged arming | genuine mismatch protects reactive/nonreactive | case 6 explicit, cases 5/11 MS |

This table is also the complete Amendment-6 case 5 reader matrix. Case 6 is
explicitly covered by R9/R10/A2. Case 3 client refusal is R8 firm/relay and
R13a. Case 11 clear interaction is produced by `preserves the exact scope on
clear and rehydrates a cleared pair as matter-only`, then enforced by every MS
or CS operation row above.

## Amendment-5 coverage

- `appSurfaceRouter.saveDocument`: Ask/email artifact destinations and route,
  matter, All, blocked, disagreement, and selection-changed.
- `privileged-matter-mode`: valid, matter-only, blocked, and disagreement for
  reactive and non-reactive privilege resolution, including
  `setMatterPrivileged`.

## Mandatory security-review pointers

The builder supplies these pointers; the coordinator, not this lane, ran the
Opus review. Its PASS is banked at `f6a48b5e5`.

- R1/R9/R10/A2: `df29910ea` — `src/platform/matter/matterStore.ts`,
  `src/platform/hooks/usePrivilegedMatterMode.ts`,
  `src/features/ask/hooks/fileAccessGuards.ts`.
- R2/R3/R5: `b79dbccd2` — `src/features/ask/useAsk.ts`,
  `src/features/ask/hooks/useChatSending.ts`,
  `src/features/ask/AIChatViewer.tsx`, plus
  `src/platform/client-context/selectionReader.ts` and index.
- R4: `df29910ea` — `src/features/ask/hooks/fileAccessGuards.ts`.
- R6/R7: `1c1629cbf` — `src/app/workflow/useWorkflowRunner.ts`.
- R8: `1c1629cbf` — `src/platform/crm/useLiveCrmRecords.ts`.
- R11: `923c3bb9e`, `14d36c340` —
  `src/features/meetings/foundation/contract.ts`.
- R12: `9906d1074` — `src/features/email/EmailWorkspace.tsx`.
- R13a/R13b/R13c/A1 strict-route files: `9906d1074` and `1c1629cbf` —
  `CrmAskProposalPanel.tsx`, `InterviewForm.tsx`, `DocxEditor.tsx`,
  `routeSavedAskDocument.ts`, `AppSurfaceRouter.tsx`.

Commit `4b4fb3a87` changes only focused tests for these pointers. It adds no
production path and therefore does not expand the banked security diff.

## Exact fresh verification

Fresh 18-file focused run after the final test edit at `4b4fb3a877...`:

```text
Test Files  18 passed (18)
Tests       238 passed (238)
```

Direct CHANGES-2 ten-file run:

```text
Test Files  10 passed (10)
Tests       133 passed (133)
Duration    39.79s
```

```text
$ npm run typecheck:tests
> tsc -p tsconfig.test.json --noEmit
exit 0

$ npm run selection:writers:test
1..14
# tests 14
# pass 14
# fail 0

$ npm run selection:writers:check
PASS: one follower projection writer; zero direct client writers; zero unreviewed SK_MATTERS (lantern:matters) references.

$ npm run boundaries:check
✅ No feature-boundary regression (599 current baseline finding(s)).

$ node scripts/ui-system/handle-guard.mjs
✅ Handle guard passed — no permanent handle vanished, and no new ambiguous (duplicate) handles (64 frozen).

$ npx vitest run tests/unit/architecture-boundaries.test.ts --reporter=dot
Test Files  1 passed (1)
Tests       1 passed (1)

$ git diff --check
exit 0
```

The earlier canonical gate at the production tip passed all frontend/static
stages. It remained honestly red only at the two native steps because the
unchanged Linux voice sidecar is absent. This fix does not touch Rust or invent
that sidecar.

## Two self-review rounds and integrity attestation

1. Round 1 inspected every CHANGES-2 test delta against the corresponding
   production request. It found one test-only TypeScript index-access error;
   that was fixed and the test type-check was rerun green.
2. Round 2 inspected the committed delta for per-reader coverage, preserved
   assertions, scope, and production changes. Clean: ten test files only,
   every existing refusal/surfacing assertion retained, every new assertion
   observes the reader request.

No assertion, guard, type, timeout, snapshot, baseline, lint rule, or
architecture rule was weakened, skipped, or suppressed. Authority is
re-derived, not persisted. No follower or null inference authorizes work.
Clean-tree and pushed-tip evidence is added by the final commit verification
note after these two records are committed.
