# T1 selection reader migration receipt

## Identity and review frame

- Branch: `feat/unification-sublane3-reader-migration`
- Required and verified sub-lane-2 base: `8118b12cca5f05892e1418c254818268795694e8`
- Final production/security-reviewed commit: `f6a48b5e58ec589b877e4737f30c2da6e52a392f`
- Final test implementation and verification-input commit: `4b4fb3a877f6fc5ee868d79f5786296844c72a74`
- Production files changed after the banked security pass: none.
- Rust touched: no.
- Activation: `selection-authority-boot-gate` remains default OFF. Sub-lane 4 owns activation and T2 presentation.
- Security route: the coordinator-run Opus review of the production diff is PASSED and banked at `f6a48b5e5`. This fix round changes tests and these two evidence records only; it does not claim to rerun that security review.
- Strict route: the terra contract/test-honesty review returned CHANGES-2; commit `4b4fb3a87` cures its test-honesty finding by checking each reader's actual request, not by trusting a fabricated refusal.
- All checks ran at code tip `4b4fb3a87` (outputs recorded in these records).
- The final branch tip differs from that code tip ONLY by evidence-only commits touching exactly these paths: `src/platform/client-context/evidence/reader-migration-receipt.md`, `prep/wave2-results/unification-sublane3-reader-migration.md`.
- This is mechanically checked by the following actual output:

```text
$ git diff 4b4fb3a87..HEAD --name-only
prep/wave2-results/unification-sublane3-reader-migration.md
src/platform/client-context/evidence/reader-migration-receipt.md
```

The four compiler-visible source arms are `matter`, `matter-only`,
`all-matters`, and `blocked-unresolved`. A follower may only strengthen a
decision by causing refusal. It never grants authority.

## Complete T1 disposition table

`A6 side` is the Amendment-6 decision for the concrete operation. `MS proceed`
means the exact matter and its owned live data fully determine the read/change
and destination. `CS refuse` means a proven client identity is required.

All tests in this table passed in the 18-file focused run recorded below.

