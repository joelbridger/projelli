# Unification sub-lane 1 — authority foundation

- Branch: `feat/unification-sublane1-authority-foundation`
- Base SHA: `0683ff9b6987334e2191a6e8ed302491be55fbf7`
- Frozen source: `207ec6367`
- Foundation code SHA: `8e06520466b5c5cb8887096edec839d19964786f`
- Receipt: `src/platform/client-context/evidence/receipt.md`
- Rust touched: no

## Delivered

The platform client-context package now owns a fail-closed selection source.
It records one matter, explicitly all matters, or blocked/unresolved; projects
that state into the legacy follower; and retries follower reconciliation from a
`finally` block. It also adds sealed full-pair matter requests, explicit sealed
all-matters intent, an exact-one-unarchived resolver, and a persisted-follower
boot gate. No external writer or consumer was migrated in this sub-lane.

## Manifest

| Deliverable | Status |
| --- | --- |
| `clientContextStore.ts` | tri-state source, sealed provenance, resolver, boot gate, projection/retry |
| `index.ts` | narrow read/request surface; no issuer or raw scope writer |
| `clientContextStore.test.ts` | 19 focused tests covering required battery, request/boot cases, and review fixes |
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
