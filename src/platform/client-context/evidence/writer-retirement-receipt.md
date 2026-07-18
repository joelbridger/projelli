# Selection writer retirement receipt

## Identity and scope

- Branch: `feat/unification-sublane2-writer-retirement`
- Required base, verified before work: `dcb49570f9244fe81f683963050b6a7016d505cd`
- Tested implementation SHA: `524d9c285cc28a64acf44164a7eee76ae52abe85`
- Sub-lane 1 was already landed in that base.
- Rust touched: no.
- Activation: `selection-authority-boot-gate` remains default OFF. Sub-lane 4 still owns activation.
- Merge/push: neither performed.

This receipt applies the packet through Amendments 6 and 7 and the folded
Reassessment Addendum. Persisted values and the legacy follower are hints only.
Every restart re-enters a total classifier. Runtime authority is not persisted.

## Complete writer disposition

The arm columns say which outcomes the row can legally produce after current
data is classified. `FP` = full pair, `MO` = matter-only, `ALL` = explicit
all-matters, and `BLK` = blocked-unresolved.

| ID | Base writer | Final route / classification | FP | MO | ALL | BLK | Focused proof | Result |
|---|---|---|:---:|:---:|:---:|:---:|---|---|
| W1 | `Spine.tsx:583` raw null | `Spine.tsx:583-587`, `issueAllMattersScopeSelection` → `requestMatterScopeSelection` | — | — | yes | — | `spine-clients-section`: clicking All Clients | retired |
| W2 | `MattersHome.tsx:883` raw id | `MattersHome.tsx:885-886`, total matter issuer → request | yes | yes | — | yes | `clientmap-hub-nav`: clicking a client row; classifier suite | retired |
| W3 | `MatterScopeSelector.tsx:184` raw id | `MatterScopeSelector.tsx:188`, total matter issuer → request | yes | yes | — | yes | classifier suite: unlinked, ambiguous, invalid, archived | retired |
| W4 | `MatterScopeSelector.tsx:207` raw null | `MatterScopeSelector.tsx:215`, sealed All intent → request | — | — | yes | — | classifier dark/outcome suite | retired |
| W5 | `ClientsSurface.tsx:249` raw nullable id | `ClientsSurface.tsx:252-254`; safe matter uses total matter issuer, null uses All issuer | yes | yes | yes | yes | `ClientsSurface.scopeUpdate`: record and All selections | retired |
| W6 | `App.tsx:645` snapshot follower | `App.tsx:650-652`; snapshot id/null is reclassified through matter/All issuers | yes | yes | yes | yes | classifier legacy-hint test; navigation focused suite | retired |
| W7 | one scope door | `requestMatterScopeSelection` consumes runtime-only seals and re-runs the current classifier | yes | yes | yes | yes | forged/stale/full-pair/matter-only/all/blocked classifier tests | single door |
| A2-1 | `legacyNavigationTargetDescriptors.ts:11` raw id | line 15, total matter issuer → request; source snapshot captured first | yes | yes | — | yes | navigation registry plus snapshot-order focused proof | retired |
| A2-2 | `matterDocumentNavigation.ts:23` raw id | lines 26-31, snapshot first, total matter issuer → request | yes | yes | — | yes | workflow artifact route asserts snapshot before follower | retired |
| A2-3 | `App.tsx:1969` post-onboarding sample raw id | `App.tsx:1983-1984`, user-reachable sealed matter request after seed | — | yes | — | yes | sample seed + classifier suite | retired |
| A2-4 | `sampleClientMap.ts:205` raw id | lines 209, user-reachable sealed matter request; sample has no canonical client link so MO | — | yes | — | yes | `sample-client-map`: stores and focuses sample | retired |
| A2-5 | `seedWebDemoClientMap.ts:155` raw id | lines 159-160, user-reachable sealed matter request; demo has no canonical client link so MO | — | yes | — | yes | web-demo seed create/idempotence tests | retired |
| I1 | workspace/localStorage follower hydration | `selectionHint` or legacy follower enters `issueRehydratedSelection`; disk/localStorage never installs authority | yes | yes | yes | yes | localStorage and workspace-disk reclassification tests | retired as authority |
| I2 | delete selected matter | source subscription reclassifies immediately; dark branch alone keeps byte-identical legacy update | — | — | yes | yes | link/remove/archive/delete fail-closed test | retired when enabled |
| I3 | archive selected matter | same total live reclassification; source blocks before follower convergence | — | — | yes | yes | link/remove/archive/delete fail-closed test | retired when enabled |
| I4 | persisted follower/serialization | versioned source/id/client hint only; queued disk writes capture the hint at schedule time | yes | yes | yes | yes | restart property + disk queue-race test | retired as authority |
| C1 | `ClientBarV1` direct set/clear | sealed shared-client issuer/request; clear uses source-owned clear and preserves scope | yes | — | preserved | yes | ClientBar select/clear plus scope-preserving clear test | retired |
| C2 | `SharedClientBar` direct clear | `requestClearClientSelection`; current scope preserved | preserved | preserved | preserved | preserved | SharedClientBar clear test + clear law | retired |
| C3 | CRM adapter direct set | provider-qualified identity → total shared-client issuer/request | yes | — | — | yes | shared adapter propagation + client classifier | retired |
| C4 | Meetings adapter direct clear | `requestClearClientSelection`; no Meetings surface change | preserved | preserved | preserved | preserved | shared adapter propagation + clear law | retired |

