# Unification sub-lane 4 integration receipt — activated gate green

The coordinator-granted lint-cure rerun passed. The lane-owned async test
doubles now return explicit promises, the ESLint baseline was not changed,
the boot-authority flag is ON, and the complete gate passed through a real
desktop create/save/restart/persistence cycle.

## Binding

- Branch: `feat/unification-sublane4-integration-activation`
- Required base: `19de3e85f6c8b34099860c3cc46a0725510b95a5`
- Granted rerun launch base: `29f102dae3accb0e06157ddcff86a0e5129d72e0`
- Lint-cure commit: `f4e58a9d8`
- Gate-tested activation commit: `5dd4f06e567465dc7110e873cdbcc82b7c78c44e`
- Reviewed stop tip: `a51899f658c4acd917a58e0c110d857726872082`
- Fix-round code tip before this evidence-only commit:
  `f8ce1c82f3499f752684e51735ed4b78ab38bed2`
- Activated state: `.env.production` contains only
  `VITE_FLAG_SELECTION_AUTHORITY_BOOT_GATE=true`.
- Evidence binding: the commit after the gate-tested activation commit contains
  evidence only.
  This is checkable with:

  ```text
  git diff --name-only 5dd4f06e567465dc7110e873cdbcc82b7c78c44e..HEAD
  prep/wave2-results/unification-sublane4-integration-activation.md
  src/platform/client-context/evidence/integration-activation-receipt.md
  ```

  The evidence commit cannot truthfully contain its own SHA. Its SHA is the
  repository `HEAD`; the immutable activated code to which the gate applies is
  named above.

## Base and ancestry

The worktree started clean at the required base. These three commands returned
success at the base and were repeated at the safe tip:

```text
git merge-base --is-ancestor 65588765e501b17e20aeee15a301b4072ac1affd 19de3e85f6c8b34099860c3cc46a0725510b95a5
git merge-base --is-ancestor 4b4fb3a877f6fc5ee868d79f5786296844c72a74 19de3e85f6c8b34099860c3cc46a0725510b95a5
git merge-base --is-ancestor f6a48b5e58ec589b877e4737f30c2da6e52a392f 19de3e85f6c8b34099860c3cc46a0725510b95a5
ancestry checks: PASS
```

This proves that the sub-lane-3 reader merge, its reader proof, and its banked
security receipt were already ancestors of the launch base.

## Activation preconditions

All three recorded preconditions were checked item by item at the exact
flag-off parent `b7db58c758eff656454b61179a794a862cc8488f`:

| Preconditions | Result |
|---|---|
| Complete protected A-to-B battery | PASS — 15 files, 214 tests |
| `boot-validation-failure-renders-BLOCKED` | PASS — 1 selected test passed, 4 skipped by the name filter |
| Sub-lane-3 ancestry and T1 migration | PASS — all three ancestry checks above returned zero |

The flag-off compatibility proof also passed in
`src/features/matters/MatterScopeSelector.selection.test.tsx`: flag off preserves
the landed follower-derived presentation and does not expose stale state.

The canonical flag was enabled in its own one-line commit
`abfbd090ed7468421f176fe6561fdeb3935ea76c`. Because the required final gate was
red, commit `4af5ce853c79a114966ffb651415b69207548436` removed that one line again. The
fix round did not modify that flip mechanism. It removed the newly tracked
empty `.env.production` file, so the final code tip is still OFF.

## Final T2 inventory and disposition

All listed T2 readers now consume the shared presentation value derived from
both authoritative `scope.kind` and `followerStatus`. The source helper is at
`src/platform/client-context/selectionPresentation.ts:72-98`.