| ID / concrete operation | Base pointer | Final pointer and disposition/reason | A6 side | Exact focused proof and result | Review route/result |
|---|---|---|---|---|---|
| R1 retrieval/consent/audit scope | `matterStore.ts:2121` | `matterStore.ts:2269-2277`; migrate at the central scope chokepoint, refuse on disagreement/live loss | MS proceed | `matter-store` active-scope matter/All/deleted/archived; `matter-chat-scope`; `audit-provenance-events` — PASS | Opus pointer PASSED at `f6a48b5e5`; strict |
| R2 Ask retrieval scope | `useAsk.ts:229` | `useAsk.ts:238-239,711`; reactive slice plus action-time reread | MS proceed | `useAsk.scope`: matter, All, blocked, genuine follower mismatch — PASS | Opus PASSED; strict |
| R3 chat send | `useChatSending.ts:510` | `useChatSending.ts:464-474`; expected-scope action check | MS proceed | `chat-path-guards`: blocked and disagreement surface; actual send request asserts `requireFollowerAgreement: true` — PASS | Opus PASSED; strict |
| R4 file-tool isolation | `fileAccessGuards.ts:32` | `fileAccessGuards.ts:29-61`; strengthen-only expected-scope agreement check | MS proceed | `list-files-guard`: mismatch refuses before FS and actual request flag/pinned matter asserted; `chat-path-guards` — PASS | Opus PASSED; strict |
| R5 AI chat retrieval | `AIChatViewer.tsx:218` | `AIChatViewer.tsx:228-230`; reactive four-arm slice read | MS proceed | `chat-path-guards`: real controls disable/surface and hook request asserts agreement; `matter-chat-scope`, `audit-provenance-events` — PASS | Opus PASSED; strict |
| R6 workflow retrieval | `useWorkflowRunner.ts:103` | `useWorkflowRunner.ts:204-214`; initial operation decision | MS proceed | `useWorkflowRunner-save-error`: blocked/mismatch refuse before disk; actual initial request asserts agreement — PASS | Opus PASSED; strict |
| R7 workflow output destination | `useWorkflowRunner.ts:535` | `useWorkflowRunner.ts:220-230`; expected-matter reread before writes | MS proceed | same workflow test; request includes agreement and destination remains unwritten on refusal — PASS | Opus PASSED; strict |
| R8 local matter-owned CRM save | `useLiveCrmRecords.ts:27,86,126` | `useLiveCrmRecords.ts:138-143`; matter action check | MS proceed | `useLiveCrmRecords.selection`: matter-only local save succeeds; blocked/mismatch saves zero rows; actual request asserts agreement — PASS | Opus PASSED; strict |
| R8 client-derived firm route | same | `useLiveCrmRecords.ts:147-161`; require full live client pair | CS refuse | same test: matter-only firm route refuses, full pair routes, mismatch mutates/publishes nothing — PASS | Opus PASSED; strict |
| R8 shared relay | same | `useLiveCrmRecords.ts:29-41`; client-scoped hook | CS refuse | same test: matter-only/mismatch starts no relay; hook request asserts agreement — PASS | Opus PASSED; strict |
| R9 reactive privileged-mode resolution | `usePrivilegedMatterMode.ts:45`; `matterStore.ts:2186` | `usePrivilegedMatterMode.ts:66-73`; disagreement/uncertainty stays protected | MS proceed, but uncertainty arms | `privileged-matter-mode`: matter-only privileged arms, nonprivileged stays authorized, blocked/mismatch arms — PASS | Opus PASSED; strict |
| R10 `setMatterPrivileged` | `matterStore.ts:1801` | `matterStore.ts:1895-1906`; source decision gates active target | MS proceed, but uncertainty arms | `privileged-matter-mode`: matter-only target arms native guard; blocked/mismatch stays armed — PASS | Opus PASSED; strict |
| R11 Meetings list/read/mutate/approve/artifact | `contract.ts:533,558,943,990,2225,2233,2239,2245` | `contract.ts:52-69,597-598,1157,2254-2313`; one live agreement decision protects each foundation path | MS proceed | `contract.hook-isolation`: every named path refuses/surfaces mismatch and every hook/read request asserts agreement; `contract.live` — PASS | Opus PASSED; strict |
| R12 embedded mail list/read | `EmailWorkspace.tsx:310` | `EmailWorkspace.tsx:298-299,335-342`; reactive plus operation-time check | MS proceed | `email-per-matter-scope`: matter-only scoped backend read, blocked/mismatch no read; hook/read request flags asserted — PASS | Opus PASSED; strict |
| R12 email AI retrieval | `EmailWorkspace.tsx:540` | `EmailWorkspace.tsx:600-607`; operation-time expected-scope check | MS proceed | same test: embedded retrieval uses exact matter and refuses with no matter — PASS | Opus PASSED; strict |
| R13a CRM proposal destination | `CrmAskProposalPanel` | `CrmAskProposalPanel.tsx:12-36,70`; full client pair required | CS refuse | `CrmAskProposalPanel.selection`: full pair saves household; matter-only/blocked/mismatch refuse; hook request flag asserted — PASS | strict different-model; Opus route not required |
| R13b Interview workflow destination | `InterviewForm` | `InterviewForm.tsx:17-69,233-237`; reactive and submit-time check | MS proceed | `InterviewForm.multiselect`: matter-only proceeds; blocked/mismatch alert; hook/read request flags asserted — PASS | strict different-model |
| R13c Docx AI redline/apply | `DocxEditor` | `DocxEditor.tsx:1900-1946`; decision before model and expected-scope reread before apply | MS proceed | `DocxEditor`: matter-only redline succeeds; blocked/mismatch changes nothing; actual request flag asserted — PASS | strict different-model |
| A1 Ask/email artifact destination and route | `App.tsx` handoff, `AppSurfaceRouter`, `routeSavedAskDocument` | `routeSavedAskDocument.ts:39-45,99-134`; derive from source and recheck before write/route | MS proceed | `appSurfaceRouter.saveDocument`: matter-only/All targets, blocked/mismatch/changed refusal; actual expected-scope request flag asserted — PASS | strict different-model |
| A2 non-reactive privilege helpers | `isActiveMatterPrivileged`, `getPrivilegedMatterModeActive` | `matterStore.ts:2178-2185`; `usePrivilegedMatterMode.ts:50-73`; uncertainty protected | MS proceed, but uncertainty arms | `privileged-matter-mode`: reactive/nonreactive agreement, matter-only case 6, blocked/mismatch protected — PASS | strict different-model plus banked Opus helper review |

## Base re-grep and T2/non-authority dispositions

Base production scan command:

