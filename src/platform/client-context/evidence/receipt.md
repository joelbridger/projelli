# Selection-authority foundation receipt

- Base SHA: `0683ff9b6987334e2191a6e8ed302491be55fbf7`
- Frozen restoration source: `207ec6367`
- Final SHA: `PENDING-FINAL-COMMIT`

## What this foundation owns

`clientContextStore` is now the sole source for the client plus a three-state
scope: a named matter, explicit all-matters intent, or blocked/unresolved. The
legacy `activeMatterId` is only a projection: matter scopes project to their id;
all-matters and blocked scopes project to `null`. `followerStatus` reports only
whether that projection currently agrees.

The only public scope request is `requestMatterScopeSelection(SealedMatterScopeSelection)`.
Its WeakMap provenance and frozen handle make a cast, raw id, raw union, or
caller-created object refuse. Its issuer helpers are deliberately absent from
the package index. The existing `setClient` remains a temporary compatibility
entry for the later writer-retirement lane; because it has no proven pair it
sets the source scope to blocked rather than authorizing a raw selection.

## SALVAGE DELTA LIST

Frozen inventory inspected: `clientContextStore.ts`, `clientContextStore.test.ts`,
`index.ts`, and `src/features/crm-clients/clientBoundary.ts` at `207ec6367`.

| Frozen material | Result at this SHA | Delta and reason | Fresh proof |
| --- | --- | --- | --- |
| `SharedClientIdentity`, `SharedClientContextAdapter`, and `readSharedClientContext` | Byte-identical behavior retained in `clientContextStore.ts` | None; existing current-tip owner already carried these groups. | `keeps a narrow client adapter on the source client identity` |
| `SealedClientBoundary`, private `WeakMap`, and async `requestSharedClientSelection` doorway | Adapted in `clientContextStore.ts` | Replaced frozen two-store ordering/rollback with one source slice and follower projection; forged and invalid boundaries now block the source rather than restoring stores. | `selects a current full client/matter pair…`; `refuses a forged client boundary…` |
| Frozen `sealResolvedClientBoundary` issuer | Adapted in the owned package | Issuance now validates exactly one live unarchived canonical pair and captures a source revision. | specific-pair, stale, resolver, and revalidation tests |
| Frozen `resolveHouseholdMatterId` rule in feature `clientBoundary.ts` | Reimplemented as `resolveCanonicalHouseholdMatter` in this platform package | Feature helper counts archived matches and is feature-owned; the legal authority rule must accept exactly one **unarchived** `Matter.crmHouseholdKeys` match. The feature file was not edited. | `resolves exactly one unarchived canonical household match` |
| Frozen store state and tests | Adapted, not byte-identical | Added tri-state source, sealed scope requests, boot gate, projection-only status, and finally-owned single-flight retry. Required by R3 amendments 3 and 4. | all 16 focused tests |
| Frozen public index | Adapted | Exports narrow readers and request types/doors; no issuer or raw scope writer is exported. | `has no raw-id or raw-union request boundary…` plus TypeScript test gate |

No unrelated frozen path was imported. There are no other byte-identical restored
groups in the changed files; every adaptation above has fresh current-SHA test
coverage and is to be inspected by the independent Sol review.

## Resolver decision

The authority doorway is
`src/platform/client-context/clientContextStore.ts:resolveCanonicalHouseholdMatter`.
It uses the canonical current relationship, `Matter.crmHouseholdKeys`, filters
archived matters, and returns only one match. The feature export
`resolveHouseholdMatterId` is not used because it is feature-owned and its
current implementation counts archived entries before applying its exactly-one
rule. Missing, ambiguous, archived-only, altered, or stale pairs become
`blocked-unresolved` through the sealed request door.

## Zustand evidence

Installed Zustand is `5.0.12` (`node_modules/zustand/package.json`). In
`node_modules/zustand/vanilla.js`, lines 6–11 compute the next state, assign it
to `state` on line 10, then synchronously call listeners on line 11. The source
transition therefore catches only a subscriber failure after the source has
swapped, and its `finally` unconditionally schedules reconciliation. Focused
test `schedules reconciliation in finally when a source subscriber throws
before follower work` subscribes a throwing source listener, proves the scope
has still changed, and waits for the legacy follower to converge without a
second selection write.

## Required battery and focused cases

| Requirement | Exact focused test | Result |
| --- | --- | --- |
| 3 deterministic retry | `retries a follower failure without another selection write` | PASS |
| 4 source subscriber throws first | `schedules reconciliation in finally when a source subscriber throws before follower work` | PASS |
| 5 throwing follower / stale observable | `keeps stale observable when the follower throws and then converges by retry` | PASS |
| 7 explicit all-matters | `preserves explicit all-matters capability with a separate sealed user-intent handle` | PASS |
| 8 resolver arms, no prior matter, clear | resolver, `never carries…`, and `preserves…when clearing client` | PASS |
| 9 forged/stale/missing/archived/unauthorized/wrong-client | forged, stale, and revalidation tests | PASS |
| valid pair / immutable provenance / raw boundary | specific-pair, immutable-forgery, and raw-boundary tests | PASS |
| boot valid / null / invalid / archived | `boot gate validates persisted follower before the authority reader can be used` | PASS |

## Commands and review status

Fresh commands will be re-run after the final documentation edit and final
commit: focused Vitest suite, `npm run typecheck:tests`, full `npm run gate`,
handle guard, and architecture-boundaries test. Rust source touched: no.

Self-review round 1: pending final commit.  
Self-review round 2: pending final commit.  
Independent Sol review of every delta-list line: pending final commit.

The new sealed request operations intentionally have zero external callers in
this foundation lane. External writer retirement, lifecycle migration, T1
readers, and T2 presentation remain outside this lane.
