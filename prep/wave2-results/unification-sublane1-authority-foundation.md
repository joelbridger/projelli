# Unification sub-lane 1 — authority foundation

- Branch: `feat/unification-sublane1-authority-foundation`
- Base SHA: `0683ff9b6987334e2191a6e8ed302491be55fbf7`
- Frozen source: `207ec6367`
- Final SHA: `PENDING-FINAL-COMMIT`
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
| `clientContextStore.test.ts` | 16 focused tests covering required battery and request/boot cases |
| `evidence/receipt.md` | salvage delta list, Zustand evidence, battery map |
| this report | final lane handoff |

## Final verification and review

Pending final commit and final fresh rerun. This report will be updated with
the exact command results, two clean self-review rounds, independent Sol
review result, final clean-tree proof, and the final SHA.

## Builder attestation

Pending final commit. At finalization I will attest only to checks actually
re-run after the last edit, scope limited to the granted roots, unchanged guard
integrity, and public contracts that expose no raw scope-selection path.