| Reader | Final read / visible behavior | Focused proof | Disposition |
|---|---|---|---|
| TrustBar | `TrustBar.tsx:32`; BLOCKED `:84`; stale `:89` | `selection presentation on the named shell T2 surfaces > renders a direct BLOCKED marker...` and `> renders a direct stale marker...` | PASS at `f8ce1c82f`; delta review pending |
| StatusBar | `StatusBar.tsx:143`; BLOCKED `:347`; stale `:352` | same two exact shell-surface tests | PASS at `f8ce1c82f`; delta review pending |
| Spine | `Spine.tsx:95`; BLOCKED `:538`; stale `:542` | same two exact shell-surface tests plus existing Spine suites | PASS at `f8ce1c82f`; delta review pending |
| MatterHub badge | `MatterHub.tsx:193`; BLOCKED `:804`; stale `:809` | `selection presentation on every named T2 surface > renders a direct BLOCKED marker on MatterHub and MattersHome` and its stale counterpart | PASS at `f8ce1c82f`; delta review pending |
| MattersHome | `MattersHome.tsx:869`; BLOCKED `:1003`; stale `:1007` | same two exact feature-surface tests | PASS at `f8ce1c82f`; delta review pending |
| MatterScopeSelector | `MatterScopeSelector.tsx:127`; gate-controlled attributes `:148-157`; BLOCKED/stale below | all six tests in `MatterScopeSelector.selection.test.tsx`, including exact OFF and named BLOCKED proofs | PASS at `f8ce1c82f`; delta review pending |
| App navigation snapshot, UI memory, hub echo | reactive read `App.tsx:477`; new snapshot fields emitted only when `authorityEnabled` at `:612-617`; legacy restore at `:658-663` | `app navigation history stack > does not add authority fields to a legacy flag-off snapshot`, navigation/parity suites | PASS at `f8ce1c82f`; delta review pending |
| MCP context | canonical flag read `mcpSessionScope.ts:36`; legacy return `:61`; new fields only ON at `:63-70`; deny-all likewise gated `:80-90` | `MCP session scope file > keeps the flag-off payload byte-identical to the landed sidecar shape`; context/grant tests | PASS at `f8ce1c82f`; grants remain separate |

Confirmed T1 non-touches: selection authority, follower projection and retry,
sealed handle validation, file guards, CRM authorization, AI authorization,
privileged-mode authorization, Meetings authorization, hydration/persistence,
delete/archive validation, and the single follower writer. No Rust file changed.

## Presentation and boot matrix

| Source / boot input | Source result | Follower | Visible result | Proof |
|---|---|---|---|---|
| Valid unarchived persisted id | `matter` | id | selected matter | client-context battery |
| Persisted `null` | `all-matters` | `null` | All matters | explicit-all presentation test |
| Invalid persisted id | `blocked-unresolved` | `null` | BLOCKED, never All matters | `boot-validation-failure-renders-BLOCKED` |
| Archived persisted id | `blocked-unresolved` | `null` | BLOCKED, T1 work refused | resolution/lifecycle battery |
| Any source arm while projection disagrees | source arm unchanged | stale | visible Updating/stale marker | presentation battery |

The named boot test is now at
`src/features/matters/MatterScopeSelector.selection.test.tsx:76` and exercises the historical fail-open class through the
rendered selector, not just a store assertion.

## Explicit All matters and permanent interaction case

The path under test is:

```text
sealed explicit all-matters intent
→ requestMatterScopeSelection
→ { kind: 'all-matters' }
→ null compatibility projection
→ truthful All matters presentation
→ permitted workspace-wide adapter work
```

The permanent named test
`task-round-trip x reader-migration interaction` lives at
`src/features/crm-tasks/taskRecordStore.live.test.tsx:164`. It uses the live
Tasks adapter and proves a priority/metadata edit round-trips under explicit
all-matters and matter-scoped selection, then is refused with surfaced state
under blocked-unresolved. The 30-file battery passed this test. The final
canonical gate did not finish green, so this receipt does **not** promote the
consumer matrix to a release attestation.

The test-only `src/features/matters/index.ts` barrel has been removed. The
selector test now lives beside the feature component and imports it through
the feature-internal sanctioned path. The boundary check is green without a
baseline refresh or public export.

## Test record

### Pre-activation, flag-off parent