```text
git grep -l -E '(activeMatterId|activeMatter\b|useActiveMatter|resolveActiveMatter|getActiveScope|isActiveMatterPrivileged|getPrivilegedMatterModeActive|setMatterPrivileged)' 8118b12cca5f05892e1418c254818268795694e8 -- src
```

After limiting that result to authored `.ts/.tsx` production files (excluding
tests), the base had 49 files and the final test commit had 47. The two removed
match files are `routeSavedAskDocument.ts` and `DocxEditor.tsx` because their
old follower names were removed; `selectionReader.ts` is the one new source
file. Every base discovery is individually disposed below.

| Base discovery | Disposition and reason |
|---|---|
| `src/App.tsx` | Mixed A1 handoff plus T2 navigation snapshots/UI memory. A1 is protected by the route helper; T2 stays for sub-lane 4. |
| `src/app/shell/AppSurfaceRouter.tsx` | A1 protected route consumer; migrated. |
| `src/app/shell/layout/Spine.tsx` | T2 presentation/navigation highlight; untouched, sub-lane 4. |
| `src/app/shell/layout/StatusBar.tsx` | T2 presentation; untouched, sub-lane 4. |
| `src/app/shell/layout/TrustBar.tsx` | T2 presentation; untouched, sub-lane 4. |
| `src/app/shell/routeSavedAskDocument.ts` | A1 protected destination; migrated. |
| `src/app/shell/runtime/AppSurfaceRuntime.tsx` | T2 shell handoff/navigation state; untouched, sub-lane 4. |
| `src/app/workflow/useWorkflowRunner.ts` | R6/R7 protected operations; migrated. |
| `src/dev/marketing-capture-bridge.ts` | Demo/capture probe only; no authorization decision. |
| `src/features/ask/AIChatViewer.tsx` | R5 protected retrieval scope; migrated. |
| `src/features/ask/Ask.tsx` | Downstream prop/presentation consumer of R2; no independent authority read. |
| `src/features/ask/askScope.ts` | Pure scope value/type transformation; no store read or authorization. |
| `src/features/ask/hooks/useChatSending.ts` | R3 protected send; migrated. |
| `src/features/ask/hooks/verifyCitationsInResponse.ts` | Receives already-decided scope as data; no authority-store read. |
| `src/features/ask/pipeline/AskSendPipeline.ts` | Pipeline input field only; protected by R2/R3 action boundary. |
| `src/features/ask/registry/compatibility.ts` | Registry compatibility data; no runtime authority read. |
| `src/features/ask/registry/types.ts` | Type field only; no runtime read. |
| `src/features/ask/useAsk.ts` | R2 protected Ask operation; migrated. |
| `src/features/crm-ask/CrmAskProposalPanel.tsx` | R13a client-scoped operation; migrated/refuses matter-only. |
| `src/features/crm-clients/BookDirectoryView.tsx` | T2 directory presentation/selection echo; untouched, sub-lane 4. |
| `src/features/crm-clients/ClientsSurface.tsx` | T2 surface composition/navigation; untouched, sub-lane 4. |
| `src/features/documents/media/DocxEditor.tsx` | R13c protected AI operation; migrated. |
| `src/features/email/EmailWorkspace.tsx` | R12 protected mail and AI reads; migrated. |
| `src/features/email/useScrollPersistence.ts` | T2 UI scroll-memory key; no authorization. |
| `src/features/home/HomeOrientationSurface.tsx` | T2 home presentation/selection echo; untouched. |
| `src/features/home/types.ts` | Presentation prop type only. |
| `src/features/matters/MatterHub.tsx` | T2 badge/hub presentation; untouched, sub-lane 4. |
| `src/features/matters/MatterManagerDialog.tsx` | T2 selection UI and writer consumer already owned by sub-lane 2; no new T1 operation. |
| `src/features/matters/MatterScopeSelector.tsx` | T2 selector presentation; untouched, sub-lane 4. |
| `src/features/matters/MattersHome.tsx` | T2 presentation; untouched, sub-lane 4. |
| `src/features/matters/NewClientGroupDialog.tsx` | UI/writer flow already owned by sub-lane 2; no protected reader authority. |
| `src/features/meetings/AutoJoinMeetingsPanel.tsx` | Meetings surface presentation consuming protected R11 foundation; untouched by fence. |
| `src/features/meetings/ClientMeetingsTab.tsx` | Meetings surface presentation consuming R11; untouched by fence. |
| `src/features/meetings/MeetingAutoJoinScheduler.tsx` | Meetings surface consumer; R11 foundation is the safety boundary; untouched. |
| `src/features/meetings/TodaysMeetingsStrip.tsx` | Meetings presentation consumer; untouched by fence. |
| `src/features/meetings/foundation/contract.ts` | R11 protected foundation operations; migrated. |
| `src/features/meetings/meetingStore.ts` | Record/store field and legacy helper data; protected operations route through R11. |
| `src/features/privacy/PrivacyCenterHome.tsx` | T2 privacy presentation; no protected operation authorization. |
| `src/features/workflows/InterviewForm.tsx` | R13b protected workflow destination; migrated. |
| `src/platform/client-context/clientContextStore.ts` | Authoritative source/follower internals landed in sub-lanes 1/2; not a legacy reader. |
| `src/platform/client-context/selectionTypes.ts` | Authority type definitions; not an operation reader. |
| `src/platform/crm/useLiveCrmRecords.ts` | R8 protected CRM operations; migrated. |
| `src/platform/hooks/usePrivilegedMatterMode.ts` | R9/A2 protected resolver; migrated fail-protected. |
| `src/platform/matter/matterScopeGuard.ts` | Pure containment helper receiving an already-decided scope; R4 is the action boundary. |
| `src/platform/matter/matterStore.ts` | R1/R9/R10/A2 protected helpers plus source/store internals; protected reads migrated. |
| `src/platform/matter/matterWorkspaceFile.ts` | Persistence schema/data field; no runtime authorization decision. |
| `src/platform/mcp/mcpSessionScope.ts` | T2 context copy only, not authorization; untouched, sub-lane 4. |
| `src/platform/privacy/privilegedMatterMode.ts` | Pure privilege resolver given effective inputs; R9/A2 own authority resolution. |
| `src/platform/state/appNavigationStore.ts` | T2 UI-memory snapshots; untouched, sub-lane 4. |