The mandatory base re-grep found eleven external production
`setActiveMatter(...)` calls, the one foundation projection call, and four
external client set/clear calls. Those are exactly the W/A2/C rows above. No
additional production selection writer was found.

## Base and final inventories

Base commands:

```text
git grep -n -E 'setActiveMatter\(' dcb49570f9244fe81f683963050b6a7016d505cd -- src
git grep -n -E '(setClient|clearClient)\(' dcb49570f9244fe81f683963050b6a7016d505cd -- src
git grep -n -E 'activeMatterId[[:space:]]*:' dcb49570f9244fe81f683963050b6a7016d505cd -- src
git grep -n 'useMatterStore.setState' dcb49570f9244fe81f683963050b6a7016d505cd -- src
```

The production-call subset was:

```text
App.tsx:645,1969
app/commands/registry/legacyNavigationTargetDescriptors.ts:11
app/shell/layout/Spine.tsx:583
app/shell/matterDocumentNavigation.ts:23
features/crm-clients/ClientsSurface.tsx:249
features/matters/MatterScopeSelector.tsx:184,207
features/matters/MattersHome.tsx:883
platform/matter/samples/sampleClientMap.ts:205
web-demo/seedWebDemoClientMap.ts:155
features/client-bar/ClientBarV1.tsx:82,86
features/crm-clients/sharedClientContext.ts:18
features/meetings/sharedClientContext.ts:17
```

Final production call search:

```text
$ rg -n 'setActiveMatter\(|setClient\(|clearClient\(' src --glob '!**/*.test.*' --glob '!**/*.spec.*'
src/platform/matter/matterStore.ts:1950:          // historical comment only
src/platform/client-context/clientContextStore.ts:779:  useMatterStore.getState().setActiveMatter(projection);
```

The AST proof deliberately distinguishes declarations, serialization, T2
context copies, the Meetings-private cursor, dark-only compatibility writes,
and the one projection from selection writers. It also rejects direct calls,
destructured/local writer bindings, bracket syntax, raw client-context state,
direct active-matter object literals, and identifier-bound raw state payloads.

Exact final proof:

```text
$ npm run selection:writers:check
Allowed selection-writer inventory:
ALLOW src/features/meetings/meetingStore.ts:973 Meetings-private record cursor, not matter follower
ALLOW src/features/meetings/meetingStore.ts:1104 Meetings-private record cursor, not matter follower
ALLOW src/features/meetings/meetingStore.ts:1127 Meetings-private record cursor, not matter follower
ALLOW src/features/meetings/meetingStore.ts:1157 Meetings-private record cursor, not matter follower
ALLOW src/platform/client-context/clientContextStore.ts:779 single source-owned follower projection
ALLOW src/platform/matter/matterStore.ts:1208 dark-only disk hydration follower compatibility
ALLOW src/platform/matter/matterStore.ts:1539 deleteMatter dark-only compatibility branch
ALLOW src/platform/matter/matterStore.ts:1921 setMatterArchived dark-only compatibility branch
ALLOW src/platform/matter/matterStore.ts:1956 legacy follower setter reached only by projection writer
PASS: one follower projection writer; zero direct client writers.
```