```text
protected A-to-B battery: 15 files passed; 214 tests passed
boot-validation-failure-renders-BLOCKED: 1 passed; 4 skipped by filter
ancestry checks: PASS
```

### Activation-under-test commit

The full focused/amended integration selection ran after the last code edit and
with the flag on:

```text
Test Files  30 passed (30)
Tests       378 passed (378)
Duration    39.34s
```

The set included authority, follower disagreement/retry/throw arms, legacy
routes, explicit-all consumer execution, resolution and lifecycle, forged
handles, writer proof coverage, App/router destinations, privilege resolution,
Meetings read/mutate/approve/artifact coverage, chat/AI, persistence, CRM,
MCP, all T2 displays, and the permanent task interaction case. No earlier-lane
result was substituted for this focused run.

### Fix-round checks at the immutable code tip

Every command in this section ran after the final code/test edit at
`f8ce1c82f3499f752684e51735ed4b78ab38bed2`.

`C1` — complete focused amended battery, with the three new direct surface
proof files included:

```text
VITE_FLAG_SELECTION_AUTHORITY_BOOT_GATE=true npx vitest run \
  src/platform/client-context/clientContextStore.test.ts \
  src/platform/client-context/selectionReader.test.ts \
  src/features/matters/MatterScopeSelector.selection.test.tsx \
  src/app/shell/layout/selectionPresentationSurfaces.test.tsx \
  src/features/matters/selectionPresentationSurfaces.test.tsx \
  tests/unit/selection-anchor.test.tsx tests/unit/matter-store.test.ts \
  tests/unit/matter-chat-scope.test.tsx \
  tests/unit/matter/matterWorkspacePersistence.test.ts \
  tests/unit/audit-provenance-events.test.tsx \
  src/features/ask/useAsk.scope.test.ts \
  tests/unit/ask/chat-path-guards.test.tsx \
  tests/unit/ask/list-files-guard.test.ts \
  tests/unit/workflow/useWorkflowRunner-save-error.test.tsx \
  src/platform/crm/useLiveCrmRecords.selection.test.tsx \
  src/features/crm-tasks/taskRecordStore.live.test.tsx \
  tests/unit/privacy/privileged-matter-mode.test.tsx \
  src/features/meetings/foundation/contract.hook-isolation.test.tsx \
  src/features/meetings/foundation/contract.live.test.tsx \
  tests/unit/mail/email-per-matter-scope.test.tsx \
  src/features/crm-ask/CrmAskProposalPanel.selection.test.tsx \
  tests/unit/InterviewForm.multiselect.test.tsx tests/unit/DocxEditor.test.tsx \
  tests/unit/appSurfaceRouter.saveDocument.test.ts \
  tests/unit/mcp-session-scope.test.ts tests/unit/appNavigationStore.test.ts \
  src/app/shell/layout/Spine.test.tsx \
  tests/unit/spine-clients-section.test.tsx \
  src/app/shell/v1-frame/AppNavigationParity.test.ts \
  tests/unit/matter/matterHub.test.tsx \
  tests/unit/matter/reimaginedMattersHome.test.tsx \
  src/app/lifecycle/useWorkspaceLifecycle.test.ts --reporter=dot

Test Files  32 passed (32)
Tests       385 passed (385)
Duration    39.76s
```

The `VITE_...=true` prefix exercises the activation-on presentation while the
two exact OFF tests explicitly override the canonical flag to false. It does
not change the repository or the production activation state.

`C2` — both TypeScript checks:

```text
npm run typecheck -- --pretty false
> tsc --noEmit --pretty false
PASS (exit 0)

npm run typecheck:tests -- --pretty false
> tsc -p tsconfig.test.json --noEmit --pretty false
PASS (exit 0)
```

`C3` — architectural boundaries:

```text
npm run boundaries:check
✅ No feature-boundary regression (599 current baseline finding(s)).

npx vitest run tests/unit/architecture-boundaries.test.ts --reporter=dot
Test Files  1 passed (1)
Tests       1 passed (1)
```

