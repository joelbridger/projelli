# Unification sub-lane 3 — T1 reader migration

## Delivery identity

- Branch: `feat/unification-sublane3-reader-migration`
- Verified base: `8118b12cca5f05892e1418c254818268795694e8`
- Tested implementation: `36bed13195ab5af2f5bea067af89adf35cec5de1`
- Receipt: `src/platform/client-context/evidence/reader-migration-receipt.md`
- Final receipt-bearing SHA: see `git notes --ref=verification show HEAD`
- Rust touched: no
- Activation flag: still OFF by default; sub-lane 4 owns activation

## Outcome

Every listed T1 protected operation now asks one authoritative reader for a
four-arm decision and re-checks immediately before sensitive work where needed.
The legacy follower is only an agreement check: disagreement refuses and uses
the operation's existing visible error channel. It never grants authority.
Matter-only work proceeds only when the operation is wholly determined by the
exact matter. CRM/client identity work refuses without a proven full pair.
Explicit All remains a named workspace-wide capability where it was already
allowed. Blocked, changed, missing, archived, and uncertain states refuse.

The reader migration covers AI/Ask, file isolation, retrieval/audit scope,
privilege helpers, workflow destinations, CRM relay/routing, email, Docx,
App/Router saved artifacts, and Meetings foundation operations. No Meetings
surface or Rust code changed.

## Logical commit manifest

| Group | Production commits | Test/compatibility commits |
|---|---|---|
| AI / Ask | `b79dbccd2` | `d1a56f872`, `90fb1a2f7` |
| Isolation / privilege / central scope | `df29910ea` | `36bed1319` |
| Workflow / CRM | `1c1629cbf` | `6a30abec1` |
| Email / Docx / App-Router artifacts | `9906d1074` | `316df9a49` |
| Meetings foundation | `923c3bb9e`, `14d36c340` | `88c410a13` |

## Mandatory security review by pointer

This lane does **not** claim to have performed the Opus security review. The
coordinator should give the following final commit/file pointers to that lane.

### R1-R5 — AI, retrieval, and isolation

- `b79dbccd2`: `src/platform/client-context/selectionReader.ts`,
  `src/platform/client-context/index.ts`,
  `src/platform/client-context/selectionReader.test.ts`
- `b79dbccd2`: `src/features/ask/useAsk.ts`,
  `src/features/ask/useAsk.scope.test.ts` (R2)
- `b79dbccd2`: `src/features/ask/hooks/useChatSending.ts` (R3)
- `df29910ea`: `src/features/ask/hooks/fileAccessGuards.ts`,
  `tests/unit/ask/list-files-guard.test.ts` (R4; strengthen-only isolation)
- `b79dbccd2`: `src/features/ask/AIChatViewer.tsx`,
  `tests/unit/ask/chat-path-guards.test.tsx` (R5)
- `df29910ea`: `src/platform/matter/matterStore.ts` (R1 central scope)
- Final compatibility proofs: `90fb1a2f7` changes
  `tests/unit/matter-chat-scope.test.tsx` and
  `tests/unit/audit-provenance-events.test.tsx`; `36bed1319` changes
  `tests/unit/matter-store.test.ts`.

### R6-R8 — workflow and CRM

- `1c1629cbf`: `src/app/workflow/useWorkflowRunner.ts`,
  `tests/unit/workflow/useWorkflowRunner-save-error.test.tsx` (R6/R7)
- `1c1629cbf`: `src/platform/crm/useLiveCrmRecords.ts`,
  `src/platform/crm/useLiveCrmRecords.selection.test.tsx` (R8)
- `1c1629cbf`: `src/features/crm-ask/CrmAskProposalPanel.tsx`,
  `src/features/crm-ask/CrmAskProposalPanel.selection.test.tsx` (R13 client-scoped)
- `1c1629cbf`: `src/features/workflows/InterviewForm.tsx`,
  `tests/unit/InterviewForm.multiselect.test.tsx` (R13 matter-scoped)
- `6a30abec1`: all CRM/workflow/calendar/task compatibility fixtures named by
  `git show --name-only 6a30abec1`.

### R9-R10 and A2 — privilege/isolation

- `df29910ea`: `src/platform/hooks/usePrivilegedMatterMode.ts`
- `df29910ea`: `src/platform/matter/matterStore.ts`
- `df29910ea`: `tests/unit/privacy/privileged-matter-mode.test.tsx`
- `df29910ea`: `src/features/ask/hooks/fileAccessGuards.ts` and
  `tests/unit/ask/list-files-guard.test.ts`

### R11 — Meetings foundation