## Round-trip and lifecycle battery

| Requirement | Exact proof | Final result at `524d9c285` |
|---|---|---|
| Battery 6, real writer routes | 14-file focused Vitest command below | 14 files, 136 tests passed |
| Battery 10, single writer | `npm run selection:writers:test` | 7/7 passed, including negative bypass fixtures |
| Total classifier + handle negatives | `clientContextStore.test.ts` | valid/blank/missing/archived, forged, stale, wrong pair passed |
| FP/MO/ALL/BLK × restart | quantified fast-check property in `clientContextStore.test.ts` | passed |
| Authority never persisted | localStorage test + workspace-disk test | passed |
| Clear | exact-scope clear and cleared-pair→matter-only restart test | passed |
| Delete/archive/link change | immediate source block, no rollback test | passed |
| Provider unavailable | restart becomes blocked; later publication does not auto-upgrade | passed |
| Seeds | sample and web-demo sealed request tests | 6/6 passed |
| Navigation history | workflow artifact invocation-order assertion | passed |

The provider-unavailable behavior is intentional. The Reassessment Addendum
states that unavailable liveness required by a shared-client/full-pair source
classifies blocked, and that blocked cannot auto-upgrade (packet lines 571-575).
The final reviewer suggested deferral; implementing that suggestion would
contradict the governing frame, so it was dispositioned by design rather than
changed.

## Public surface and bridge

`selectionTypes.ts` adds only the four-arm runtime union, provider-qualified
identity, versioned persistence hints, and the typed rehydration input.
`selectionWriterBridge.ts` is the narrow cycle-breaking bridge that lets the
matter persistence owner pass data into the source classifier and read a hint
back. It exposes no raw arm writer and is inert while the flag is OFF. The
index exports only runtime-sealed issuers/requests, the total household
classifier/directory publication needed by writer routes, typed inputs/results,
and that narrow persistence entry. No raw-id authority door, raw union writer,
public `setState`, or bypass helper was added.

## Verification and review history

Canonical gate attempt 1 reached the frontend suite and failed 15 test files
whose mocks/async assertions still assumed the old writers. Those exact files
were fixed and rerun: 15 files, 72 tests passed.

Canonical gate attempt 2 passed every pre-unit stage and the full frontend
suite:

```text
Test Files 1132 passed | 3 skipped (1135)
Tests      9002 passed | 29 skipped (9031)
```

The overall gate remained RED. It then reported 16 new lint findings, all
fixed; the scoped lint gate is now green. The Rust/golden stage could not start
because this clean worktree lacks
`src-tauri/binaries/piper-x86_64-unknown-linux-gnu`. No stub was made, and the
full gate was not run a third time because the packet caps attempts at two.

Final-SHA scoped evidence:

```text
npm run selection:writers:test
# tests 7; pass 7; fail 0

npx vitest run <14 writer/lifecycle files> --reporter=verbose
Test Files 14 passed (14)
Tests 136 passed (136)

npx tsc --noEmit
# exit 0
npm run typecheck:tests
# exit 0
npm run lint:gate
# exit 0; no baseline update
node scripts/ui-system/handle-guard.mjs
# PASS; no permanent handle vanished; no new ambiguous handles
npx vitest run tests/unit/architecture-boundaries.test.ts
# 1 file, 1 test passed
git diff --check
# exit 0
```

Two independent Sol review attempts were used, matching the attempt cap.
Round 1 found five real issues: fingerprint over-invalidation, a queued disk
hint race, proof not in the canonical gate, destructured-writer bypasses, and
missing exact projection-count enforcement. All were fixed. Its unavailable
provider suggestion was rejected by the packet rule above. Round 2 found the
navigation snapshot ordering defect and indirect/bracket audit bypasses; both
were fixed and directly retested. Its repeated provider-startup suggestion was
again rejected by the same binding rule. No third review was run.

No test, guard, assertion, type, timeout, snapshot, lint baseline, or
architecture boundary was weakened to manufacture a pass. Existing-arm dark
outcomes remain byte-identical. The only post-review changes preserve the
source snapshot before selection and strengthen the blocking proof.