`C4` — whole-tree follower-writer proof:

```text
npm run selection:writers:test
# tests 14
# pass 14
# fail 0

npm run selection:writers:check
PASS: one follower projection writer; zero direct client writers; zero unreviewed SK_MATTERS (lantern:matters) references.
```

`C5` — patch integrity:

```text
git diff --check
PASS (exit 0; no output)
```

### Battery items 1–10: exact proof map

Every row below passed. `C1` or `C4` names the exact command above; quoted text
is the exact Vitest/Node test name, not a category label.

| Item | Exact tests in the named command | Result |
|---|---|---|
| 1. A→B blocked follower | `C1`: `useAsk.scope > refuses and surfaces a blocked source selection...`; `chat-path-guards > surfaces blocked source selection...`; `list-files-guard > refuses and surfaces forced follower disagreement before filesystem access`; `useWorkflowRunner-save-error > blocks a workflow before any disk writes...`; `useLiveCrmRecords.selection > refuses and surfaces blocked selection before any CRM mutation`; `privileged-matter-mode > fails protected when source selection is blocked`; `contract.hook-isolation > surfaces forced source/follower disagreement and refuses list, read, mutation, append, approve, and artifact reads`; `email-per-matter-scope > embedded mode surfaces blocked source selection and never reads email`; `DocxEditor > refuses and surfaces blocked-unresolved before asking AI or changing the document`; `appSurfaceRouter.saveDocument > refuses a blocked source before choosing an Ask or email artifact destination` | PASS, covering read, mutation, workflow/artifact destination, CRM relay, AI scope, privilege arming, and Meetings list/read/mutate/approve/artifact |
| 2. Forced disagreement | `C1`: exact tests ending `forced source/follower disagreement` in `useAsk.scope`, `chat-path-guards`, `list-files-guard`, workflow, CRM, Meetings, email, InterviewForm, DocxEditor, and App router; plus `selectionReader > uses follower disagreement only to refuse an agreement-check reader` and privilege `> uses follower disagreement only to strengthen protection` | PASS; every agreement-check family refuses/surfaces |
| 3. Deterministic retry | `C1`: `clientContextStore > retries one throwing follower from the source-owned projection writer` | PASS; source-owned single-flight reconciliation converges without a later selection write |
| 4. Subscriber-before-follower throw | `C1`: `clientContextStore > still schedules reconciliation when a source subscriber throws` | PASS; source remains correct and follower converges |
| 5. Throwing follower + visible stale | `C1`: the item-3 throwing-follower test; `MatterScopeSelector.selection > visibly marks stale source projection without changing the source arm`; both exact `renders a direct stale marker...` tests for shell and feature surfaces | PASS; TrustBar, StatusBar, Spine, MatterHub, MattersHome, and selector all show stale while it exists |
| 6. Legacy selection routes | `C1`: `clientContextStore > classifies every live client intent as full pair or retained-client blocked`; `> preserves the exact scope on clear...`; selector `> shows the settled all-matters presentation after sealed explicit intent`; `spine-clients-section > clicking All Clients clears the selected client...` and `> clicking a client row always launches that client...`; `matterHub > clicking a matter row opens the hub`; `AppNavigationParity > keeps the copied v1 navigation callback behavior identical to legacy`; persistence `> reclassifies the disk hint and never installs the disk follower as authority` | PASS for W1–W6, direct transitions, and lifecycle/seed-compatible routes; `C4` separately proves no added follower writer |
| 7. Capability preservation | `C1`: selector `> shows the settled all-matters presentation after sealed explicit intent`; `taskRecordStore.live > task-round-trip x reader-migration interaction`; `selectionReader > preserves named all-matters only where the operation permits it`; `matter-chat-scope > uses the explicit all-matters scope when no matter is active`; CRM `> preserves an explicit all-matters save without inventing a client relay`; App router `> saves a new Ask or email document at the workspace root only when no client is active` | PASS; sealed All reaches source, null projection, truthful UI, and real Tasks/chat/CRM/artifact consumers |
| 8. Resolution/lifecycle arms | `C1`: `clientContextStore > classifies provider-qualified liveness and every matter topology deterministically`; `> blocks failed specific-matter inputs while active...`; `> blocks immediately on link removal, archive, and delete...`; `> treats the stored follower as a hint...`; `matterWorkspacePersistence > reclassifies the disk hint...`; app navigation tests `moves Back history for a deleted client...` and `treats archived clients as dead...`; matter-store deleted/archived active-scope refusals | PASS for exactly-one, missing, ambiguous, archived, clear, boot/localStorage/disk, delete, and archive arms |
| 9. Forge negatives | `C1`: `clientContextStore > makes seals runtime-only and rejects copied or fabricated handles`; `> refuses stale matter and client classifications after live data changes`; `> returns a sealed classification for blank, missing, archived, and live matter inputs`; `> never lets a caller downgrade one canonical pair to matter-only`; `> treats the stored follower as a hint...` | PASS for valid, forged, stale, missing, archived, unauthorized/wrong-client, and persisted-hint arms; every refusal stays fail-closed |
| 10. Single follower writer | `C4`: all 14 named Node tests, including `the required tree has one follower projection writer...`, `the proof fails direct activeMatterId property assignments`, `the proof fails raw hydration and direct client writers`, bracket syntax, destructuring, identifier-bound payload, persisted-key scripts, and `the executable audit itself enforces exactly one projection writer` | PASS: 14/14 and final whole-tree scan PASS |