- `923c3bb9e`, `14d36c340`: `src/features/meetings/foundation/contract.ts`
- `923c3bb9e`, `14d36c340`:
  `src/features/meetings/foundation/contract.live.test.tsx` and
  `src/features/meetings/foundation/contract.hook-isolation.test.tsx`
- `88c410a13`:
  `src/features/meetings/foundation/contract.relay-chain.test.tsx`

### R12, R13, and A1 — email, Docx, and saved artifacts

- `9906d1074`: `src/features/email/EmailWorkspace.tsx`,
  `tests/unit/mail/email-per-matter-scope.test.tsx` (R12)
- `9906d1074`: `src/features/documents/media/DocxEditor.tsx`,
  `tests/unit/DocxEditor.test.tsx` (R13)
- `9906d1074`: `src/app/shell/routeSavedAskDocument.ts`,
  `src/app/shell/AppSurfaceRouter.tsx`,
  `tests/unit/appSurfaceRouter.saveDocument.test.ts` (A1)
- `316df9a49`: all email/mail compatibility fixtures named by
  `git show --name-only 316df9a49`.

## Verification at the tested implementation SHA

```text
$ git rev-parse HEAD
36bed13195ab5af2f5bea067af89adf35cec5de1

$ npx vitest run src/platform/client-context/clientContextStore.test.ts src/platform/client-context/selectionReader.test.ts src/features/ask/useAsk.scope.test.ts tests/unit/ask/chat-path-guards.test.tsx tests/unit/ask/list-files-guard.test.ts tests/unit/workflow/useWorkflowRunner-save-error.test.tsx src/platform/crm/useLiveCrmRecords.selection.test.tsx src/features/crm-ask/CrmAskProposalPanel.selection.test.tsx tests/unit/InterviewForm.multiselect.test.tsx tests/unit/mail/email-per-matter-scope.test.tsx tests/unit/DocxEditor.test.tsx tests/unit/appSurfaceRouter.saveDocument.test.ts tests/unit/privacy/privileged-matter-mode.test.tsx src/features/meetings/foundation/contract.live.test.tsx src/features/meetings/foundation/contract.hook-isolation.test.tsx tests/unit/matter-store.test.ts tests/unit/matter-chat-scope.test.tsx tests/unit/audit-provenance-events.test.tsx --reporter=dot
Test Files  18 passed (18)
Tests       238 passed (238)
Duration    39.46s

$ npm run selection:writers:test
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

The final `$ npm run gate` passed every frontend and static stage:

```text
Test Files  1139 passed | 3 skipped (1142)
Tests       9079 passed | 29 skipped (9108)
✅ No ESLint regression vs baseline. (63 fingerprint(s) cleaned up vs baseline)
✅ Handle guard passed — no permanent handle vanished, and no new ambiguous (duplicate) handles (64 frozen).
```

It remains honestly RED only because the unchanged worktree lacks the Linux
Piper sidecar required by both native stages:

```text
resource path `binaries/piper-x86_64-unknown-linux-gnu` doesn't exist
❌ FAILED: bash -c cd src-tauri && CI=1 cargo test --workspace --locked
resource path `binaries/piper-x86_64-unknown-linux-gnu` doesn't exist
❌ FAILED: bash -c cd src-tauri && cargo build --locked && ... golden-loop.sh
❌ GATE RED — see failures above
```

## Whole-tree scan and T2 remainder

Base scan: 963 matches in 224 files. Final scan: 956 matches in 223 files.
Both scans covered the whole authored tree. The final `rg` excluded only `.git`,
dependency trees, and generated build/test-output trees (`node_modules`, `dist`,
`target`, `coverage`). The receipt records the exact commands and disposition.

Intentional T2 remainders are `TrustBar`, `StatusBar`, `MatterHub`,
`MattersHome`, `MatterScopeSelector`, `Spine`, navigation/UI memory, and
`mcpSessionScope`; sub-lane 4 owns their stale markers/presentation. No T1
protected operation remains authorized from follower/null inference.

## Review and builder attestation

An earlier full-series review found one real issue: a Meetings keyword card
hid the selection refusal behind an empty state. `14d36c340` routes that refusal
through the existing catalogue error channel; the next review was clean. Two
fresh final `codex-review --commit 36bed13195ab5af2f5bea067af89adf35cec5de1`
rounds were also clean.

Fresh checks were run after the final implementation edit. The ownership grant
was respected. No assertion, timeout, snapshot, baseline, lint rule, guard, or
type was weakened. Authority is re-derived, never persisted. Every classifier
switch is exhaustive. The four source arms and disagreement are covered on real
operations. The commit groups and all required security pointers are above.
