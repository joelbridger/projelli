# Unification sub-lane 1 — authority foundation

- Branch: `feat/unification-sublane1-authority-foundation`
- Base SHA: `0683ff9b6987334e2191a6e8ed302491be55fbf7`
- Frozen source: `207ec6367`
- Foundation code SHA: `8e06520466b5c5cb8887096edec839d19964786f`
- Receipt: `src/platform/client-context/evidence/receipt.md`
- Rust touched: no

## Delivered

The platform client-context package now owns a fail-closed selection source,
but it lands inert behind the dark `selection-authority-boot-gate` flag.
It records one matter, explicitly all matters, or blocked/unresolved; projects
that state into the legacy follower; and retries follower reconciliation from a
`finally` block when the integration gate enables it. It also adds sealed full-pair matter requests, explicit sealed
all-matters intent, an exact-one-unarchived resolver, and a persisted-follower
boot gate. With the flag off, boot does not validate or write the follower,
legacy client select/clear has the same observable transition as before this
foundation, and forged sealed requests refuse without changing the store. No
external writer or consumer was migrated in this sub-lane. Only sub-lane 4 may
activate the flag after its recorded integration preconditions pass.

## Manifest

| Deliverable | Status |
| --- | --- |
| `clientContextStore.ts` | tri-state source, sealed provenance, resolver, boot gate, projection/retry; all blocked-entry paths behind the one dark flag |
| `index.ts` | narrow read/request surface; no issuer or raw scope writer |
| `clientContextStore.test.ts` | focused tests force the flag on for authority coverage and prove flag-off legacy parity plus no-op forged refusal |
| `evidence/receipt.md` | salvage delta list, Zustand evidence, battery map |
| this report | final lane handoff |

## Final verification and review

The first independent Sol review found four real issues: a public raw store
writer, mutable exposed scope values, stale shared-client boundaries, and an
endless retry risk. All four have been fixed and tested. A final independent
review and the final fresh checks are still pending this receipt/report commit.

## Builder attestation

Pending final fresh checks. At finalization I will attest only to checks
actually re-run after the last edit, scope limited to the granted roots,
unchanged guard integrity, and public contracts that expose no raw
scope-selection path.