### Amendment-5 extension map

| Extension | Exact command/test/result |
|---|---|
| Every newly added T2 reader | `C1`: the two exact shell-surface tests, two feature-surface tests, six selector tests, MCP context tests, navigation tests — all PASS |
| Direct client transitions | `C1`: `classifies every live client intent...`, clear test, Spine All/client-row tests — PASS |
| Boot, localStorage, disk hydration | `C1`: stored-follower test, quantified restart law, malformed rehydration, and disk-hint persistence test — PASS |
| Delete/archive live validation | `C1`: `blocks immediately on link removal, archive, and delete...`, matter-store deleted/archived refusals, navigation deleted/archived tests — PASS |
| Blocked/stale T2 presentation | `C1`: direct TrustBar, StatusBar, MatterHub, MattersHome, Spine, and selector test IDs — PASS |
| App/Router artifact destinations | `C1`: blocked, disagreement, changed-selection, matter, and All destination tests in `appSurfaceRouter.saveDocument` — PASS |
| Non-reactive privilege | `C1`: `the non-reactive read agrees...`, blocked/disagreement protected tests, and both `setMatterPrivileged` arms — PASS |
| Valid/forged/stale/missing/archived/wrong-client handles | Item 9 tests in `C1` — PASS |
| Raw assignment/hydration writer proof | `C4` — 14/14 PASS plus whole-tree scan PASS |

### Canonical gate attempts

Attempt 1 was red: two T2 fixtures still described the pre-migration source,
and the native test bundle was absent. The fixtures were corrected without
weakening assertions, the ignored native bundle was supplied, commit history
was repaired so the corrections remained before activation, and all three
preconditions were rerun at the new flag-off parent.

Attempt 2 ran `npm run gate` at
`abfbd090ed7468421f176fe6561fdeb3935ea76c`. Its recorded results before the
terminal failure were:

```text
Module boundaries: PASS
Selection writer tests: PASS (14/14)
TypeScript production and test typechecks: PASS
Frontend unit suite: 1,143 files passed, 3 skipped;
                     9,099 tests passed, 29 skipped
ESLint gate: PASS (63 pre-existing cleaned findings)
Handle guard: PASS (509 new handles; none removed or ambiguous)
Main Rust library: 1,524 passed, 0 failed, 23 ignored
MCP Rust unit tests: 51 passed
Golden-loop cargo build: PASS
Golden-loop launcher: RED
```

Terminal output:

