# Selection-authority foundation receipt

- Base SHA: `0683ff9b6987334e2191a6e8ed302491be55fbf7`
- Frozen restoration source: `207ec6367`
- Final foundation code SHA: `c35c7a031cfa74c93722eed7f8bae77fd0c66013`
- Evidence commits follow this code commit only.

## What this foundation owns

`clientContextStore` owns a client plus a three-state scope: a named matter,
explicit all-matters, or blocked/unresolved. `activeMatterId` is only its
legacy projection. Scope changes use one source `set()` transition; its
`finally` schedules one bounded reconciliation even when a source subscriber
throws. The sealed scope request door accepts only private-WeakMap provenance.

This is an inert foundation. `selection-authority-boot-gate` ships off. While
it is off, boot does not read or write the follower, legacy select/clear use
the same client-only transition as `0683ff9b6`, and rejected sealed requests
return a refusal without a blocked store transition. When the later integration
lane enables the flag, the first authority read (and each enabled issuer or
legacy source entry) validates the persisted follower before exposing or using
the scope. A source-owned real matter-store subscription immediately blocks a
selected scope when that matter is archived or deleted, including after
follower convergence.

## SALVAGE DELTA LIST

Compared with frozen `207ec6367`, the three restored files contain 1,163 added
and 297 removed lines at this code SHA. The following is the complete semantic
line-group inventory; it deliberately does not collapse the store and test
rewrites into one vague row. Ranges are frozen → current.

| File and line group | Why it differs | Fresh coverage |
| --- | --- | --- |
| `clientContextStore.ts` imports; 1–12 → 1–12 | Adds flag, matter, tri-state dependencies. | whole focused suite |
| store 13–74 → 14–100 | Moves identity definitions ahead of seals; adds opaque scope handle, provenance records, and result/refusal unions. | compile/raw-boundary, provenance, forged-request tests |
| store 90–119 → 101–176 | Expands state to source scope/status/revision and separates legacy mutable normalization from immutable authority normalization/projection. | adapter, flag-off parity, immutable-provenance tests |
| store 116–130 → 177–228 | Replaces feature-owned lookup with exact-one live canonical resolver and pair validation. | resolver and missing/archived/unauthorized/wrong-client tests |
| store 35–62 → 230–282 | Replaces permissive frozen issuer with live, canonical, revision-sealed client and scope issuers plus all-matters intent. | specific-pair, stale-boundary, all-matters tests |
| store 131–143 → 283–372 | Replaces two-store rollback state with flag boundary, projection status, bounded single-flight retry, and persisted-follower decoding. | retry, throwing-subscriber, permanent-failure tests |
| store 177–189 → 374–433 | Replaces client-only Zustand store with one source slice write and dark-compatible legacy transitions. | single-set subscriber test; R1 before/after observation |
| store — → 435–465 | Adds mandatory enabled-reader boot validation and source-owned live archive/delete invalidation. | real authority-read boot arms; post-convergence archive/delete test |
| store 153–196 → 467–571 | Replaces rollback selection request with flag-gated sealed-source requests, revalidation, refusal, and source projection. | seal/forgery/stale/revalidation/dark-refusal tests |
| store — → 580–598 | Adds authority reader and hides raw Zustand `setState` behind a narrow facade. | adapter/public-facade test; architecture/handle guard |
| `clientContextStore.test.ts` 1–40 → 1–134 | Adds authority imports, fixtures, flag lifecycle, and the executable pre-foundation comparison factory. | all focused tests; R1 test |
| tests 43–59 → 135–251 | Retains adapter coverage and adds true before/after dark observations: boot no-op, normalized selection, blank-id error, clear, subscriber transitions, and follower values. | R1 observational test |
| tests 60–125 → 252–328 | Replaces old two-store request expectations with dark-refusal, resolver, sealed client/scope, forgery, and all-matters battery cases. | named tests in this range |
| tests 125–163 → 329–525 | Replaces rollback and ordering cases with scope freshness, exact-pair revalidation, prior-scope, clear, and opaque-boundary battery cases. | stale, revalidation, clear, compile/runtime forge tests |
| tests 163–239 → 526–668 | Adds real-reader boot arms and deterministic retry, source-subscriber, follower-failure, and post-convergence archive/delete proofs. | named boot/retry/live-invalidation tests |
| tests — → 670–703 | Adds bounded permanent-retry and forged-client boundary coverage. | permanent-retry and forged-client tests |
| `index.ts` 1–10 → 1–17 | Exports only narrow authority readers/types/doors, not issuers or raw writers. | compile boundary test and public-facade assertion |

### Byte-identical retained groups

These are the complete unchanged code groups within the salvaged source. Both
were byte-compared, including their comments:

| Frozen range | Current range | SHA-256 |
| --- | --- | --- |
| store 75–88 (`SharedClientIdentity`, `SharedClientContextAdapter`) | store 14–27 | `db335831cf7ed9bc06810c7d7efa1e45ebd64188c7e4b6a0f33c5ef61f79296d` |
| store 198–203 (`readSharedClientContext`) | store 573–578 | `b50aabe232bc942454277abb3a9ea8f9ceb97e0fff0b39a35badbb7bbffff65d` |

No test block and no `index.ts` line group is byte-identical: each was adapted
to the new authority contract or its narrow public surface. No other frozen
source group is claimed unchanged.

## Required battery and focused cases

| Requirement | Real proof | Result |
| --- | --- | --- |
| 3–5 retry/follower failures | retry, throwing-source-subscriber, throwing-follower, bounded-retry tests use the real stores | PASS |
| 7 all-matters | separate sealed all-matters intent selects and projects `null` | PASS |
| 8 resolution/boot/live invalidation | exact-one resolver; real authority read validates valid/null/missing/archived persistence; real `setMatterArchived` and `deleteMatter` after convergence block immediately | PASS |
| 9 sealed-request validation | compile and runtime forged/raw/stale/missing/archived/unauthorized/wrong-client cases | PASS |
| R1 flag-off observational proof | executable `0683ff9b6` client store runs beside current dark store; full legacy client transitions, blank-id errors, subscriber values, boot no-op, and follower values are compared | PASS |
| flag-off refusal | forged and invalid sealed requests refuse without source mutation | PASS |

## Zustand evidence and install state

The lockfile records Zustand `5.0.12`, but the actual installed package is
`5.0.14` (`node_modules/zustand/package.json`; `npm ls zustand --depth=0`).
`npm ci` was attempted and correctly refused because the lockfile lacks the
declared `eslint-plugin-lantern-test-hygiene@0.1.0`; this lane did not conceal
that repository-level lock mismatch by rewriting the lockfile. The subscriber
proof was therefore re-run against installed `5.0.14`: `vanilla.js` lines 6–11
compute next state, assign it at line 10, then synchronously notify listeners
at line 11. The focused throwing-source-subscriber test proves that the source
is swapped and the `finally` reconciliation still converges.

## Verification and handoff

- Focused authority suite: 21/21 passed after `c35c7a031`.
- `npm run typecheck:tests` and `npm run typecheck`: passed after `c35c7a031`.
- `npm run lint:gate`: passed with zero new findings in this worktree; the
  retained 359-finding red log came from an unsanitized/mismatched environment,
  not a code baseline update. `--update-baseline` was not used.
- Zero external callers of the new authority doors remain; no consumer, writer,
  Meetings, or guard file was changed.

The full fresh machine receipt is deliberately coordinator-run at the next
honest window. It was not run by this evidence-fix round.