Whole authored-tree counts at final test commit:

```text
Base: 963 matching lines in 224 files.
Final evidence tree: 963 matching lines in 225 files.
```

Final command excludes only `.git`, `node_modules`, `dist`, `target`, and
`coverage`; no authored source/test/doc tree is excluded.

## Per-operation battery mapping

Abbreviations: `I1` = item 1 A→B class, `I2` = per-reader forced disagreement,
`I8` = exactly-one/missing/ambiguous/archived-only resolution-to-operation
proof, `A6` = cases 5, 6, 3-client-refusal, and 11-clear interaction.
Every cited case below passed in the final focused run.

| Operation | I1 exact class/test/result | I2 exact reader proof/result | I8 and A6 exact mapping/result |
|---|---|---|---|
| R1 central read | read: `matter-store` deleted/archived refusal — PASS | genuine mismatch makes `getActiveScope` throw — PASS | classifier topology tests + active-scope matter/All/live-loss; case 5 MS, case 11 clear MS — PASS |
| R2 Ask | AI scope/read: `useAsk.scope` blocked and genuine mismatch — PASS | genuine source/follower mismatch — PASS | classifier arms feed blocked Ask; matter and All preserved; cases 5/11 MS — PASS |
| R3 chat send | AI scope/mutation boundary: `chat-path-guards` — PASS | actual send request has agreement flag and refusal surfaces — PASS | reader arm test + blocked real controls; cases 5/11 MS — PASS |
| R4 file tools | read/mutation isolation: `list-files-guard` — PASS | exact pinned request has agreement flag; no FS access — PASS | reader live-loss arms + real guard; cases 5/11 MS — PASS |
| R5 chat retrieval | read/AI scope: `chat-path-guards`, `matter-chat-scope` — PASS | exact hook request has agreement flag; controls disabled — PASS | matter/All retrieval plus blocked controls; cases 5/11 MS — PASS |
| R6 workflow retrieval | artifact/workflow: `useWorkflowRunner-save-error` — PASS | initial request flag asserted; no disk work — PASS | reader arms + blocked operation; cases 5/11 MS — PASS |
| R7 workflow destination | artifact destination: same test — PASS | action request flag asserted; no destination write — PASS | changed/blocked reader arms; cases 5/11 MS — PASS |
| R8 matter save | CRM mutation: `useLiveCrmRecords.selection` — PASS | exact matter request flag; zero saved/published — PASS | matter/All/blocked operation; case 5 MS — PASS |
| R8 firm route/relay | CRM relay: same test — PASS | exact client hook/read requests flagged; no relay/mutation — PASS | matter-only refuses without guessed client; cases 3 and 11 CS — PASS |
| R9 privileged reactive | privileged arming: `privileged-matter-mode` — PASS | genuine mismatch stays armed — PASS | blocked/live-loss protected; cases 5/6 MS, case 11 — PASS |
| R10 privilege mutation | privileged arming/mutation: same test — PASS | genuine mismatch/blocked stays armed — PASS | matter-only privileged and nonprivileged cases; cases 5/6 — PASS |
| R11 Meetings five paths | Meetings list/read/mutate/approve/artifact: `contract.hook-isolation` — PASS | every hook/read request flagged and every path refuses/surfaces — PASS | reader arms + live A→B path; case 5 MS — PASS |
| R12 mail list/AI | read/AI scope: `email-per-matter-scope` — PASS | exact hook/read requests flagged; no backend read — PASS | matter/All/blocked mail behaviors; cases 5/11 MS — PASS |
| R13a CRM proposal | CRM client destination: `CrmAskProposalPanel.selection` — PASS | exact hook request flagged; proposal disabled — PASS | full pair succeeds; matter-only refuses; cases 3/11 CS — PASS |
| R13b Interview | workflow destination: `InterviewForm.multiselect` — PASS | hook/submit requests flagged; alert surfaces — PASS | matter-only submit plus blocked; cases 5/11 MS — PASS |
| R13c Docx | artifact mutation: `DocxEditor` redline — PASS | exact request flagged; no model/engine call — PASS | matter-only works, blocked changes nothing; cases 5/11 MS — PASS |
| A1 saved artifact | artifact destination: `appSurfaceRouter.saveDocument` — PASS | exact expected-scope request flagged; write/route refuses — PASS | matter/All/blocked/changed destinations; cases 5/11 MS — PASS |
| A2 privilege helpers | privileged arming: `privileged-matter-mode` — PASS | genuine mismatch makes reactive and nonreactive routes protected — PASS | case 6 explicitly proves privileged/nonprivileged matter-only; cases 5/11 — PASS |