```text
Finished `dev` profile [unoptimized + debuginfo] target(s) in 1m 04s
golden-loop launcher: cannot record provenance; binary is missing or not executable: target/debug/lantern
FAILED: bash -c cd src-tauri && cargo build --locked && ../scripts/golden-loop-launch-app.sh --record-provenance .. target/debug/lantern && ../scripts/golden-loop.sh .. target/debug/lantern
GATE RED
```

Inspection found the executable at
`/mnt/devcache/cargo-target/debug/lantern`, while the fixed gate command looked
for `src-tauri/target/debug/lantern`. This is consistent with the shared Cargo
target setting. No third attempt was made because the brief caps attempts at
two.

### Coordinator-granted lint-cure rerun

The new brief granted exactly one additional full activated gate attempt. The
lane first replaced every lane-owned no-`await` async test double with an
explicit promise-returning function. It used no ESLint suppression, baseline
change, deleted behavior, weakened assertion, or skipped test. The cure was
committed separately at `f4e58a9d8`, then the one-line production activation
was reapplied at `5dd4f06e5`.

The single permitted rerun used the corrected worktree-local Rust build folder:

```text
CARGO_TARGET_DIR=<worktree>/src-tauri/target npm run gate
```

Results at immutable activated SHA `5dd4f06e567465dc7110e873cdbcc82b7c78c44e`:

```text
Module boundaries: PASS (599 existing baseline findings; zero regression)
Active CRM/client boundary: PASS
Selection writer proof: PASS (14/14 plus whole-tree scan)
Union registry and feature-flag cap: PASS
Tauri version and TS/Rust command contracts: PASS
TypeScript production and test typechecks: PASS
Brand, identity, i18n completeness, and intake build: PASS
Frontend unit suite: 1,145 files passed, 3 skipped;
                     9,108 tests passed, 27 skipped
ESLint gate: PASS — no regression; 63 baseline fingerprints cleaned
Permanent-handle and design-token guards: PASS
Rust workspace: PASS — core, integration, DOCX, vault, and doc tests
Golden-loop binary provenance: source_sha=5dd4f06e567465dc7110e873cdbcc82b7c78c44e
Golden loop: PASS write; PASS persistence after restart
✅ GATE GREEN
```

The final desktop proof created
`golden-loop-1784398350-586619.docx`, displayed it, restarted the app, and
confirmed the same document remained visible. This closes the prior build-path
failure without substituting an ad-hoc command for the canonical gate.

## Writer proof and fence

The canonical gate's whole-tree selection writer checks passed before its
final failure, and fix-round command `C4` freshly repeated them at `f8ce1c82f`:
14/14 proof tests and the committed scan passed. The scan covers
`setActiveMatter`, raw `activeMatterId` object/assignment forms, hydration and
persistence patterns, and direct state writes; its only allowed production
writer remains the named reconciliation projection. No guard, timeout, type,
snapshot, assertion, baseline, or skip was weakened to obtain these results.

The fix diff removes the test-only Matters public entry, gates new OFF-path
selector, navigation-memory, live MCP, and deny-all MCP output behind the
existing canonical flag, and adds direct test assertions. It contains no Rust,
guard, authority-door, T1, writer, follower, retry, Meetings-surface, or
activation-flip change. No baseline, boundary rule, assertion, timeout, skip,
or guard was weakened.

## Review and final status

The earlier Opus SECURITY-PASS remains banked at `a51899f65` per the fix-round
brief. This receipt does not claim that it reviewed the delta. The coordinator
will run the required Opus delta verification over `a51899f65..f8ce1c82f`.

Final status after the coordinator-granted rerun: **CHANGES-3 CURED,
ACTIVATION ON, COMPLETE GATE GREEN, DELTA REVIEW PENDING.** The public barrel is
gone; OFF-path outputs remain gated and directly proven; every battery item and
extension is mapped above. The two earlier capped attempts remain honestly
recorded as historical red results. The one newly granted attempt passed and
is the governing final result.
