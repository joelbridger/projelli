# Selection-authority foundation receipt

- Base SHA: `0683ff9b6987334e2191a6e8ed302491be55fbf7`
- Frozen restoration source: `207ec6367`
- Final foundation code SHA: `ef9b7d878c3285ec7339f519ec8da5ca8487d8e6`
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

Compared with frozen `207ec6367`, the three restored files contain 1,187 added
and 297 removed lines at this code SHA. The following is an exhaustive,
non-overlapping source partition: every frozen line is either in one changed
row or in the byte-identical table below, and every current line is assigned
once. Ranges are frozen → current; `—` means a new current-only group.

| File and line group | Why it differs | Fresh coverage |
| --- | --- | --- |
| `clientContextStore.ts` 1–4 → 1–13 | Adds the flag and matter dependencies plus tri-state selection types. | whole focused suite |
| store 5–74 → 28–100 | Replaces the old boundary-only declaration block with opaque scope-handle provenance and refusal/result types. | compile/raw-boundary, provenance, forged-request tests |
| store 89–115 → 101–176 | Expands state into the source slice and keeps the legacy normalizer separate from immutable authority identity. | adapter, R1 parity, immutable-provenance tests |
| store 116–130 → 177–210 | Replaces the old store preface with the exact-one live resolver and pair validation. | resolver and missing/archived/unauthorized/wrong-client tests |
| store 131–152 → 211–242 | Replaces the old public request preface with the private full-pair issuer. | sealed client-boundary tests |
| store 153–166 → 243–271 | Adds the private sealed matter-scope issuer. | specific-pair, stale-request tests |
| store 167–170 → 272–294 | Adds the separate all-matters intent issuer and source/retry state. | all-matters and retry tests |
| store 171–185 → 295–372 | Replaces rollback ordering with the dark gate, source-owned retry, and persisted-follower decoding. | retry, throwing-subscriber, permanent-failure tests |
| store 186–197 → 373–581 | Replaces the old client-only store and two-store request with the single source transition, dark compatibility, boot validation, real live invalidation, and sealed request doors. | single-set, R1, boot, archive/delete, seal/forgery/stale/revalidation/dark-refusal tests |
| store — → 588–607 | Adds the narrow authority reader and public facade that omits raw `setState`. | adapter/public-facade test; architecture/handle guard |
| `clientContextStore.test.ts` 1–42 → 1–137 | Replaces old fixtures with authority fixtures, lifecycle controls, and the executable exact pre-foundation store. | whole focused suite |
| tests 43–59 → 138–265 | Replaces basic client tests with the full dark-path before/after proof and dark refusal cases. | R1 observational test; dark-refusal test |
| tests 60–124 → 266–330 | Adds resolver, sealed-client, and sealed-scope request coverage. | resolver, specific-pair, provenance tests |
| tests 125–163 → 331–495 | Replaces rollback/order cases with forge, all-matters, stale, and revalidation batteries. | stale, revalidation, all-matters, compile/runtime forge tests |
| tests 164–239 → 496–684 | Adds clear, real-reader boot, source-subscriber, follower-failure, and post-convergence archive/delete proofs. | clear, boot/retry/live-invalidation tests |
| tests — → 685–718 | Adds bounded permanent-retry and forged-client-boundary coverage. | permanent-retry and forged-client tests |
| `index.ts` 1–10 → 1–17 | Exports only narrow authority readers/types/doors, not issuers or raw writers. | compile boundary and public-facade assertion |

### Byte-identical retained groups

These are the complete unchanged code groups within the salvaged source. Both
were byte-compared, including their comments:

| Frozen range | Current range | SHA-256 |
| --- | --- | --- |
| store 75–88 (`SharedClientIdentity`, `SharedClientContextAdapter`) | store 14–27 | `db335831cf7ed9bc06810c7d7efa1e45ebd64188c7e4b6a0f33c5ef61f79296d` |
| store 198–203 (`readSharedClientContext`) | store 582–587 | `b50aabe232bc942454277abb3a9ea8f9ceb97e0fff0b39a35badbb7bbffff65d` |

No test block and no `index.ts` line group is byte-identical: each was adapted
to the new authority contract or its narrow public surface. No other frozen
source group is claimed unchanged. The changed partitions above deliberately
exclude both byte-identical store groups, so no changed row overlaps them.

## Required battery and focused cases

| Requirement | Real proof | Result |
| --- | --- | --- |
| 3–5 retry/follower failures | retry, throwing-source-subscriber, throwing-follower, bounded-retry tests use the real stores | PASS |
| 7 all-matters | separate sealed all-matters intent selects and projects `null` | PASS |
| 8 resolution/boot/live invalidation | exact-one resolver; real authority read validates valid/null/missing/archived persistence; real `setMatterArchived` and `deleteMatter` after convergence block immediately | PASS |
| 9 sealed-request validation | compile and runtime forged/raw/stale/missing/archived/unauthorized/wrong-client cases | PASS |
| R1 flag-off observational proof | executable `0683ff9b6` client store runs beside current dark store; the same deliberately messy input exercises household trimming, empty display-name fallback, and people trimming/filtering; complete legacy subscriber values, errors, and final client state are compared | PASS |
| flag-off refusal | forged and invalid sealed requests refuse without source mutation | PASS |

## Zustand and locked install state

The lockfile now includes the missing local
`eslint-plugin-lantern-test-hygiene@0.1.0` workspace package, so `npm ci` is
reproducible. The clean install has Zustand `5.0.12` and
`eslint-plugin-react-hooks` `7.0.1`, matching the lockfile. Zustand's
`vanilla.js` computes the next state, assigns it, and then synchronously
notifies listeners; the focused throwing-source-subscriber test proves the
source stays swapped and the `finally` reconciliation still converges.

## Verification and handoff

- The prior focused-suite and gate PASS claims applied only to `ef9b7d878` and
  are not carried forward as evidence for this final fix-3 tip. The coordinator
  must create the fresh machine receipt at that tip.
- No lint baseline was updated.
- The coordinator-run receipt at `310082ab2a04` is retained as the honest RED
  record of the pre-fix state. A fresh final receipt remains coordinator-run
  and drain-queued; this human evidence does not substitute for it.
- Zero external callers of the new authority doors remain; no consumer, writer,
  Meetings, or guard file was changed.

The full fresh machine receipt is deliberately coordinator-run at the next
honest window. It was not run by this evidence-fix round.