The shared resolution producers are proved by `clientContextStore.test.ts`
(`classifies provider-qualified liveness and every matter topology`, `returns a
sealed classification for blank, missing, archived, and live matter inputs`,
`uses matter-only for 2+ candidates`, and `preserves the exact scope on clear`).
`selectionReader.test.ts` then proves every produced arm, live-data loss, and
follower disagreement. The matrix above names the real operation test that
proves the resulting decision is enforced and surfaced.

## Amendment-5 coverage

- App/Router Ask/email destinations: `appSurfaceRouter.saveDocument` covers
  matter, explicit All, blocked, changed, and disagreement before routing/write.
- Non-reactive privilege: `privileged-matter-mode` covers
  `setMatterPrivileged`, `isActiveMatterPrivileged`, and
  `getPrivilegedMatterModeActive` through the shared resolver, including valid,
  matter-only, blocked, and disagreement states.

## Fresh verification output

All checks ran at code tip `4b4fb3a87`; their outputs are recorded below. The
complete 18-file run produced:

```text
Test Files  18 passed (18)
Tests       238 passed (238)
```

The ten files directly changed by the CHANGES-2 cure also passed separately:

```text
Test Files  10 passed (10)
Tests       133 passed (133)
Duration    39.79s
```

Static checks at the same verification input:

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

The earlier canonical gate at the production tip passed every frontend/static
stage and remained honestly red only at the two native steps because the
unchanged worktree lacks `binaries/piper-x86_64-unknown-linux-gnu`. No Rust or
sidecar change was made in this fix round.

## Integrity and self-review

- Self-review round 1: checked the CHANGES-2 delta reader by reader; found the
  one test TypeScript index-access error, fixed it, and reran type checking.
- Self-review round 2: checked the committed delta for scope, assertion
  preservation, request coverage, and production-file changes; clean.
- No existing assertion, refusal, timeout, snapshot, baseline, guard, type, or
  architecture rule was weakened or removed.
- Every changed test retains its prior refusal/surfacing assertion and adds an
  assertion on the actual request made by that reader.
- `git diff f6a48b5e5..4b4fb3a87 --name-only` contains ten test files and zero
  production files.
- The final branch tip differs from code tip `4b4fb3a87` ONLY by the two
  evidence paths listed and mechanically checked in the identity section.
